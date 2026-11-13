require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./database');
const { planAlternativeRoutes } = require('./routePlanner');
const fastagService = require('./fastagService');
const supabaseService = require('./supabaseService');
const smsService = require('./smsService');

const path = require('path');
const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'gpstrackx_super_secret_fleet_jwt_key_2026';

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static frontend files if built
const fs = require('fs');
const distPath = path.join(__dirname, '../frontend/dist');
const publicPath = path.join(__dirname, '../frontend/public');

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}
if (fs.existsSync(publicPath)) {
  app.use(express.static(publicPath));
}

// Dedicated static streaming endpoints for hero and logo videos
app.get(['/hero-video.mp4', '/hero-video'], (req, res) => {
  const distFile = path.join(distPath, 'hero-video.mp4');
  const pubFile = path.join(publicPath, 'hero-video.mp4');
  const target = fs.existsSync(distFile) ? distFile : (fs.existsSync(pubFile) ? pubFile : null);
  if (target) {
    res.setHeader('Content-Type', 'video/mp4');
    return res.sendFile(target);
  }
  res.status(404).send('Hero video not found');
});

app.get(['/logoweb.mp4', '/logoweb'], (req, res) => {
  const distFile = path.join(distPath, 'logoweb.mp4');
  const pubFile = path.join(publicPath, 'logoweb.mp4');
  const target = fs.existsSync(distFile) ? distFile : (fs.existsSync(pubFile) ? pubFile : null);
  if (target) {
    res.setHeader('Content-Type', 'video/mp4');
    return res.sendFile(target);
  }
  res.status(404).send('Logo video not found');
});

// Root route: Serve frontend index.html if dist exists, or health JSON if backend-only
app.get('/', (req, res) => {
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  res.status(200).json({ status: 'ok', service: 'GpsTrackX Backend API', timestamp: new Date().toISOString() });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', uptime: process.uptime() });
});

// Auth Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required. Please sign in.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token.' });
    }
    req.user = user;
    next();
  });
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin permission required. View-only access granted for users.' });
  }
  next();
}

// ---------------- DEVICE DETECTION & VALIDATION HELPERS ---------------- //

function isValidIndianVehicleReg(reg) {
  if (!reg) return false;
  const cleaned = String(reg).toUpperCase().replace(/[\s-]/g, '');
  const standardRegex = /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/;
  const bhRegex = /^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$/;
  return standardRegex.test(cleaned) || bhRegex.test(cleaned);
}

function cleanPhoneNumber(phone) {
  if (!phone) return '';
  return String(phone).replace(/[^0-9]/g, '').slice(-10);
}

function getDeviceInfo(userAgent) {
  if (!userAgent) return 'Web Browser';
  if (/android/i.test(userAgent)) return 'Mobile (Android)';
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'Mobile (iOS)';
  if (/windows nt 10/i.test(userAgent)) return 'Desktop (Windows 10/11)';
  if (/windows/i.test(userAgent)) return 'Desktop (Windows)';
  if (/macintosh|mac os x/i.test(userAgent)) return 'Desktop (macOS)';
  if (/linux/i.test(userAgent)) return 'Desktop (Linux)';
  return 'Web Client';
}

function recordUserLogin({ userId, email, userName, role, req, status = 'SUCCESS' }) {
  try {
    const rawIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';
    const cleanIp = String(rawIp).split(',')[0].trim().replace('::ffff:', '');
    const userAgent = req.headers['user-agent'] || 'Browser Client';
    const deviceType = getDeviceInfo(userAgent);

    // 1. Insert into local SQLite
    db.prepare(`
      INSERT INTO user_logins (user_id, email, user_name, role, ip_address, user_agent, device_type, login_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId || null, email, userName || null, role || 'user', cleanIp, userAgent, deviceType, status);

    // 2. Sync to live Supabase Cloud database
    supabaseService.logUserLogin({
      user_id: userId,
      email,
      user_name: userName,
      role: role || 'user',
      ip_address: cleanIp,
      user_agent: userAgent,
      device_type: deviceType,
      login_status: status
    });
  } catch (err) {
    console.error('[recordUserLogin error]:', err.message);
  }
}

// ---------------- FAST2SMS OTP ROUTES ---------------- //

app.post('/api/auth/send-otp', async (req, res) => {
  const { phone, identifier } = req.body;
  const input = String(phone || identifier || '').trim();
  if (!input) return res.status(400).json({ error: 'Mobile number or Email is required' });

  let targetPhone = input;
  let targetUser = null;

  // If input contains @, find user by email to get registered phone
  if (input.includes('@')) {
    targetUser = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(input);
    if (!targetUser || !targetUser.phone) {
      return res.status(404).json({ error: 'No account registered with this email address or no mobile number linked.' });
    }
    targetPhone = targetUser.phone;
  } else {
    // Input is a phone number or username
    const clean = cleanPhoneNumber(input);
    const allUsers = db.prepare('SELECT * FROM users').all();
    targetUser = allUsers.find(u => u.phone && cleanPhoneNumber(u.phone) === clean);
    targetPhone = clean;
  }

  const cleanTargetPhone = cleanPhoneNumber(targetPhone);
  if (!cleanTargetPhone || cleanTargetPhone.length !== 10) {
    return res.status(400).json({ error: 'Please enter a valid 10-digit Indian mobile number or registered email' });
  }

  try {
    const result = await smsService.sendOtp(cleanTargetPhone);
    const masked = `+91 ******${cleanTargetPhone.slice(-4)}`;
    // Strip debugOtp so verification code is 100% private and never exposed in HTTP response
    const { debugOtp, ...safeResult } = result || {};
    res.json({
      ...safeResult,
      phone: cleanTargetPhone,
      maskedPhone: masked,
      userName: targetUser ? targetUser.name : undefined
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/verify-otp', (req, res) => {
  const { phone, identifier, otp } = req.body;
  const target = String(phone || identifier || '').trim();
  const clean = cleanPhoneNumber(target);
  const result = smsService.verifyOtp(clean, otp);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.json(result);
});

app.post('/api/auth/login-otp', (req, res) => {
  const { phone, identifier, otp } = req.body;
  const input = String(phone || identifier || '').trim();
  if (!input || !otp) {
    return res.status(400).json({ error: 'Mobile number or email and OTP are required' });
  }

  let targetPhone = input;
  let user = null;

  // 1. If input is email, look up user by email
  if (input.includes('@')) {
    user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(input);
    if (user && user.phone) {
      targetPhone = user.phone;
    }
  }

  const clean = cleanPhoneNumber(targetPhone);
  const verify = smsService.verifyOtp(clean, otp);
  if (!verify.success) {
    return res.status(400).json({ error: verify.error });
  }

  // 2. If user wasn't found by email, find by phone
  if (!user) {
    const allUsers = db.prepare('SELECT * FROM users').all();
    user = allUsers.find(u => {
      if (!u.phone) return false;
      const uClean = cleanPhoneNumber(u.phone);
      return uClean === clean || uClean.endsWith(clean) || clean.endsWith(uClean);
    });
  }

  if (!user) {
    return res.status(404).json({ error: 'No account registered with this mobile number. Please check the number or create an account.' });
  }
  if (user.status !== 'active') {
    return res.status(403).json({ error: 'Account has been deactivated. Please contact fleet administrator.' });
  }

  smsService.consumePhoneOtp(clean);

  recordUserLogin({
    userId: user.id,
    email: user.email,
    userName: user.name,
    role: user.role,
    req,
    status: 'SUCCESS'
  });

  const token = jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      companyName: user.company_name,
      role: user.role,
      avatarColor: user.avatar_color
    }
  });
});

// ---------------- AUTH ROUTES ---------------- //

app.post('/api/auth/register', (req, res) => {
  const { name, company_name, phone, password, confirmPassword, role, email } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Username / Full name is required' });
  }
  if (!phone || !phone.trim()) {
    return res.status(400).json({ error: 'Mobile number is required' });
  }
  const cleanPhone = cleanPhoneNumber(phone);
  if (cleanPhone.length !== 10) {
    return res.status(400).json({ error: 'Please enter a valid 10-digit Indian mobile number' });
  }
  if (!password || password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters long' });
  }
  if (confirmPassword && password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }

  // Check duplicate phone
  const allUsers = db.prepare('SELECT id, phone, email FROM users').all();
  const existingUser = allUsers.find(u => u.phone && cleanPhoneNumber(u.phone) === cleanPhone);
  if (existingUser) {
    return res.status(409).json({ error: 'This phone number is already in use. Please use another mobile number to create user account.' });
  }

  const userEmail = email && /^[^s@]+@[^s@]+.[^s@]+$/.test(email.trim()) 
    ? email.trim().toLowerCase() 
    : `${cleanPhone}@gpstrackx.in`;

  const hashedPassword = bcrypt.hashSync(password, 10);
  const userRole = role === 'admin' ? 'admin' : 'user';

  const info = db.prepare(`
    INSERT INTO users (name, email, password, phone, role, status, avatar_color, company_name)
    VALUES (?, ?, ?, ?, ?, 'active', '#EF4444', ?)
  `).run(name.trim(), userEmail, hashedPassword, `+91 ${cleanPhone}`, userRole, company_name ? company_name.trim() : null);

  const newUser = db.prepare('SELECT id, name, email, phone, role, avatar_color, company_name FROM users WHERE id = ?').get(info.lastInsertRowid);

  try {
    supabaseService.syncUser({ ...newUser, password: hashedPassword });
  } catch (e) {}

  // Record registration login event
  recordUserLogin({
    userId: newUser.id,
    email: newUser.email,
    userName: newUser.name,
    role: newUser.role,
    req,
    status: 'SUCCESS'
  });

  const token = jwt.sign(
    { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.status(201).json({
    message: 'User registered successfully',
    token,
    user: {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      phone: newUser.phone,
      companyName: newUser.company_name,
      role: newUser.role,
      avatarColor: newUser.avatar_color
    }
  });
});

app.post('/api/auth/login', (req, res) => {
  const { identifier, phone, email, password } = req.body;
  const loginId = String(identifier || phone || email || '').trim();

  if (!loginId || !password) {
    return res.status(400).json({ error: 'Email or mobile number and password are required' });
  }

  const clean = cleanPhoneNumber(loginId);
  let user = null;

  // 1. Try finding by email (case-insensitive)
  const emailCandidates = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').all(loginId);
  if (emailCandidates.length > 0) {
    user = emailCandidates.find(u => {
      try {
        return bcrypt.compareSync(password, u.password) || password === u.password;
      } catch (e) {
        return password === u.password;
      }
    }) || emailCandidates[0];
  }

  // 2. If not found by email, try finding by phone number
  if (!user && clean && clean.length >= 7) {
    const allUsers = db.prepare('SELECT * FROM users').all();
    const phoneCandidates = allUsers.filter(u => {
      if (!u.phone) return false;
      const uClean = cleanPhoneNumber(u.phone);
      return uClean === clean || uClean.endsWith(clean) || clean.endsWith(uClean);
    });
    if (phoneCandidates.length > 0) {
      user = phoneCandidates.find(u => {
        try {
          return bcrypt.compareSync(password, u.password) || password === u.password;
        } catch (e) {
          return password === u.password;
        }
      }) || phoneCandidates[0];
    }
  }

  // 3. Fallback: try direct name or raw phone match
  if (!user) {
    const nameCandidates = db.prepare(`
      SELECT * FROM users 
      WHERE LOWER(name) = LOWER(?) 
         OR phone = ? 
         OR REPLACE(REPLACE(phone, ' ', ''), '+91', '') = ?
    `).all(loginId, loginId, clean);
    if (nameCandidates.length > 0) {
      user = nameCandidates.find(u => {
        try {
          return bcrypt.compareSync(password, u.password) || password === u.password;
        } catch (e) {
          return password === u.password;
        }
      }) || nameCandidates[0];
    }
  }

  if (!user) {
    recordUserLogin({ email: loginId, role: 'unknown', req, status: 'FAILED_INVALID_USER' });
    return res.status(401).json({ error: 'Invalid login credentials. Please check your email or mobile number.' });
  }

  // STRICT REQUIREMENT:
  // Admin can login with password, but regular fleet users must sign in via Phone Number & SMS OTP
  if (user.role !== 'admin') {
    return res.status(403).json({
      error: 'User accounts must sign in using Mobile Number & SMS OTP.'
    });
  }

  let validPassword = false;
  try {
    validPassword = bcrypt.compareSync(password, user.password);
  } catch (e) {
    validPassword = false;
  }
  if (!validPassword && password === user.password) {
    validPassword = true;
  }

  if (!validPassword) {
    recordUserLogin({
      userId: user.id,
      email: user.email,
      userName: user.name,
      role: user.role,
      req,
      status: 'FAILED_INVALID_PASSWORD'
    });
    return res.status(401).json({ error: 'Invalid password. Please check and try again.' });
  }

  if (user.status !== 'active') {
    return res.status(403).json({ error: 'Account has been deactivated. Please contact fleet administrator.' });
  }

  recordUserLogin({
    userId: user.id,
    email: user.email,
    userName: user.name,
    role: user.role,
    req,
    status: 'SUCCESS'
  });

  const token = jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      companyName: user.company_name,
      role: user.role,
      avatarColor: user.avatar_color
    }
  });
});

// ---------------- AUTH ROUTES ---------------- //

app.post('/api/auth/register', (req, res) => {
  const { name, company_name, phone, password, confirmPassword, role, email } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Username / Full name is required' });
  }
  if (!phone || !phone.trim()) {
    return res.status(400).json({ error: 'Mobile number is required' });
  }
  const cleanPhone = cleanPhoneNumber(phone);
  if (cleanPhone.length !== 10) {
    return res.status(400).json({ error: 'Please enter a valid 10-digit Indian mobile number' });
  }
  if (!password || password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters long' });
  }
  if (confirmPassword && password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }

  // Check duplicate phone
  const allUsers = db.prepare('SELECT id, phone, email FROM users').all();
  const existingUser = allUsers.find(u => u.phone && cleanPhoneNumber(u.phone) === cleanPhone);
  if (existingUser) {
    return res.status(409).json({ error: 'This phone number is already in use. Please use another mobile number to create user account.' });
  }

  const userEmail = email && /^[^s@]+@[^s@]+.[^s@]+$/.test(email.trim()) 
    ? email.trim().toLowerCase() 
    : `${cleanPhone}@gpstrackx.in`;

  const hashedPassword = bcrypt.hashSync(password, 10);
  const userRole = role === 'admin' ? 'admin' : 'user';

  const info = db.prepare(`
    INSERT INTO users (name, email, password, phone, role, status, avatar_color, company_name)
    VALUES (?, ?, ?, ?, ?, 'active', '#EF4444', ?)
  `).run(name.trim(), userEmail, hashedPassword, `+91 ${cleanPhone}`, userRole, company_name ? company_name.trim() : null);

  const newUser = db.prepare('SELECT id, name, email, phone, role, avatar_color, company_name FROM users WHERE id = ?').get(info.lastInsertRowid);

  try {
    supabaseService.syncUser({ ...newUser, password: hashedPassword });
  } catch (e) {}

  // Record registration login event
  recordUserLogin({
    userId: newUser.id,
    email: newUser.email,
    userName: newUser.name,
    role: newUser.role,
    req,
    status: 'SUCCESS'
  });

  const token = jwt.sign(
    { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.status(201).json({
    message: 'User registered successfully',
    token,
    user: {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      phone: newUser.phone,
      companyName: newUser.company_name,
      role: newUser.role,
      avatarColor: newUser.avatar_color
    }
  });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  const user = db.prepare('SELECT id, name, email, phone, role, status, avatar_color, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      avatarColor: user.avatar_color,
      createdAt: user.created_at
    }
  });
});

// Update Profile Information
app.put('/api/auth/profile', authenticateToken, (req, res) => {
  const { name, phone } = req.body;
  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Name cannot be empty' });
  }
  try {
    db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(name.trim(), phone || '', req.user.id);
    const updated = db.prepare('SELECT id, name, email, phone, role, status, avatar_color, created_at FROM users WHERE id = ?').get(req.user.id);
    res.json({
      message: 'Profile updated successfully',
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        phone: updated.phone,
        role: updated.role,
        status: updated.status,
        avatarColor: updated.avatar_color,
        createdAt: updated.created_at
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile: ' + err.message });
  }
});

// Change Password
app.put('/api/auth/change-password', authenticateToken, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const valid = bcrypt.compareSync(currentPassword, user.password);
  if (!valid) {
    return res.status(400).json({ error: 'Current password does not match' });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.user.id);
  res.json({ message: 'Password changed successfully' });
});

// Demo convenience endpoint to get registered accounts for instant testing
app.get('/api/auth/demo-users', (req, res) => {
  const users = db.prepare("SELECT id, name, email, role, phone, avatar_color FROM users WHERE status = 'active'").all();
  res.json(users);
});

// Dedicated User Login Activity & Audit Logs (Admin sees all, User sees own)
app.get('/api/auth/logins', authenticateToken, (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const { status, limit = 100, search } = req.query;

  let conditions = [];
  let params = [];

  if (!isAdmin) {
    conditions.push('user_id = ?');
    params.push(req.user.id);
  }

  if (status && status !== 'all') {
    conditions.push('login_status = ?');
    params.push(status);
  }

  if (search && search.trim() !== '') {
    conditions.push('(email LIKE ? OR user_name LIKE ? OR ip_address LIKE ?)');
    const term = `%${search.trim()}%`;
    params.push(term, term, term);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitNum = Math.min(parseInt(limit) || 100, 250);

  const logins = db.prepare(`
    SELECT * FROM user_logins
    ${whereClause}
    ORDER BY id DESC
    LIMIT ?
  `).all(...params, limitNum);

  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total_logins,
      SUM(CASE WHEN login_status = 'SUCCESS' THEN 1 ELSE 0 END) as successful_logins,
      SUM(CASE WHEN login_status != 'SUCCESS' THEN 1 ELSE 0 END) as failed_logins,
      COUNT(DISTINCT user_id) as active_users
    FROM user_logins
    ${whereClause}
  `).get(...params);

  res.json({
    stats: {
      totalLogins: stats?.total_logins || 0,
      successfulLogins: stats?.successful_logins || 0,
      failedLogins: stats?.failed_logins || 0,
      activeUsers: stats?.active_users || 0
    },
    logins
  });
});

// ---------------- DASHBOARD ROUTES ---------------- //

app.get('/api/dashboard/stats', authenticateToken, (req, res) => {
  const isAdmin = req.user.role === 'admin';

  let vehicleFilter = '';
  let params = [];

  if (!isAdmin) {
    vehicleFilter = 'WHERE assigned_user_id = ?';
    params = [req.user.id];
  }

  const totalVehicles = db.prepare(`SELECT COUNT(*) as count FROM vehicles ${vehicleFilter}`).get(...params).count;
  const activeVehicles = db.prepare(`SELECT COUNT(*) as count FROM vehicles ${isAdmin ? "WHERE status = 'active' OR status = 'moving'" : "WHERE assigned_user_id = ? AND (status = 'active' OR status = 'moving')"}`).get(...params).count;
  const inactiveVehicles = db.prepare(`SELECT COUNT(*) as count FROM vehicles ${isAdmin ? "WHERE status = 'inactive'" : "WHERE assigned_user_id = ? AND status = 'inactive'"}`).get(...params).count;
  const movingVehicles = db.prepare(`SELECT COUNT(*) as count FROM vehicles ${isAdmin ? "WHERE status = 'moving'" : "WHERE assigned_user_id = ? AND status = 'moving'"}`).get(...params).count;

  const avgSpeedRow = db.prepare(`SELECT AVG(current_speed) as avgSpeed FROM vehicles ${isAdmin ? "WHERE status = 'moving'" : "WHERE assigned_user_id = ? AND status = 'moving'"}`).get(...params);
  const avgSpeed = avgSpeedRow && avgSpeedRow.avgSpeed ? parseFloat(avgSpeedRow.avgSpeed.toFixed(1)) : 0;

  const totalUsers = isAdmin ? db.prepare('SELECT COUNT(*) as count FROM users').get().count : 1;
  const totalRoutes = db.prepare(`SELECT COUNT(*) as count FROM routes r JOIN vehicles v ON r.vehicle_id = v.id ${isAdmin ? '' : 'WHERE v.assigned_user_id = ?'}`).get(...params).count;

  // Recent vehicles with route info
  const recentVehiclesQuery = `
    SELECT v.*, u.name as owner_name, u.email as owner_email, r.route_name, r.start_location_name, r.end_location_name, r.total_distance_km
    FROM vehicles v
    LEFT JOIN users u ON v.assigned_user_id = u.id
    LEFT JOIN routes r ON r.id = (
      SELECT id FROM routes 
      WHERE vehicle_id = v.id AND is_active = 1 
      ORDER BY id DESC LIMIT 1
    )
    ${vehicleFilter}
    ORDER BY v.updated_at DESC
    LIMIT 6
  `;
  const recentVehicles = db.prepare(recentVehiclesQuery).all(...params);

  res.json({
    stats: {
      totalVehicles,
      activeVehicles,
      inactiveVehicles,
      movingVehicles,
      avgSpeed,
      totalUsers,
      totalRoutes
    },
    recentVehicles
  });
});

// ---------------- VEHICLE MANAGEMENT ROUTES ---------------- //

app.get('/api/vehicles', authenticateToken, (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const { search, type, status, userId } = req.query;

  let conditions = [];
  let params = [];

  // Strict RBAC: normal users can ONLY ever see their own vehicles
  if (!isAdmin) {
    conditions.push('v.assigned_user_id = ?');
    params.push(req.user.id);
  } else if (userId && userId !== 'all') {
    conditions.push('v.assigned_user_id = ?');
    params.push(userId);
  }

  if (search && search.trim() !== '') {
    conditions.push('(v.registration_no LIKE ? OR v.name_model LIKE ? OR v.device_id LIKE ? OR v.imei_number LIKE ?)');
    const searchTerm = `%${search.trim()}%`;
    params.push(searchTerm, searchTerm, searchTerm, searchTerm);
  }

  if (type && type !== 'all') {
    conditions.push('v.vehicle_type = ?');
    params.push(type);
  }

  if (status && status !== 'all') {
    if (status === 'active') {
      conditions.push('(v.status = "active" OR v.status = "moving")');
    } else {
      conditions.push('v.status = ?');
      params.push(status);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT 
      v.*,
      u.name as owner_name,
      u.email as owner_email,
      u.phone as owner_phone,
      r.id as route_id,
      r.route_name,
      r.start_location_name,
      r.end_location_name,
      r.start_lat,
      r.start_lng,
      r.end_lat,
      r.end_lng,
      r.overview_polyline,
      r.toll_gates_json,
      COALESCE(r.total_distance_km, 150) as total_distance_km,
      COALESCE(r.estimated_travel_time_min, 180) as estimated_travel_time_min,
      r.route_color,
      COALESCE(r.start_trip_time, v.start_trip_time, '08:00') as start_trip_time,
      COALESCE(r.end_trip_time, v.end_trip_time, '18:00') as end_trip_time,
      COALESCE((SELECT SUM(charges) FROM manual_toll_gates WHERE route_id = r.id), v.total_toll_fee, 340) as total_toll_fee,
      COALESCE((SELECT COUNT(*) FROM stoppages WHERE route_id = r.id), v.stoppages_count, 2) as stoppages_count
    FROM vehicles v
    LEFT JOIN users u ON v.assigned_user_id = u.id
    LEFT JOIN routes r ON r.id = (
      SELECT id FROM routes 
      WHERE vehicle_id = v.id AND is_active = 1 
      ORDER BY id DESC LIMIT 1
    )
    ${whereClause}
    ORDER BY v.id DESC
  `;

  const vehicles = db.prepare(sql).all(...params);
  res.json(vehicles);
});

// Get all trips/routes recorded for a specific vehicle
app.get('/api/vehicles/:id/trips', authenticateToken, (req, res) => {
  const vehicleId = req.params.id;

  // Strict User Isolation: Regular users can ONLY ever access trips for their own assigned vehicle
  if (req.user.role !== 'admin') {
    const checkVeh = db.prepare('SELECT assigned_user_id FROM vehicles WHERE id = ?').get(vehicleId);
    if (!checkVeh || checkVeh.assigned_user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied: You do not have permission to view trips for this vehicle.' });
    }
  }

  try {
    const trips = db.prepare(`
      SELECT r.*,
        (SELECT COUNT(*) FROM stoppages WHERE route_id = r.id) as sql_stoppages_count,
        (SELECT COALESCE(SUM(charges), 0) FROM manual_toll_gates WHERE route_id = r.id) as sql_tolls_amount,
        v.stoppages_count as veh_stoppages_count,
        v.total_toll_fee as veh_total_toll_fee
      FROM routes r
      LEFT JOIN vehicles v ON r.vehicle_id = v.id
      WHERE r.vehicle_id = ?
      ORDER BY r.id DESC
    `).all(vehicleId);

    const formattedTrips = trips.map(t => {
      let waypoints = [];
      if (t.waypoints_json) {
        try {
          const wp = typeof t.waypoints_json === 'string' ? JSON.parse(t.waypoints_json) : t.waypoints_json;
          if (Array.isArray(wp) && wp.length > 0) waypoints = wp;
        } catch (_) {}
      }
      if (waypoints.length === 0) {
        try {
          const sqlStops = db.prepare('SELECT * FROM stoppages WHERE route_id = ? ORDER BY sequence_order ASC').all(t.id);
          if (sqlStops && sqlStops.length > 0) waypoints = sqlStops;
        } catch (_) {}
      }

      let tollGates = [];
      if (t.toll_gates_json) {
        try {
          const tg = typeof t.toll_gates_json === 'string' ? JSON.parse(t.toll_gates_json) : t.toll_gates_json;
          if (Array.isArray(tg) && tg.length > 0) tollGates = tg;
        } catch (_) {}
      }
      if (tollGates.length === 0) {
        try {
          const sqlTolls = db.prepare('SELECT * FROM manual_toll_gates WHERE route_id = ?').all(t.id);
          if (sqlTolls && sqlTolls.length > 0) tollGates = sqlTolls;
        } catch (_) {}
      }

      const stopsCount = (t.stoppages_count != null && Number(t.stoppages_count) > 0)
        ? Number(t.stoppages_count)
        : (waypoints.length || t.sql_stoppages_count || t.veh_stoppages_count || 0);
      const tollsAmount = (t.total_toll_fee != null && Number(t.total_toll_fee) > 0)
        ? Number(t.total_toll_fee)
        : (tollGates.reduce((sum, item) => sum + (Number(item.charges) || 0), 0) || t.sql_tolls_amount || t.veh_total_toll_fee || 0);

      return {
        ...t,
        waypoints,
        toll_gates: tollGates,
        stoppages_count: stopsCount,
        total_toll_fee: tollsAmount,
        total_tolls_amount: tollsAmount
      };
    });

    res.json(formattedTrips);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch vehicle trips: ' + err.message });
  }
});

// Activate a specific historical trip/route for a vehicle (Admin or Assigned User)
app.put('/api/routes/:id/activate', authenticateToken, (req, res) => {
  const routeId = req.params.id;
  try {
    const route = db.prepare('SELECT * FROM routes WHERE id = ?').get(routeId);
    if (!route) return res.status(404).json({ error: 'Route not found' });

    // If regular user, verify vehicle assignment
    if (req.user.role !== 'admin') {
      const vehicle = db.prepare('SELECT assigned_user_id FROM vehicles WHERE id = ?').get(route.vehicle_id);
      if (!vehicle || vehicle.assigned_user_id !== req.user.id) {
        return res.status(403).json({ error: 'Unauthorized: You can only activate trips for your assigned vehicle.' });
      }
    }

    db.prepare('UPDATE routes SET is_active = 0 WHERE vehicle_id = ?').run(route.vehicle_id);
    db.prepare('UPDATE routes SET is_active = 1 WHERE id = ?').run(routeId);
    
    // Also update vehicle's quick telemetry
    db.prepare(`
      UPDATE vehicles
      SET 
        start_trip_time = COALESCE(?, start_trip_time),
        end_trip_time = COALESCE(?, end_trip_time),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(route.start_trip_time, route.end_trip_time, route.vehicle_id);

    res.json({ success: true, message: 'Trip activated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to activate trip: ' + err.message });
  }
});

// Update a specific route's operational status (moving / stop / parking)
app.put('/api/routes/:id/operational-status', authenticateToken, (req, res) => {
  const routeId = req.params.id;
  const { operational_status } = req.body;
  if (!['moving', 'stop', 'parking', 'active', 'inactive', 'stopped'].includes(operational_status)) {
    return res.status(400).json({ error: 'Invalid operational status' });
  }

  try {
    const route = db.prepare('SELECT * FROM routes WHERE id = ?').get(routeId);
    if (!route) return res.status(404).json({ error: 'Route not found' });

    // Regular users can only update routes for their assigned vehicles
    if (req.user.role !== 'admin') {
      const vehicle = db.prepare('SELECT assigned_user_id FROM vehicles WHERE id = ?').get(route.vehicle_id);
      if (!vehicle || vehicle.assigned_user_id !== req.user.id) {
        return res.status(403).json({ error: 'Unauthorized' });
      }
    }

    db.prepare('UPDATE routes SET operational_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(operational_status, routeId);

    // Update vehicle status & current speed accordingly
    let newSpeed = 0;
    if (operational_status === 'moving') {
      newSpeed = 48;
    } else if (operational_status === 'stop' || operational_status === 'parking') {
      newSpeed = 0;
    }
    db.prepare('UPDATE vehicles SET status = ?, current_speed = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      operational_status,
      newSpeed,
      route.vehicle_id
    );

    res.json({ success: true, operational_status, vehicle_id: route.vehicle_id, current_speed: newSpeed });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update operational status: ' + err.message });
  }
});

// Update vehicle status directly (moving / stop / parking)
app.put('/api/vehicles/:id/status', authenticateToken, (req, res) => {
  const vehicleId = req.params.id;
  const { status } = req.body;
  if (!['moving', 'stop', 'parking', 'active', 'inactive', 'stopped'].includes(status)) {
    return res.status(400).json({ error: 'Invalid vehicle status' });
  }

  try {
    const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicleId);
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

    let newSpeed = 0;
    if (status === 'moving') {
      newSpeed = 48;
    } else if (status === 'stop' || status === 'parking' || status === 'stopped') {
      newSpeed = 0;
    }

    db.prepare('UPDATE vehicles SET status = ?, current_speed = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      status,
      newSpeed,
      vehicleId
    );
    db.prepare('UPDATE routes SET operational_status = ?, updated_at = CURRENT_TIMESTAMP WHERE vehicle_id = ? AND is_active = 1').run(
      status,
      vehicleId
    );

    res.json({ success: true, status, vehicle_id: vehicleId, current_speed: newSpeed });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update vehicle status: ' + err.message });
  }
});

app.get('/api/vehicles/:id', authenticateToken, (req, res) => {
  const vehicleId = req.params.id;

  const vehicle = db.prepare(`
    SELECT v.*, u.name as owner_name, u.email as owner_email, u.phone as owner_phone
    FROM vehicles v
    LEFT JOIN users u ON v.assigned_user_id = u.id
    WHERE v.id = ?
  `).get(vehicleId);

  if (!vehicle) {
    return res.status(404).json({ error: 'Vehicle not found' });
  }

  // Strict User Isolation: Regular users can ONLY ever access their own assigned vehicle
  if (req.user.role !== 'admin' && vehicle.assigned_user_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied: You do not have permission to view this vehicle.' });
  }

  // Get active route details (or fallback to latest recorded route for this vehicle)
  let activeRoute = db.prepare(`
    SELECT * FROM routes WHERE vehicle_id = ? AND is_active = 1
  `).get(vehicleId);

  if (!activeRoute) {
    activeRoute = db.prepare(`
      SELECT * FROM routes WHERE vehicle_id = ? ORDER BY id DESC LIMIT 1
    `).get(vehicleId);
  }

  let stoppages = [];
  let manualTolls = [];

  if (activeRoute) {
    stoppages = db.prepare('SELECT * FROM stoppages WHERE route_id = ? ORDER BY sequence_order ASC').all(activeRoute.id);
    manualTolls = db.prepare('SELECT * FROM manual_toll_gates WHERE route_id = ? ORDER BY id ASC').all(activeRoute.id);

    // Fallback to waypoints_json if stoppages table is empty
    if ((!stoppages || stoppages.length === 0) && activeRoute.waypoints_json) {
      try {
        const parsedWp = typeof activeRoute.waypoints_json === 'string' ? JSON.parse(activeRoute.waypoints_json) : activeRoute.waypoints_json;
        if (Array.isArray(parsedWp)) {
          stoppages = parsedWp.map((wp, idx) => ({
            id: wp.id || (idx + 1),
            route_id: activeRoute.id,
            sequence_order: wp.sequence_order || (idx + 1),
            name: wp.name || `Stoppage #${idx + 1}`,
            address: wp.address || `Location (${wp.lat}, ${wp.lng})`,
            lat: wp.lat,
            lng: wp.lng,
            stop_duration_mins: wp.duration || wp.stop_duration_mins || 20
          }));
        }
      } catch (e) {}
    }

    // Fallback to toll_gates_json if manual_toll_gates is empty
    if ((!manualTolls || manualTolls.length === 0) && activeRoute.toll_gates_json) {
      try {
        const parsedTolls = typeof activeRoute.toll_gates_json === 'string' ? JSON.parse(activeRoute.toll_gates_json) : activeRoute.toll_gates_json;
        if (Array.isArray(parsedTolls)) {
          manualTolls = parsedTolls;
        }
      } catch (e) {}
    }
  }

  res.json({
    vehicle,
    activeRoute,
    stoppages,
    manualTolls
  });
});

// Add New Vehicle (Admin Only)
app.post('/api/vehicles', authenticateToken, requireAdmin, (req, res) => {
  const {
    registration_no,
    name_model,
    vehicle_type,
    device_id,
    imei_number,
    chassis_number,
    fuel_type,
    assigned_user_id,
    max_speed_limit,
    current_lat,
    current_lng,
    status,
    axle_type
  } = req.body;

  if (!registration_no || !name_model || !vehicle_type) {
    return res.status(400).json({ error: 'Registration number, vehicle name/model, and vehicle type are required.' });
  }

  const cleanReg = registration_no.trim().toUpperCase();
  if (!isValidIndianVehicleReg(cleanReg)) {
    return res.status(400).json({
      error: 'Please enter a valid Indian vehicle registration number format (e.g. MH-12-RN-4589 or DL-01-AB-1024 or CG-04-A-1234).'
    });
  }

  // Check duplicate
  const existing = db.prepare('SELECT id FROM vehicles WHERE registration_no = ?').get(cleanReg);
  if (existing) {
    return res.status(400).json({ error: `Vehicle with registration ${cleanReg} already exists.` });
  }

  const defaultLat = current_lat || 19.0760; // Mumbai default or provided
  const defaultLng = current_lng || 72.8777;

  try {
    const insertStmt = db.prepare(`
      INSERT INTO vehicles (
        registration_no, name_model, vehicle_type, device_id, imei_number, chassis_number,
        fuel_type, assigned_user_id, status, max_speed_limit, current_lat, current_lng, axle_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insertStmt.run(
      cleanReg,
      name_model.trim(),
      vehicle_type,
      device_id ? device_id.trim() : `GPS-TRK-${Date.now().toString().slice(-6)}`,
      imei_number ? imei_number.trim() : `86420904${Math.floor(1000000 + Math.random() * 9000000)}`,
      chassis_number ? chassis_number.trim().toUpperCase() : `MB1T${Math.floor(100000 + Math.random() * 900000)}`,
      fuel_type || 'Diesel',
      assigned_user_id ? parseInt(assigned_user_id) : null,
      status || 'active',
      max_speed_limit ? parseFloat(max_speed_limit) : 80,
      defaultLat,
      defaultLng,
      axle_type || '4-axle'
    );

    const newVehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(result.lastInsertRowid);
    if (newVehicle) {
      supabaseService.syncVehicle(newVehicle);
      if (assigned_user_id) {
        db.prepare(`
          INSERT INTO vehicle_allocations (vehicle_id, user_id, allocated_by, route_id, allocation_status, notes)
          VALUES (?, ?, ?, NULL, 'ACTIVE', 'Admin created vehicle and assigned to user')
        `).run(newVehicle.id, parseInt(assigned_user_id), req.user.id);

        supabaseService.syncVehicleAllocation({
          vehicle_id: newVehicle.id,
          user_id: parseInt(assigned_user_id),
          allocated_by: req.user.id,
          route_id: null,
          allocation_status: 'ACTIVE',
          notes: 'Admin created vehicle and assigned to user'
        });
      }
    }
    res.status(201).json(newVehicle);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create vehicle: ' + err.message });
  }
});

// Edit Vehicle (Admin Only)
app.put('/api/vehicles/:id', authenticateToken, requireAdmin, (req, res) => {
  const vehicleId = req.params.id;
  const {
    registration_no,
    name_model,
    vehicle_type,
    device_id,
    imei_number,
    chassis_number,
    fuel_type,
    assigned_user_id,
    max_speed_limit,
    status,
    axle_type
  } = req.body;

  const vehicle = db.prepare('SELECT id, assigned_user_id FROM vehicles WHERE id = ?').get(vehicleId);
  if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

  const cleanReg = registration_no.trim().toUpperCase();
  if (!isValidIndianVehicleReg(cleanReg)) {
    return res.status(400).json({
      error: 'Please enter a valid Indian vehicle registration number format (e.g. MH-12-RN-4589 or DL-01-AB-1024 or CG-04-A-1234).'
    });
  }

  try {
    const safeStatus = status || 'active';
    let targetSpeed = (vehicle && vehicle.current_speed) || 0;
    if (safeStatus === 'stop' || safeStatus === 'parking' || safeStatus === 'stopped') {
      targetSpeed = 0;
    } else if (safeStatus === 'moving') {
      targetSpeed = (targetSpeed > 0) ? targetSpeed : 48;
    }

    db.prepare(`
      UPDATE vehicles SET
        registration_no = ?,
        name_model = ?,
        vehicle_type = ?,
        device_id = ?,
        imei_number = ?,
        chassis_number = ?,
        fuel_type = ?,
        assigned_user_id = ?,
        max_speed_limit = ?,
        status = ?,
        current_speed = ?,
        axle_type = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      cleanReg,
      name_model.trim(),
      vehicle_type,
      device_id ? device_id.trim() : (vehicle.device_id || `GPS-TRK-${vehicleId}`),
      imei_number,
      chassis_number,
      fuel_type,
      assigned_user_id ? parseInt(assigned_user_id) : null,
      max_speed_limit ? parseFloat(max_speed_limit) : 80,
      safeStatus,
      targetSpeed,
      axle_type || '4-axle',
      vehicleId
    );

    if (safeStatus === 'moving' || safeStatus === 'stop' || safeStatus === 'parking') {
      db.prepare('UPDATE routes SET operational_status = ? WHERE vehicle_id = ? AND is_active = 1').run(safeStatus, vehicleId);
    }

    const updated = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicleId);
    if (updated) {
      supabaseService.syncVehicle(updated);

      // Track user allocation changes
      if (assigned_user_id && parseInt(assigned_user_id) !== vehicle.assigned_user_id) {
        const activeRoute = db.prepare('SELECT id FROM routes WHERE vehicle_id = ? AND is_active = 1').get(vehicleId);
        db.prepare(`
          INSERT INTO vehicle_allocations (vehicle_id, user_id, allocated_by, route_id, allocation_status, notes)
          VALUES (?, ?, ?, ?, 'ACTIVE', 'Admin updated vehicle user assignment')
        `).run(vehicleId, parseInt(assigned_user_id), req.user.id, activeRoute ? activeRoute.id : null);

        supabaseService.syncVehicleAllocation({
          vehicle_id: parseInt(vehicleId),
          user_id: parseInt(assigned_user_id),
          allocated_by: req.user.id,
          route_id: activeRoute ? activeRoute.id : null,
          allocation_status: 'ACTIVE',
          notes: 'Admin updated vehicle user assignment'
        });
      }
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update vehicle: ' + err.message });
  }
});

// Delete Vehicle (Admin Only) - PERMANENTLY PRESERVE ALL ROUTES AND CORRIDORS
app.delete('/api/vehicles/:id', authenticateToken, requireAdmin, async (req, res) => {
  const vehicleId = req.params.id;
  try {
    // Preserve vehicle registration and name in routes before detaching
    const veh = db.prepare('SELECT registration_no, name_model FROM vehicles WHERE id = ?').get(vehicleId);
    if (veh && veh.registration_no) {
      try {
        db.prepare('UPDATE routes SET vehicle_registration_no = COALESCE(vehicle_registration_no, ?) WHERE vehicle_id = ?').run(veh.registration_no, vehicleId);
      } catch (_) {}
    }

    // Mirror all routes for this vehicle into saved_corridors so they are 100% permanently immortal
    try {
      const routesToSave = db.prepare('SELECT * FROM routes WHERE vehicle_id = ?').all(vehicleId);
      for (const r of routesToSave) {
        db.prepare(`
          INSERT OR IGNORE INTO saved_corridors (
            route_name, start_location_name, start_address, start_lat, start_lng,
            end_location_name, end_address, end_lat, end_lng,
            total_distance_km, estimated_travel_time_min,
            overview_polyline, waypoints_json, toll_gates_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          r.route_name || `${r.start_location_name} to ${r.end_location_name}`,
          r.start_location_name, r.start_address || '', r.start_lat, r.start_lng,
          r.end_location_name, r.end_address || '', r.end_lat, r.end_lng,
          r.total_distance_km || 0, r.estimated_travel_time_min || 0,
          r.overview_polyline || '[]', r.waypoints_json || '[]', r.toll_gates_json || '[]'
        );
      }
    } catch (_) {}

    // Detach vehicle_id from routes (DO NOT DELETE ROUTES - PRESERVED PERMANENTLY)
    db.prepare('UPDATE routes SET vehicle_id = NULL WHERE vehicle_id = ?').run(vehicleId);
    db.prepare('DELETE FROM fastag_transactions WHERE vehicle_id = ?').run(vehicleId);
    db.prepare('DELETE FROM vehicle_allocations WHERE vehicle_id = ?').run(vehicleId);
    db.prepare('DELETE FROM vehicles WHERE id = ?').run(vehicleId);
    await supabaseService.deleteVehicle(vehicleId);
    res.json({ message: 'Vehicle deleted successfully. All saved routes permanently preserved.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete vehicle: ' + err.message });
  }
});

// ---------------- USER MANAGEMENT ROUTES (ADMIN ONLY) ---------------- //

app.get('/api/users', authenticateToken, requireAdmin, (req, res) => {
  const { search, status } = req.query;
  let conditions = [];
  let params = [];

  if (search && search.trim() !== '') {
    conditions.push('(name LIKE ? OR email LIKE ? OR phone LIKE ?)');
    const q = `%${search.trim()}%`;
    params.push(q, q, q);
  }

  if (status && status !== 'all') {
    conditions.push('status = ?');
    params.push(status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT 
      u.id, u.name, u.email, u.phone, u.role, u.status, u.avatar_color, u.created_at,
      COUNT(DISTINCT v.id) as vehicle_count,
      COUNT(DISTINCT r.id) as trip_count,
      GROUP_CONCAT(DISTINCT v.registration_no) as assigned_reg_nos
    FROM users u
    LEFT JOIN vehicles v ON u.id = v.assigned_user_id
    LEFT JOIN routes r ON v.id = r.vehicle_id
    ${whereClause}
    GROUP BY u.id
    ORDER BY u.id DESC
  `;

  const users = db.prepare(sql).all(...params);
  res.json(users);
});

app.post('/api/users', authenticateToken, requireAdmin, (req, res) => {
  const { name, email, password, phone, role, status, company_name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'User name is required' });
  }
  if (!password || !password.trim()) {
    return res.status(400).json({ error: 'Password is required' });
  }

  const cleanPhone = cleanPhoneNumber(phone || '');
  if (phone && phone.trim() && cleanPhone.length !== 10) {
    return res.status(400).json({ error: 'Please enter a valid 10-digit Indian mobile number.' });
  }

  // Strictly enforce 1 user per mobile number
  if (cleanPhone) {
    const allUsers = db.prepare('SELECT id, name, phone, email FROM users').all();
    const existingUser = allUsers.find(u => u.phone && cleanPhoneNumber(u.phone) === cleanPhone);
    if (existingUser) {
      return res.status(400).json({
        error: 'This phone number is already in use. Please use another mobile number to create user account.'
      });
    }
  }

  const hasValidEmail = email && email.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const userEmail = hasValidEmail
    ? email.trim().toLowerCase()
    : (cleanPhone ? `${cleanPhone}@gpstrackx.in` : `user.${Date.now()}@gpstrackx.in`);

  const colors = ['#EF4444', '#DC2626', '#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EC4899'];
  const avatarColor = colors[Math.floor(Math.random() * colors.length)];
  const hash = bcrypt.hashSync(password, 10);
  const formattedPhone = cleanPhone ? (phone && phone.trim().startsWith('+') ? phone.trim() : `+91 ${cleanPhone}`) : (phone || '');

  try {
    const result = db.prepare(`
      INSERT INTO users (name, email, password, phone, role, status, avatar_color, company_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name.trim(), userEmail, hash, formattedPhone, role || 'user', status || 'active', avatarColor, company_name || null);

    const newUser = db.prepare('SELECT id, name, email, phone, role, status, avatar_color, company_name, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);
    try {
      supabaseService.syncUser({ ...newUser, password: hash });
    } catch (e) {}
    return res.status(201).json(newUser);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create user: ' + err.message });
  }
});

// QUICK VEHICLE ROUTE UPDATE (Inline Edit for Timing, Tolls, Stops)
app.put('/api/vehicles/:id/quick-route', authenticateToken, requireAdmin, (req, res) => {
  const vehicleId = req.params.id;
  const { start_trip_time, end_trip_time, total_toll_fee, stoppages_count, total_distance_km } = req.body;

  try {
    // 1. Always update vehicles table directly
    db.prepare(`
      UPDATE vehicles
      SET 
        start_trip_time = COALESCE(?, start_trip_time),
        end_trip_time = COALESCE(?, end_trip_time),
        total_toll_fee = COALESCE(?, total_toll_fee),
        stoppages_count = COALESCE(?, stoppages_count),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      start_trip_time || null,
      end_trip_time || null,
      total_toll_fee !== undefined ? Number(total_toll_fee) : null,
      stoppages_count !== undefined ? Number(stoppages_count) : null,
      vehicleId
    );

    // 2. Find active route for this vehicle
    const activeRoute = db.prepare('SELECT * FROM routes WHERE vehicle_id = ? AND is_active = 1').get(vehicleId);

    if (activeRoute) {
      db.prepare(`
        UPDATE routes 
        SET 
          start_trip_time = COALESCE(?, start_trip_time),
          end_trip_time = COALESCE(?, end_trip_time),
          total_distance_km = COALESCE(?, total_distance_km),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(start_trip_time || null, end_trip_time || null, total_distance_km ? Number(total_distance_km) : null, activeRoute.id);

      // If total_toll_fee provided, update manual tolls on that route
      if (total_toll_fee !== undefined && total_toll_fee !== null) {
        const fee = Number(total_toll_fee);
        const existingToll = db.prepare('SELECT id FROM manual_toll_gates WHERE route_id = ? LIMIT 1').get(activeRoute.id);
        if (existingToll) {
          db.prepare('UPDATE manual_toll_gates SET charges = ? WHERE id = ?').run(fee, existingToll.id);
        } else {
          db.prepare(`
            INSERT INTO manual_toll_gates (route_id, name, lat, lng, charges, toll_type)
            VALUES (?, 'FASTag Commercial Plaza', ?, ?, ?, 'FASTag ETC Commercial Gate')
          `).run(activeRoute.id, activeRoute.start_lat, activeRoute.start_lng, fee);
        }
      }
    }

    res.json({ success: true, message: 'Vehicle route parameters updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update quick route parameters: ' + err.message });
  }
});

// STANDALONE SAVE CORRIDOR ENDPOINT (For Excel Imported & Draggable Routes)
app.post('/api/routes/save-corridor', authenticateToken, requireAdmin, (req, res) => {
  const {
    route_name,
    start_location_name,
    start_address,
    start_lat,
    start_lng,
    end_location_name,
    end_address,
    end_lat,
    end_lng,
    total_distance_km,
    estimated_travel_time_min,
    overview_polyline,
    waypoints,
    toll_gates
  } = req.body;

  if (!route_name || !start_location_name || !end_location_name) {
    return res.status(400).json({ error: 'Route name, start point, and destination are required' });
  }

  const polyStr = typeof overview_polyline === 'string' ? overview_polyline : JSON.stringify(overview_polyline || []);
  const wpJson = typeof waypoints === 'string' ? waypoints : JSON.stringify(waypoints || []);
  const tollJson = typeof toll_gates === 'string' ? toll_gates : JSON.stringify(toll_gates || []);

  try {
    const existing = db.prepare('SELECT id FROM saved_corridors WHERE route_name = ?').get(route_name.trim());
    let corridorId;

    if (existing) {
      db.prepare(`
        UPDATE saved_corridors 
        SET 
          start_location_name = ?, start_address = ?, start_lat = ?, start_lng = ?,
          end_location_name = ?, end_address = ?, end_lat = ?, end_lng = ?,
          total_distance_km = ?, estimated_travel_time_min = ?,
          overview_polyline = ?, waypoints_json = ?, toll_gates_json = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        start_location_name, start_address || '', start_lat, start_lng,
        end_location_name, end_address || '', end_lat, end_lng,
        total_distance_km || 0, estimated_travel_time_min || 0,
        polyStr, wpJson, tollJson,
        existing.id
      );
      corridorId = existing.id;
    } else {
      const info = db.prepare(`
        INSERT INTO saved_corridors (
          route_name, start_location_name, start_address, start_lat, start_lng,
          end_location_name, end_address, end_lat, end_lng,
          total_distance_km, estimated_travel_time_min,
          overview_polyline, waypoints_json, toll_gates_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        route_name.trim(), start_location_name, start_address || '', start_lat, start_lng,
        end_location_name, end_address || '', end_lat, end_lng,
        total_distance_km || 0, estimated_travel_time_min || 0,
        polyStr, wpJson, tollJson
      );
      corridorId = info.lastInsertRowid;
    }

    const saved = db.prepare('SELECT * FROM saved_corridors WHERE id = ?').get(corridorId);
    res.status(201).json({ success: true, corridor: saved });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save corridor: ' + err.message });
  }
});

app.put('/api/users/:id', authenticateToken, requireAdmin, (req, res) => {
  const userId = req.params.id;
  const { name, email, phone, role, status, password } = req.body;

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const cleanPhone = cleanPhoneNumber(phone || '');
  if (phone && phone.trim() && cleanPhone.length !== 10) {
    return res.status(400).json({ error: 'Please enter a valid 10-digit Indian mobile number.' });
  }

  if (cleanPhone) {
    const otherUsers = db.prepare('SELECT id, name, phone FROM users WHERE id != ?').all(userId);
    const duplicatePhoneUser = otherUsers.find(u => u.phone && cleanPhoneNumber(u.phone) === cleanPhone);
    if (duplicatePhoneUser) {
      return res.status(400).json({
        error: 'This phone number is already in use. Please use another mobile number to create user account.'
      });
    }
  }

  try {
    if (password && password.trim() !== '') {
      const hash = bcrypt.hashSync(password, 10);
      db.prepare(`
        UPDATE users SET name = ?, email = ?, phone = ?, role = ?, status = ?, password = ? WHERE id = ?
      `).run(name.trim(), email.toLowerCase().trim(), phone || '', role || 'user', status || 'active', hash, userId);
    } else {
      db.prepare(`
        UPDATE users SET name = ?, email = ?, phone = ?, role = ?, status = ? WHERE id = ?
      `).run(name.trim(), email.toLowerCase().trim(), phone || '', role || 'user', status || 'active', userId);
    }

    const updated = db.prepare('SELECT id, name, email, phone, role, status, avatar_color, created_at FROM users WHERE id = ?').get(userId);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user: ' + err.message });
  }
});

app.delete('/api/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  const userId = req.params.id;
  if (parseInt(userId) === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete the currently signed-in admin account.' });
  }
  try {
    // Unassign vehicles assigned to this user (preserving all vehicles and saved routes)
    db.prepare('UPDATE vehicles SET assigned_user_id = NULL WHERE assigned_user_id = ?').run(userId);
    db.prepare('DELETE FROM user_logins WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM vehicle_allocations WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    await supabaseService.deleteUser(userId);
    res.json({ message: 'User deleted successfully. Vehicles and saved routes preserved.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user: ' + err.message });
  }
});

// ---------------- GOOGLE MAPS & ROUTE PLANNING ---------------- //

// ---------------- REAL-TIME LOCATION SEARCH & GEOCODING ---------------- //

const LOCAL_AREAS_DATABASE = [
  // --- RAIGARH COMPREHENSIVE LOCAL STREETS, COLONIES, CHOWKS & INDUSTRIAL HUBS ---
  { name: 'Boirdadar Chowk, Raigarh', address: 'Boirdadar Main Road, Raigarh, Chhattisgarh 496001', lat: 21.8845, lng: 83.3850, category: 'Residential & Commercial' },
  { name: 'Boirdadar Colony / Stadium Area, Raigarh', address: 'Boirdadar Residential Colony, Raigarh, Chhattisgarh 496001', lat: 21.8810, lng: 83.3820, category: 'Colony' },
  { name: 'Kirodimal Nagar, Raigarh', address: 'Kirodimal Nagar, Near Station, Raigarh, Chhattisgarh 496001', lat: 21.9272, lng: 83.3321, category: 'Township & Hub' },
  { name: 'Kirodimal Industrial Belt, Raigarh', address: 'Kirodimal Industrial Complex, Raigarh, Chhattisgarh 496001', lat: 21.9310, lng: 83.3380, category: 'Industrial Zone' },
  { name: 'Dhimrapur Chowk & Market, Raigarh', address: 'Dhimrapur Chowk, Dhimrapur Road, Raigarh, Chhattisgarh 496001', lat: 21.9080, lng: 83.3980, category: 'Commercial Chowk' },
  { name: 'Chakradhar Nagar, Raigarh', address: 'Near District Collectorate, Chakradhar Nagar, Raigarh, Chhattisgarh 496001', lat: 21.9020, lng: 83.4110, category: 'Administrative Hub' },
  { name: 'Transport Nagar, Kotra Road, Raigarh', address: 'Transport Nagar, Kotra Road Freight Terminal, Raigarh, Chhattisgarh 496001', lat: 21.8950, lng: 83.3750, category: 'Logistics Hub' },
  { name: 'Kotra Road Commercial Belt, Raigarh', address: 'Kotra Road, Raigarh, Chhattisgarh 496001', lat: 21.8910, lng: 83.3680, category: 'Commercial Area' },
  { name: 'Patrapali / Jindal Steel & Power Gate, Raigarh', address: 'Jindal Industrial Complex Gate 1, Patrapali, Raigarh, Chhattisgarh 496001', lat: 21.9320, lng: 83.3650, category: 'Industrial Plant' },
  { name: 'Raigarh Railway Station Road', address: 'Station Road, Ganj Mandi, Raigarh, Chhattisgarh 496001', lat: 21.8976, lng: 83.3965, category: 'Transit Hub' },
  { name: 'Kotwali Chowk & Main Market, Raigarh', address: 'Kotwali Chowk, Sadar Bazar Road, Raigarh, Chhattisgarh 496001', lat: 21.8990, lng: 83.4020, category: 'Main Market' },
  { name: 'Gora Area & Satti Mandir, Raigarh', address: 'Gora Chowk, Raigarh, Chhattisgarh 496001', lat: 21.8850, lng: 83.4120, category: 'Local Area' },
  { name: 'Taraimal Industrial Belt, Raigarh', address: 'Taraimal Industrial Estate, Gharghoda Highway, Raigarh, Chhattisgarh 496107', lat: 22.0200, lng: 83.2700, category: 'Industrial Hub' },
  { name: 'Punjipathra Industrial Estate, Raigarh', address: 'Punjipathra Industrial Area, NH 49 / SH, Raigarh, Chhattisgarh 496107', lat: 22.0850, lng: 83.2950, category: 'Heavy Freight Area' },
  { name: 'Tamnar Coal Logistics Corridor, Raigarh', address: 'Tamnar Freight Route, Jindal Thermal Hub, Raigarh, Chhattisgarh 496108', lat: 22.1550, lng: 83.4500, category: 'Coal Logistics Hub' },
  { name: 'Gharghoda Transport Junction, Raigarh', address: 'Gharghoda Main Road, Raigarh District, Chhattisgarh 496111', lat: 22.1670, lng: 83.3450, category: 'Highway Junction' },
  { name: 'Kharsia Highway Bypass & Freight Yard', address: 'Kharsia NH 49 Bypass, Raigarh District, Chhattisgarh 496661', lat: 21.9980, lng: 83.1250, category: 'Highway Bypass' },
  { name: 'Sarangarh Road Bypass Chowk, Raigarh', address: 'Sarangarh Road Junction, Raigarh, Chhattisgarh 496001', lat: 21.8750, lng: 83.3790, category: 'Bypass Junction' },
  { name: 'Sanjay Complex & Bus Terminal, Raigarh', address: 'Sanjay Market, City Bus Terminal, Raigarh, Chhattisgarh 496001', lat: 21.8940, lng: 83.3910, category: 'Bus Terminal' },
  { name: 'Kewdabadi Bus Stand Road, Raigarh', address: 'Kewdabadi Main Road, Raigarh, Chhattisgarh 496001', lat: 21.8920, lng: 83.4050, category: 'Commercial Street' },
  { name: 'Chandni Chowk, Raigarh', address: 'Chandni Chowk, Near City Center, Raigarh, Chhattisgarh 496001', lat: 21.9010, lng: 83.3995, category: 'Commercial Chowk' },
  { name: 'Bhagwanpur Chowk & Industrial Area, Raigarh', address: 'Bhagwanpur Industrial Area, Raigarh, Chhattisgarh 496001', lat: 21.9150, lng: 83.3850, category: 'Industrial Area' },
  { name: 'Jagatpur & Kabir Chowk, Raigarh', address: 'Kabir Chowk, Jagatpur Road, Raigarh, Chhattisgarh 496001', lat: 21.8890, lng: 83.3980, category: 'Local Area' },
  { name: 'Dharamjaigarh State Highway Junction', address: 'Dharamjaigarh Main Road, Raigarh District, Chhattisgarh 496116', lat: 22.4680, lng: 83.1700, category: 'Logistics Link' },

  // --- RAIPUR COMPREHENSIVE LOCAL STREETS & HUBS ---
  { name: 'Tatibandh Chowk (GE Road), Raipur', address: 'Tatibandh Chowk, GE Road, Raipur, Chhattisgarh 492099', lat: 21.2580, lng: 81.5645, category: 'Major Highway Hub' },
  { name: 'Rawabhata Transport Nagar, Raipur', address: 'Rawabhata Transport Nagar, Bilaspur Road, Raipur, Chhattisgarh 493221', lat: 21.3250, lng: 81.6420, category: 'Logistics Hub' },
  { name: 'Urla Industrial Complex (Phase 1 & 2), Raipur', address: 'Urla Industrial Area, Raipur, Chhattisgarh 492003', lat: 21.3120, lng: 81.5890, category: 'Industrial Zone' },
  { name: 'Siltara Industrial Area (Phase 1 & 2), Raipur', address: 'Siltara Industrial Zone, NH 30, Raipur, Chhattisgarh 493111', lat: 21.3780, lng: 81.6850, category: 'Heavy Industrial Belt' },
  { name: 'Bhanpuri Logistics Bypass, Raipur', address: 'Bhanpuri Chowk, Ring Road 2, Raipur, Chhattisgarh 493221', lat: 21.2990, lng: 81.6400, category: 'Ring Road Bypass' },
  { name: 'Jaistambh Chowk & Malviya Road, Raipur', address: 'Jaistambh Chowk, Malviya Road, Raipur, Chhattisgarh 492001', lat: 21.2497, lng: 81.6300, category: 'City Center' },
  { name: 'Pandri Cloth Market & Bus Stand, Raipur', address: 'Pandri Commercial Complex, Raipur, Chhattisgarh 492004', lat: 21.2610, lng: 81.6520, category: 'Commercial Center' },
  { name: 'Telibandha / Marine Drive, Raipur', address: 'Telibandha Main Road, Raipur, Chhattisgarh 492006', lat: 21.2360, lng: 81.6700, category: 'Urban Hub' },
  { name: 'Naya Raipur (Atal Nagar) Sector 24', address: 'Sector 24, Atal Nagar, Naya Raipur, Chhattisgarh 492018', lat: 21.1610, lng: 81.7870, category: 'Government & Freight' },
  { name: 'Sarona AIIMS Chowk, Raipur', address: 'GE Road, Sarona, Raipur, Chhattisgarh 492099', lat: 21.2480, lng: 81.5810, category: 'Chowk' },

  // --- BILASPUR COMPREHENSIVE LOCAL STREETS & HUBS ---
  { name: 'Tifra Transport Nagar, Bilaspur', address: 'Transport Nagar, Tifra, Bilaspur, Chhattisgarh 495001', lat: 22.0620, lng: 82.1150, category: 'Logistics Hub' },
  { name: 'Vyapar Vihar Commercial Hub, Bilaspur', address: 'Vyapar Vihar Trade Complex, Bilaspur, Chhattisgarh 495004', lat: 22.0780, lng: 82.1480, category: 'Wholesale Trade Hub' },
  { name: 'Sirgitti Industrial Area, Bilaspur', address: 'Sirgitti Industrial Estate, Bilaspur, Chhattisgarh 495004', lat: 22.0350, lng: 82.1280, category: 'Industrial Zone' },
  { name: 'Bilaspur Railway Station Road (Torwa)', address: 'Railway Station Road, Torwa, Bilaspur, Chhattisgarh 495004', lat: 22.0750, lng: 82.1700, category: 'Transit Hub' },
  { name: 'Chakarbhatha Airport & Freight Zone, Bilaspur', address: 'Bilaspur Airport Road, Chakarbhatha, Chhattisgarh 495220', lat: 21.9880, lng: 82.1110, category: 'Airport & Cargo' },
  { name: 'Mangla Chowk & Ring Road 2, Bilaspur', address: 'Mangla Chowk, Ring Road 2, Bilaspur, Chhattisgarh 495001', lat: 22.0950, lng: 82.1250, category: 'Ring Road Chowk' },
  { name: 'High Court Bodri Area, Bilaspur', address: 'Raipur Road, Bodri, Bilaspur, Chhattisgarh 495220', lat: 22.0150, lng: 82.1200, category: 'Highway Link' },

  // --- DURG, BHILAI, KORBA & REGIONAL HUBS ---
  { name: 'Bhilai Steel Plant Main Gate (Sector 1)', address: 'BSP Main Gate, Sector 1, Bhilai, Chhattisgarh 490001', lat: 21.2050, lng: 81.3900, category: 'Heavy Industrial Plant' },
  { name: 'Hathkhoj Transport Nagar, Bhilai', address: 'Hathkhoj Industrial Estate, Bhilai, Chhattisgarh 490026', lat: 21.2350, lng: 81.3750, category: 'Logistics Hub' },
  { name: 'Durg Railway Station / Bus Stand Road', address: 'Station Road, Durg, Chhattisgarh 491001', lat: 21.1920, lng: 81.2820, category: 'Transit Hub' },
  { name: 'Korba Transport Nagar', address: 'Transport Nagar, Korba, Chhattisgarh 495677', lat: 22.3595, lng: 82.7501, category: 'Logistics Hub' },
  { name: 'BALCO Township & Smelter, Korba', address: 'Bharat Aluminium Co., Korba, Chhattisgarh 495684', lat: 22.4050, lng: 82.7650, category: 'Industrial Plant' },
  { name: 'NTPC Jamnipali Power Hub, Korba', address: 'NTPC Super Thermal, Jamnipali, Korba, Chhattisgarh 495450', lat: 22.3850, lng: 82.6850, category: 'Power Hub' },
  { name: 'Jharsuguda Industrial Corridor (Vedanta Gate)', address: 'Vedanta Smelter Road, Jharsuguda, Odisha 768201', lat: 21.8550, lng: 84.0050, category: 'Industrial Corridor' },
  { name: 'Sambalpur Ainthapali Bus Terminal & Bypass', address: 'Ainthapali Chowk, NH 53 Bypass, Sambalpur, Odisha 768004', lat: 21.4920, lng: 83.9850, category: 'Highway Bypass' },
  { name: 'Nagpur Wadi Transport Nagar', address: 'Wadi Transport Nagar, Amravati Road, Nagpur, Maharashtra 440023', lat: 21.1458, lng: 79.0182, category: 'Central Freight Hub' },
  { name: 'Mumbai CST Freight Depot', address: 'Fort, Mumbai, Maharashtra 400001', lat: 18.9401, lng: 72.8347, category: 'Freight Depot' },
  { name: 'Navi Mumbai APMC Terminal', address: 'APMC Market, Sector 19, Vashi, Navi Mumbai, Maharashtra 400703', lat: 19.0760, lng: 73.0077, category: 'Logistics Terminal' },
  { name: 'Delhi Sanjay Gandhi Transport Nagar (SGTN)', address: 'GT Karnal Road, SGTN, Delhi 110042', lat: 28.7490, lng: 77.1350, category: 'National Freight Hub' }
];

app.get('/api/locations/search', async (req, res) => {
  const query = (req.query.q || '').toString().trim();
  if (!query) {
    return res.json(LOCAL_AREAS_DATABASE.slice(0, 10));
  }

  const qLower = query.toLowerCase();
  const searchTokens = qLower.split(/[\s,]+/).filter(t => t.length > 0);
  const results = [];
  const seen = new Set();

  // Helper: Strict India Boundary and Identity Verification (Lat: 6.5 to 37.5, Lng: 68.0 to 97.5)
  const isStrictlyIndia = (lat, lng, country = '', countryCode = '') => {
    if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return false;
    // Bounding Box of India
    if (lat < 6.5 || lat > 37.5 || lng < 68.0 || lng > 97.5) return false;
    if (countryCode && countryCode.toLowerCase() !== 'in') return false;
    if (country) {
      const c = country.toLowerCase();
      // Must NOT be foreign country
      if (!c.includes('india') && !c.includes('bharat')) return false;
    }
    return true;
  };

  // 1. High-precision multi-token local street & area matching (Raigarh, Raipur, Bilaspur, Delhi, Mumbai, etc.)
  LOCAL_AREAS_DATABASE.forEach(hub => {
    const targetText = `${hub.name} ${hub.address} ${hub.category || ''}`.toLowerCase();
    
    const allTokensMatch = searchTokens.every(tok => targetText.includes(tok));
    const anyTokenMatch = searchTokens.some(tok => tok.length >= 3 && targetText.includes(tok));

    if (allTokensMatch || (searchTokens.length === 1 && anyTokenMatch)) {
      const key = `${hub.lat.toFixed(3)},${hub.lng.toFixed(3)}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(hub);
      }
    }
  });

  // 2. Parallel Search: Bounded Photon (India Bbox: 68.1,6.5,97.4,37.5) AND Nominatim (countrycodes=in)
  const [photonRes, nomRes] = await Promise.allSettled([
    // Photon with explicit India bbox
    fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&bbox=68.1,6.5,97.4,37.5&limit=10`, {
      headers: { 'User-Agent': 'GpsTrackX-Fleet-App/1.0' },
      signal: AbortSignal.timeout(2200)
    }).then(r => r.ok ? r.json() : null).catch(() => null),

    // Nominatim strictly filtered by countrycodes=in
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=10&countrycodes=in&addressdetails=1`, {
      headers: { 'User-Agent': 'GpsTrackX-Fleet-App/1.0 (contact@gpstrackx.com)' },
      signal: AbortSignal.timeout(2200)
    }).then(r => r.ok ? r.json() : null).catch(() => null)
  ]);

  // Process Photon results (with strict India filter)
  if (photonRes.status === 'fulfilled' && photonRes.value && photonRes.value.features) {
    photonRes.value.features.forEach(f => {
      const coords = f.geometry?.coordinates;
      if (!coords || coords.length < 2) return;
      const lat = parseFloat(coords[1].toFixed(6));
      const lng = parseFloat(coords[0].toFixed(6));
      const props = f.properties || {};

      if (!isStrictlyIndia(lat, lng, props.country, props.countrycode)) return;

      const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
      if (!seen.has(key)) {
        seen.add(key);
        const title = props.name || query;
        const contextParts = [props.street, props.district, props.city, props.state, 'India'].filter(Boolean);
        const address = contextParts.length > 0 ? contextParts.join(', ') : 'India';

        results.push({
          name: `${title}${props.city ? ', ' + props.city : (props.state ? ', ' + props.state : '')}`,
          address: address,
          lat,
          lng,
          category: props.osm_value || 'Locality'
        });
      }
    });
  }

  // Process Nominatim results (with strict India filter)
  if (nomRes.status === 'fulfilled' && Array.isArray(nomRes.value)) {
    nomRes.value.forEach(item => {
      const lat = parseFloat(parseFloat(item.lat).toFixed(6));
      const lng = parseFloat(parseFloat(item.lon).toFixed(6));
      const countryCode = item.address?.country_code || 'in';
      const country = item.address?.country || 'India';

      if (!isStrictlyIndia(lat, lng, country, countryCode)) return;

      const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
      if (!seen.has(key)) {
        seen.add(key);
        const parts = (item.display_name || '').split(',');
        const primaryName = parts[0].trim();
        const restAddress = parts.slice(1, 4).join(',').trim();

        results.push({
          name: primaryName,
          address: restAddress ? `${restAddress}, India` : (item.display_name || 'India'),
          lat,
          lng,
          category: item.type || 'Location'
        });
      }
    });
  }

  res.json(results.slice(0, 15));
});

// Calculate alternative routes (Admin Only)
app.post('/api/routes/calculate', authenticateToken, requireAdmin, async (req, res) => {
  const { origin, destination, waypoints = [], manualTolls = [] } = req.body;

  if (!origin || !destination || origin.lat == null || destination.lat == null) {
    return res.status(400).json({ error: 'Origin and Destination with valid latitude and longitude are required.' });
  }

  // Retrieve Google Maps API key from settings or environment
  const keySetting = db.prepare("SELECT value FROM settings WHERE key = 'google_maps_api_key'").get();
  const apiKey = (keySetting && keySetting.value) || process.env.GOOGLE_MAPS_API_KEY || '';

  try {
    const alternativeRoutes = await planAlternativeRoutes({
      origin,
      destination,
      waypoints,
      manualTolls,
      googleApiKey: apiKey
    });

    res.json({
      routes: alternativeRoutes,
      meta: {
        origin,
        destination,
        waypointsCount: waypoints.length,
        manualTollsCount: manualTolls.length,
        usedGoogleMapsKey: Boolean(apiKey && apiKey.trim())
      }
    });
  } catch (err) {
    console.error('[Route Calculate Error]', err);
    res.status(500).json({ error: 'Failed to calculate route: ' + err.message });
  }
});

// Save or Update Vehicle Route (Admin Only)
app.post('/api/routes', authenticateToken, requireAdmin, async (req, res) => {
  const {
    vehicle_id,
    assigned_user_id,
    route_name,
    start_location_name,
    start_address,
    start_lat,
    start_lng,
    end_location_name,
    end_address,
    end_lat,
    end_lng,
    total_distance_km,
    estimated_travel_time_min,
    overview_polyline,
    route_color,
    waypoints,
    toll_gates,
    alternative_routes,
    trip_date,
    end_trip_date,
    start_trip_time,
    end_trip_time,
    total_toll_fee,
    stoppages_count,
    toll_gates_count
  } = req.body;

  if (!vehicle_id || !start_location_name || !end_location_name) {
    return res.status(400).json({ error: 'Vehicle ID, Starting location, and Ending destination are required.' });
  }

  const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicle_id);
  if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

  const vehicleRegNo = vehicle.registration_no || `TRUCK-${vehicle_id}`;

  const waypointsJson = JSON.stringify(waypoints || []);
  const tollGatesJson = JSON.stringify(toll_gates || []);
  const altRoutesJson = JSON.stringify(alternative_routes || []);
  const polylineStr = typeof overview_polyline === 'string' ? overview_polyline : JSON.stringify(overview_polyline || []);

  const saveTx = db.transaction(() => {
    // If admin explicitly allots this vehicle to a specific driver/user, update vehicle assignment
    if (assigned_user_id) {
      db.prepare('UPDATE vehicles SET assigned_user_id = ? WHERE id = ?').run(parseInt(assigned_user_id), vehicle_id);
    }

    // Deactivate previous active routes for this vehicle
    db.prepare('UPDATE routes SET is_active = 0 WHERE vehicle_id = ?').run(vehicle_id);

    const insertRouteStmt = db.prepare(`
      INSERT INTO routes (
        vehicle_id, route_name, start_location_name, start_address, start_lat, start_lng,
        end_location_name, end_address, end_lat, end_lng, total_distance_km, estimated_travel_time_min,
        overview_polyline, route_color, waypoints_json, toll_gates_json, alternative_routes_json,
        trip_date, end_trip_date, start_trip_time, end_trip_time, total_toll_fee, stoppages_count, toll_gates_count, is_active,
        vehicle_registration_no
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);

    const result = insertRouteStmt.run(
      vehicle_id,
      route_name || `${start_location_name} to ${end_location_name}`,
      start_location_name,
      start_address || '',
      start_lat,
      start_lng,
      end_location_name,
      end_address || '',
      end_lat,
      end_lng,
      total_distance_km,
      estimated_travel_time_min,
      polylineStr,
      route_color || '#EF4444',
      waypointsJson,
      tollGatesJson,
      altRoutesJson,
      trip_date || new Date().toISOString().split('T')[0],
      end_trip_date || trip_date || new Date().toISOString().split('T')[0],
      start_trip_time || '08:00 AM',
      end_trip_time || '06:00 PM',
      Number(total_toll_fee) || 0,
      Number(stoppages_count) || (waypoints ? waypoints.length : 0),
      Number(toll_gates_count) || (toll_gates ? toll_gates.length : 0),
      vehicleRegNo
    );

    // Also mirror into saved_corridors permanently
    try {
      db.prepare(`
        INSERT OR IGNORE INTO saved_corridors (
          route_name, start_location_name, start_address, start_lat, start_lng,
          end_location_name, end_address, end_lat, end_lng,
          total_distance_km, estimated_travel_time_min,
          overview_polyline, waypoints_json, toll_gates_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        route_name || `${start_location_name} to ${end_location_name}`,
        start_location_name, start_address || '', start_lat, start_lng,
        end_location_name, end_address || '', end_lat, end_lng,
        total_distance_km || 0, estimated_travel_time_min || 0,
        polylineStr, waypointsJson, tollGatesJson
      );
    } catch (_) {}

    const routeId = result.lastInsertRowid;

    // Insert Stoppages
    if (waypoints && Array.isArray(waypoints)) {
      const stopStmt = db.prepare(`
        INSERT INTO stoppages (route_id, sequence_order, name, address, lat, lng, stop_duration_mins)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      waypoints.forEach((w, idx) => {
        stopStmt.run(routeId, idx + 1, w.name, w.address || '', w.lat, w.lng, w.duration || 15);
      });
    }

    // Insert Manual Tolls
    if (toll_gates && Array.isArray(toll_gates)) {
      const manualStmt = db.prepare(`
        INSERT INTO manual_toll_gates (route_id, name, lat, lng, charges, toll_type)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      toll_gates.forEach(t => {
        manualStmt.run(routeId, t.name, t.lat, t.lng, t.charges || 0, t.toll_type || 'FASTag ETC');
      });
    }

    // Auto-generate official FASTag Toll Debits & Tax Invoices for this commercial vehicle trip
    if (toll_gates && Array.isArray(toll_gates) && toll_gates.length > 0) {
      const fastagInsert = db.prepare(`
        INSERT INTO fastag_transactions (
          transaction_id, netc_reference_no, tag_id, vehicle_id, vehicle_registration_no,
          vehicle_class, route_id, toll_plaza_name, highway_name, lat, lng,
          amount, base_toll_fee, gst_amount, concessionaire_name, gstin,
          lane_direction, payment_status, crossing_time, wallet_balance_before, wallet_balance_after
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let currentWalletBal = 25000.0;
      const tagId = fastagService.generateTagId(vehicleRegNo);

      toll_gates.forEach((tg, idx) => {
        const tariff = fastagService.getTruckTollTariff(tg.lat, tg.lng, tg.name);
        const amount = tg.charges && tg.charges > 0 ? tg.charges : tariff.truckRate;
        const offsetMins = (idx + 1) * 45;
        const crossingTime = fastagService.formatCrossingTimestamp(trip_date, start_trip_time, offsetMins);
        const txnId = fastagService.generateTransactionId(crossingTime);
        const netcRef = fastagService.generateNetcReference(crossingTime);
        const balBefore = currentWalletBal;
        currentWalletBal = Math.max(0, currentWalletBal - amount);

        fastagInsert.run(
          txnId,
          netcRef,
          tagId,
          vehicle_id,
          vehicleRegNo,
          'Commercial Truck (HCV / 3-Axle Truck)',
          routeId,
          tariff.officialName,
          tariff.highway,
          Number(tg.lat || 0),
          Number(tg.lng || 0),
          amount,
          amount,
          0,
          tariff.concessionaire,
          tariff.gstin,
          `Lane 0${(idx % 4) + 1} - Dedicated FASTag ETC`,
          'SUCCESS',
          crossingTime,
          balBefore,
          currentWalletBal
        );
      });
    }

    // Update vehicle's coordinates, times, tolls, stoppages, and status
    db.prepare(`
      UPDATE vehicles SET 
        current_lat = ?, 
        current_lng = ?, 
        status = 'moving',
        current_speed = 62.0,
        start_trip_time = ?,
        end_trip_time = ?,
        total_toll_fee = ?,
        stoppages_count = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      start_lat,
      start_lng,
      start_trip_time || '08:00 AM',
      end_trip_time || '06:00 PM',
      Number(total_toll_fee) || 0,
      Number(stoppages_count) || (waypoints ? waypoints.length : 0),
      vehicle_id
    );

    return routeId;
  });

  try {
    const newRouteId = saveTx();
    const savedRoute = db.prepare('SELECT * FROM routes WHERE id = ?').get(newRouteId);
    if (savedRoute) {
      try {
        await supabaseService.query('UPDATE routes SET is_active = 0 WHERE vehicle_id = $1', [vehicle_id]);
      } catch (e) {}
      supabaseService.syncRoute(savedRoute);

      const targetVehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicle_id);
      if (targetVehicle) {
        supabaseService.syncVehicle(targetVehicle);

        const assignedUserId = assigned_user_id ? parseInt(assigned_user_id) : targetVehicle.assigned_user_id;
        if (assignedUserId) {
          db.prepare(`
            INSERT INTO vehicle_allocations (vehicle_id, user_id, allocated_by, route_id, allocation_status, notes)
            VALUES (?, ?, ?, ?, 'ACTIVE', 'Admin allocated vehicle and route corridor')
          `).run(vehicle_id, assignedUserId, req.user.id, newRouteId);

          supabaseService.syncVehicleAllocation({
            vehicle_id,
            user_id: assignedUserId,
            allocated_by: req.user.id,
            route_id: newRouteId,
            allocation_status: 'ACTIVE',
            notes: 'Admin allocated vehicle and route corridor'
          });
        }
      }

      // Sync generated FASTag transactions for this route to live Supabase Cloud
      const routeTxs = db.prepare('SELECT * FROM fastag_transactions WHERE route_id = ?').all(newRouteId);
      for (const tx of routeTxs) {
        supabaseService.syncFastagTransaction(tx);
      }
    }

    res.status(201).json({
      message: 'Route saved and assigned to vehicle successfully.',
      route: savedRoute
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save route: ' + err.message });
  }
});

// Delete Route (Admin Only)
app.delete('/api/routes/:id', authenticateToken, requireAdmin, async (req, res) => {
  const routeId = req.params.id;
  try {
    db.prepare('DELETE FROM stoppages WHERE route_id = ?').run(routeId);
    db.prepare('DELETE FROM manual_toll_gates WHERE route_id = ?').run(routeId);
    db.prepare('DELETE FROM routes WHERE id = ?').run(routeId);
    await supabaseService.deleteRoute(routeId);
    res.json({ message: 'Route deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete route: ' + err.message });
  }
});

// Get Previously Saved / Existing Corridors Across ALL Users and Vehicles
app.get('/api/routes/saved-corridors', authenticateToken, (req, res) => {
  try {
    let dedicatedCorridors = [];
    try {
      dedicatedCorridors = db.prepare(`
        SELECT 
          id, 
          route_name, 
          start_location_name, 
          start_address, 
          start_lat, 
          start_lng, 
          end_location_name, 
          end_address, 
          end_lat, 
          end_lng, 
          total_distance_km, 
          estimated_travel_time_min, 
          overview_polyline, 
          waypoints_json, 
          toll_gates_json, 
          alternative_routes_json,
          created_at
        FROM saved_corridors
        ORDER BY id DESC
      `).all();
    } catch (e) {}

    const routesCorridors = db.prepare(`
      SELECT 
        r.id, 
        r.vehicle_id,
        r.route_name, 
        r.start_location_name, 
        r.start_address, 
        r.start_lat, 
        r.start_lng, 
        r.end_location_name, 
        r.end_address, 
        r.end_lat, 
        r.end_lng, 
        r.total_distance_km, 
        r.estimated_travel_time_min, 
        r.overview_polyline, 
        r.waypoints_json, 
        r.toll_gates_json, 
        r.alternative_routes_json,
        r.trip_date, 
        r.start_trip_time, 
        r.end_trip_time,
        r.total_toll_fee,
        r.stoppages_count,
        r.toll_gates_count,
        r.created_at,
        COALESCE(v.registration_no, r.vehicle_registration_no, 'Saved Route') as vehicle_registration_no,
        COALESCE(v.name_model, 'Saved Vehicle') as vehicle_name_model,
        u.id as user_id,
        u.name as user_name,
        u.email as user_email
      FROM routes r
      LEFT JOIN vehicles v ON r.vehicle_id = v.id
      LEFT JOIN users u ON v.assigned_user_id = u.id
      ORDER BY r.id DESC
    `).all();

    const sanitizeTolls = (rawTg) => {
      let list = [];
      try {
        const parsed = typeof rawTg === 'string' ? JSON.parse(rawTg) : rawTg;
        if (Array.isArray(parsed)) {
          const seen = new Set();
          for (const t of parsed) {
            const k = `${t.name || ''}_${Number(t.lat || 0).toFixed(4)}_${Number(t.lng || 0).toFixed(4)}`;
            if (!seen.has(k)) {
              seen.add(k);
              list.push(t);
            }
          }
        }
      } catch (_) {}
      return list;
    };

    const combined = [];
    const seenKeys = new Set();

    for (const c of dedicatedCorridors) {
      const k = `dedicated_${c.id}_${(c.route_name || '').toLowerCase()}`;
      if (!seenKeys.has(k)) {
        seenKeys.add(k);
        let wp = [];
        try { if (c.waypoints_json) wp = typeof c.waypoints_json === 'string' ? JSON.parse(c.waypoints_json) : c.waypoints_json; } catch (_) {}
        const tg = sanitizeTolls(c.toll_gates_json);
        combined.push({ ...c, waypoints: wp, toll_gates: tg });
      }
    }

    for (const r of routesCorridors) {
      const rName = (r.route_name || '').trim();
      const k = `route_${r.id}_${rName.toLowerCase()}_${r.vehicle_id || ''}`;
      if (!seenKeys.has(k)) {
        seenKeys.add(k);
        let wp = [];
        try { if (r.waypoints_json) wp = typeof r.waypoints_json === 'string' ? JSON.parse(r.waypoints_json) : r.waypoints_json; } catch (_) {}
        const tg = sanitizeTolls(r.toll_gates_json);
        combined.push({ ...r, waypoints: wp, toll_gates: tg });
      }
    }

    res.json(combined);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch saved corridors: ' + err.message });
  }
});

// Get all trips recorded across ALL users and ALL vehicles (For Admin)
app.get('/api/trips/all', authenticateToken, requireAdmin, (req, res) => {
  try {
    const trips = db.prepare(`
      SELECT 
        r.*,
        COALESCE(v.registration_no, r.vehicle_registration_no, 'Saved Route') as vehicle_registration_no,
        COALESCE(v.name_model, 'Saved Vehicle') as vehicle_name_model,
        u.id as user_id,
        u.name as user_name,
        u.email as user_email
      FROM routes r
      LEFT JOIN vehicles v ON r.vehicle_id = v.id
      LEFT JOIN users u ON v.assigned_user_id = u.id
      ORDER BY r.id DESC
    `).all();

    const formatted = trips.map(t => {
      let waypoints = [];
      try { if (t.waypoints_json) waypoints = typeof t.waypoints_json === 'string' ? JSON.parse(t.waypoints_json) : t.waypoints_json; } catch (_) {}
      let toll_gates = [];
      try { if (t.toll_gates_json) toll_gates = typeof t.toll_gates_json === 'string' ? JSON.parse(t.toll_gates_json) : t.toll_gates_json; } catch (_) {}
      return {
        ...t,
        waypoints: Array.isArray(waypoints) ? waypoints : [],
        toll_gates: Array.isArray(toll_gates) ? toll_gates : []
      };
    });

    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch all trips: ' + err.message });
  }
});

// ---------------- VEHICLE & ROUTE ALLOCATION FLOW ENDPOINTS ---------------- //

// Comprehensive Allocation Flow (Admin sees all, User sees their own)
app.get('/api/allocations', authenticateToken, (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const { status, search } = req.query;

  let conditions = [];
  let params = [];

  if (!isAdmin) {
    conditions.push('va.user_id = ?');
    params.push(req.user.id);
  }

  if (status && status !== 'all') {
    conditions.push('va.allocation_status = ?');
    params.push(status);
  }

  if (search && search.trim() !== '') {
    conditions.push('(v.registration_no LIKE ? OR u.name LIKE ? OR r.route_name LIKE ?)');
    const term = `%${search.trim()}%`;
    params.push(term, term, term);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const allocations = db.prepare(`
    SELECT 
      va.id as allocation_id,
      va.allocation_status,
      va.notes,
      va.allocated_at,
      va.updated_at,
      -- Vehicle Details
      v.id as vehicle_id,
      v.registration_no,
      v.name_model,
      v.vehicle_type,
      v.device_id,
      v.status as vehicle_status,
      v.current_speed,
      v.current_lat,
      v.current_lng,
      v.odometer_km,
      -- Driver / User Details
      u.id as driver_id,
      u.name as driver_name,
      u.email as driver_email,
      u.phone as driver_phone,
      u.role as driver_role,
      -- Route Details
      r.id as route_id,
      r.route_name,
      r.start_location_name,
      r.end_location_name,
      r.start_lat,
      r.start_lng,
      r.end_lat,
      r.end_lng,
      r.overview_polyline,
      r.toll_gates_json,
      r.total_distance_km,
      r.estimated_travel_time_min,
      r.trip_date,
      r.end_trip_date,
      r.start_trip_time,
      r.end_trip_time,
      r.is_active as route_is_active,
      -- FASTag Toll debits along this route
      (SELECT COUNT(*) FROM fastag_transactions ft WHERE ft.route_id = r.id) as fastag_plazas_count,
      (SELECT COALESCE(SUM(ft.amount), 0) FROM fastag_transactions ft WHERE ft.route_id = r.id) as total_toll_charges,
      -- Admin Allocator
      admin_u.name as allocated_by_name
    FROM vehicle_allocations va
    JOIN vehicles v ON va.vehicle_id = v.id
    JOIN users u ON va.user_id = u.id
    LEFT JOIN routes r ON va.route_id = r.id
    LEFT JOIN users admin_u ON va.allocated_by = admin_u.id
    ${whereClause}
    ORDER BY va.id DESC
  `).all(...params);

  res.json(allocations);
});

// Single Driver Active Allocation Endpoint (For Driver Mobile/Desktop Dashboard)
app.get('/api/allocations/my', authenticateToken, (req, res) => {
  const allocation = db.prepare(`
    SELECT 
      va.id as allocation_id,
      va.allocation_status,
      va.notes,
      va.allocated_at,
      v.id as vehicle_id,
      v.registration_no,
      v.name_model,
      v.vehicle_type,
      v.device_id,
      v.status as vehicle_status,
      v.current_speed,
      v.current_lat,
      v.current_lng,
      v.odometer_km,
      r.id as route_id,
      r.route_name,
      r.start_location_name,
      r.start_address,
      r.end_location_name,
      r.end_address,
      r.total_distance_km,
      r.estimated_travel_time_min,
      r.overview_polyline,
      r.waypoints_json,
      r.toll_gates_json,
      r.trip_date,
      r.end_trip_date,
      r.start_trip_time,
      r.end_trip_time
    FROM vehicle_allocations va
    JOIN vehicles v ON va.vehicle_id = v.id
    LEFT JOIN routes r ON (va.route_id = r.id OR (v.id = r.vehicle_id AND r.is_active = 1))
    WHERE va.user_id = ? AND va.allocation_status = 'ACTIVE'
    ORDER BY va.id DESC
    LIMIT 1
  `).get(req.user.id);

  if (!allocation) {
    return res.json({ allocated: false, message: 'No vehicle or route currently assigned by fleet administrator.' });
  }

  // Fetch FASTag toll transactions for this vehicle/route
  const tolls = db.prepare(`
    SELECT * FROM fastag_transactions 
    WHERE vehicle_id = ? OR route_id = ?
    ORDER BY id ASC
  `).all(allocation.vehicle_id, allocation.route_id || 0);

  res.json({
    allocated: true,
    allocation: {
      ...allocation,
      waypoints: JSON.parse(allocation.waypoints_json || '[]'),
      toll_gates: JSON.parse(allocation.toll_gates_json || '[]'),
      tolls
    }
  });
});

// ---------------- FASTAG TOLL TRANSACTIONS & BILLING ROUTES ---------------- //

// 1. Get All FASTag Transactions & Invoices (with Filters & Summary Stats)
app.get('/api/fastag/transactions', authenticateToken, (req, res) => {
  const { vehicle_id, search, date } = req.query;
  const isAdmin = req.user.role === 'admin';

  let conditions = [];
  let params = [];

  // RBAC: Non-admin users see transactions for vehicles assigned or allocated to them
  if (!isAdmin) {
    conditions.push(`(
      ft.vehicle_id IN (SELECT id FROM vehicles WHERE assigned_user_id = ?)
      OR ft.vehicle_id IN (SELECT vehicle_id FROM vehicle_allocations WHERE user_id = ?)
      OR ft.route_id IN (SELECT route_id FROM vehicle_allocations WHERE user_id = ? AND route_id IS NOT NULL)
      OR ft.route_id IN (SELECT r.id FROM routes r JOIN vehicles v ON r.vehicle_id = v.id WHERE v.assigned_user_id = ?)
    )`);
    params.push(req.user.id, req.user.id, req.user.id, req.user.id);
  }

  if (vehicle_id && vehicle_id !== 'all') {
    conditions.push('ft.vehicle_id = ?');
    params.push(Number(vehicle_id));
  }

  if (search && search.trim() !== '') {
    const q = `%${search.trim()}%`;
    conditions.push(`(
      ft.toll_plaza_name LIKE ? OR 
      ft.highway_name LIKE ? OR 
      ft.transaction_id LIKE ? OR 
      ft.netc_reference_no LIKE ? OR 
      ft.vehicle_registration_no LIKE ?
    )`);
    params.push(q, q, q, q, q);
  }

  if (date && date.trim() !== '') {
    conditions.push("date(ft.crossing_time) = date(?)");
    params.push(date.trim());
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const sql = `
      SELECT 
        ft.*,
        r.route_name,
        r.trip_date as route_trip_date,
        v.name_model as vehicle_model,
        v.vehicle_type,
        u.name as driver_name,
        u.phone as driver_phone
      FROM fastag_transactions ft
      LEFT JOIN vehicles v ON ft.vehicle_id = v.id
      LEFT JOIN routes r ON ft.route_id = r.id
      LEFT JOIN users u ON v.assigned_user_id = u.id
      ${whereClause}
      ORDER BY ft.crossing_time DESC, ft.id DESC
    `;

    let transactions = db.prepare(sql).all(...params);

    // Self-healing: If no transactions found but routes exist with tolls in toll_gates_json, auto-generate them!
    if (transactions.length === 0 && (!search || search.trim() === '') && (!date || date.trim() === '')) {
      const routesWithTolls = db.prepare("SELECT * FROM routes WHERE toll_gates_json IS NOT NULL AND toll_gates_json != '[]'").all();
      for (const r of routesWithTolls) {
        try {
          const tolls = JSON.parse(r.toll_gates_json || '[]');
          if (Array.isArray(tolls) && tolls.length > 0) {
            const veh = db.prepare('SELECT registration_no FROM vehicles WHERE id = ?').get(r.vehicle_id);
            const regNo = veh?.registration_no || `TRUCK-${r.vehicle_id || 1}`;
            const fastagInsert = db.prepare(`
              INSERT INTO fastag_transactions (
                transaction_id, netc_reference_no, tag_id, vehicle_id, vehicle_registration_no,
                vehicle_class, route_id, toll_plaza_name, highway_name, lat, lng,
                amount, base_toll_fee, gst_amount, concessionaire_name, gstin,
                lane_direction, payment_status, crossing_time, wallet_balance_before, wallet_balance_after
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            tolls.forEach((tg, idx) => {
              const fee = Number(tg.charges) || 170;
              const txnId = `TXN-FTG-${Date.now()}-${idx + 1}-${r.id}`;
              const netcRef = `NETC${Date.now()}${idx + 1}`;
              const tagId = `607418-TAG-${regNo.replace(/[^A-Za-z0-9]/g, '')}`;
              const crossingTime = r.trip_date ? `${r.trip_date}T${r.start_trip_time || '08:00'}:00.000Z` : new Date().toISOString();
              fastagInsert.run(
                txnId, netcRef, tagId, r.vehicle_id, regNo,
                'Commercial Truck (HCV / 3-Axle Truck)', r.id, tg.name || `NH Toll Plaza #${idx + 1}`,
                'National Highway FASTag Corridor', Number(tg.lat || 0), Number(tg.lng || 0),
                fee, fee, 0, 'National Highways Authority of India (NHAI)', '22AAACN0123M1Z5',
                `Lane 0${(idx % 4) + 1} - Dedicated FASTag ETC`, 'SUCCESS',
                crossingTime, 25000 - (idx * fee), 25000 - ((idx + 1) * fee)
              );
            });
          }
        } catch (e) {}
      }
      transactions = db.prepare(sql).all(...params);
    }

    // Compute Summary Stats
    const totalSpent = transactions.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
    const totalTolls = transactions.length;
    const uniqueVehicles = new Set(transactions.map(t => t.vehicle_id).filter(Boolean)).size;

    // Latest wallet balance from recent debit, or default commercial wallet
    const latestTx = transactions[0];
    const activeWalletBalance = latestTx?.wallet_balance_after ?? 18450.0;

    res.json({
      transactions,
      stats: {
        totalSpent,
        totalTolls,
        uniqueVehicles,
        activeWalletBalance
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve FASTag transactions: ' + err.message });
  }
});

// 2. Get Single FASTag Transaction / Tax Invoice Detail
app.get('/api/fastag/transactions/:id', authenticateToken, (req, res) => {
  try {
    const tx = db.prepare(`
      SELECT 
        ft.*,
        v.name_model as vehicle_model,
        v.chassis_number,
        v.imei_number,
        u.name as driver_name,
        u.phone as driver_phone
      FROM fastag_transactions ft
      LEFT JOIN vehicles v ON ft.vehicle_id = v.id
      LEFT JOIN users u ON v.assigned_user_id = u.id
      WHERE ft.id = ?
    `).get(req.params.id);

    if (!tx) {
      return res.status(404).json({ error: 'FASTag transaction not found.' });
    }

    res.json(tx);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load transaction: ' + err.message });
  }
});

// 3. Create Manual FASTag Toll Bill / Transaction
app.post('/api/fastag/transactions', authenticateToken, async (req, res) => {
  const {
    vehicle_id,
    toll_plaza_name,
    highway_name,
    lat,
    lng,
    amount,
    crossing_time,
    lane_direction
  } = req.body;

  if (!vehicle_id || !toll_plaza_name || lat === undefined || lng === undefined) {
    return res.status(400).json({ error: 'Vehicle, Toll Plaza Name, and valid GPS coordinates (lat, lng) are required.' });
  }

  const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicle_id);
  if (!vehicle) {
    return res.status(404).json({ error: 'Vehicle not found.' });
  }

  try {
    // Resolve official truck toll tariff & highway if not specified
    const tariff = fastagService.getTruckTollTariff(lat, lng, toll_plaza_name);
    const finalAmount = amount && Number(amount) > 0 ? Number(amount) : tariff.truckRate;
    const finalHighway = highway_name && highway_name.trim() !== '' ? highway_name : tariff.highway;
    const finalTime = crossing_time || new Date().toISOString().replace('T', ' ').substring(0, 19);

    const txnId = fastagService.generateTransactionId(finalTime);
    const netcRef = fastagService.generateNetcReference(finalTime);
    const tagId = fastagService.generateTagId(vehicle.registration_no);

    // Get previous wallet balance
    const lastTx = db.prepare('SELECT wallet_balance_after FROM fastag_transactions WHERE vehicle_id = ? ORDER BY id DESC LIMIT 1').get(vehicle_id);
    const balBefore = lastTx?.wallet_balance_after ?? 15000.0;
    const balAfter = Math.max(0, balBefore - finalAmount);

    const result = db.prepare(`
      INSERT INTO fastag_transactions (
        transaction_id, netc_reference_no, tag_id, vehicle_id, vehicle_registration_no,
        vehicle_class, route_id, toll_plaza_name, highway_name, lat, lng,
        amount, base_toll_fee, gst_amount, concessionaire_name, gstin,
        lane_direction, payment_status, crossing_time, wallet_balance_before, wallet_balance_after
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      txnId,
      netcRef,
      tagId,
      vehicle_id,
      vehicle.registration_no,
      'Commercial Truck (HCV / 3-Axle Truck)',
      null,
      tariff.officialName,
      finalHighway,
      Number(lat),
      Number(lng),
      finalAmount,
      finalAmount,
      0, // Exempt GST on National Highways
      tariff.concessionaire,
      tariff.gstin,
      lane_direction || 'Lane 04 - Dedicated FASTag ETC',
      'SUCCESS',
      finalTime,
      balBefore,
      balAfter
    );

    const newTx = db.prepare('SELECT * FROM fastag_transactions WHERE id = ?').get(result.lastInsertRowid);
    if (newTx) {
      try {
        await supabaseService.syncFastagTransaction(newTx);
      } catch (e) {
        console.error('[FASTag Sync to Supabase Error]:', e.message);
      }
    }
    res.status(201).json({
      message: 'FASTag toll transaction & tax invoice created successfully.',
      transaction: newTx
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create FASTag transaction: ' + err.message });
  }
});

// 4. Delete FASTag Transaction (Admin Only)
app.delete('/api/fastag/transactions/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const tx = db.prepare('SELECT transaction_id FROM fastag_transactions WHERE id = ?').get(req.params.id);
    db.prepare('DELETE FROM fastag_transactions WHERE id = ?').run(req.params.id);
    if (tx?.transaction_id) {
      await supabaseService.query('DELETE FROM fastag_transactions WHERE transaction_id = $1', [tx.transaction_id]);
    }
    res.json({ message: 'FASTag transaction deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete transaction: ' + err.message });
  }
});

// 5. Estimate Truck Toll Tariff for Given Coordinates
app.post('/api/fastag/estimate', authenticateToken, (req, res) => {
  const { lat, lng, plaza_name } = req.body;
  try {
    const tariff = fastagService.getTruckTollTariff(lat, lng, plaza_name);
    res.json(tariff);
  } catch (err) {
    res.status(500).json({ error: 'Failed to estimate toll tariff: ' + err.message });
  }
});

// ---------------- SETTINGS ROUTES ---------------- //

app.get('/api/settings', authenticateToken, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settingsObj = {};
  rows.forEach(r => {
    // Mask API key for non-admins
    if (r.key === 'google_maps_api_key' && req.user.role !== 'admin') {
      settingsObj[r.key] = r.value ? '••••••••••••••••' : '';
    } else {
      settingsObj[r.key] = r.value;
    }
  });
  res.json(settingsObj);
});

app.post('/api/settings', authenticateToken, requireAdmin, (req, res) => {
  const { google_maps_api_key, fleet_company_name, speed_alert_threshold } = req.body;
  const updateStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

  if (google_maps_api_key !== undefined) {
    updateStmt.run('google_maps_api_key', google_maps_api_key.trim());
  }
  if (fleet_company_name !== undefined) {
    updateStmt.run('fleet_company_name', fleet_company_name.trim());
  }
  if (speed_alert_threshold !== undefined) {
    updateStmt.run('speed_alert_threshold', speed_alert_threshold.toString());
  }

  res.json({ message: 'Settings updated successfully' });
});

// ---------------- GLOBAL SEARCH ENDPOINT ---------------- //
// Searches across all system entities: Vehicles, Routes, Users, and Pages
app.get('/api/search', authenticateToken, (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) {
    return res.json({ vehicles: [], routes: [], users: [], pages: [], total: 0 });
  }

  const queryPattern = `%${q}%`;

  try {
    // 1. Vehicles
    const vehicles = db.prepare(`
      SELECT v.id, v.registration_no, v.name_model, v.vehicle_type, v.status, v.current_speed, u.name as driver_name
      FROM vehicles v
      LEFT JOIN users u ON v.assigned_user_id = u.id
      WHERE v.registration_no LIKE ? OR v.name_model LIKE ? OR v.vehicle_type LIKE ? OR v.status LIKE ? OR u.name LIKE ?
      LIMIT 8
    `).all(queryPattern, queryPattern, queryPattern, queryPattern, queryPattern);

    // 2. Routes
    const routes = db.prepare(`
      SELECT r.id, r.vehicle_id, r.route_name, r.start_location_name, r.end_location_name, r.total_distance_km, r.estimated_travel_time_min, v.registration_no
      FROM routes r
      LEFT JOIN vehicles v ON r.vehicle_id = v.id
      WHERE r.route_name LIKE ? OR r.start_location_name LIKE ? OR r.end_location_name LIKE ? OR r.start_address LIKE ? OR r.end_address LIKE ?
      LIMIT 8
    `).all(queryPattern, queryPattern, queryPattern, queryPattern, queryPattern);

    const isAdmin = req.user?.role === 'admin';

    // 3. Users (Admin Only)
    const users = isAdmin ? db.prepare(`
      SELECT id, name, email, phone, role, status, avatar_color
      FROM users
      WHERE name LIKE ? OR email LIKE ? OR phone LIKE ? OR role LIKE ?
      LIMIT 8
    `).all(queryPattern, queryPattern, queryPattern, queryPattern) : [];

    // 4. FASTag Toll Invoices & Debits
    const fastag = db.prepare(`
      SELECT id, transaction_id, netc_reference_no, toll_plaza_name, highway_name, amount, vehicle_registration_no, crossing_time
      FROM fastag_transactions
      WHERE toll_plaza_name LIKE ? OR highway_name LIKE ? OR transaction_id LIKE ? OR netc_reference_no LIKE ? OR vehicle_registration_no LIKE ?
      LIMIT 8
    `).all(queryPattern, queryPattern, queryPattern, queryPattern, queryPattern);

    // 5. System Pages (Role-bounded to prevent any admin route planner leaks)
    const adminPages = [
      { title: 'Live User View', tab: 'vehicle-tracking', desc: 'Live user tracking and vehicle monitoring' },
      { title: 'Users', tab: 'users', desc: 'User accounts and assignments' },
      { title: 'Vehicles', tab: 'vehicles', desc: 'All registered fleet vehicles and GPS tracking' },
      { title: 'Route Planner', tab: 'routes', desc: 'Plan routes on Google Maps with tolls & stops' },
      { title: 'FASTag Tolls', tab: 'fastag', desc: 'Electronic toll collection bills, truck tariffs & tax invoices' },
      { title: 'Fleet Settings', tab: 'settings', desc: 'System configuration, Google Maps API key & preferences' }
    ];

    const userPages = [
      { title: 'Dashboard', tab: 'dashboard', desc: 'Fleet overview and assigned vehicle status' },
      { title: 'Live Tracking', tab: 'vehicle-tracking', desc: 'Real-time vehicle map tracking and telematics' },
      { title: 'Trip History', tab: 'history', desc: 'Date-wise vehicle journey logs and trips' },
      { title: 'FASTag Tolls', tab: 'fastag', desc: 'Electronic toll collection bills & invoices' }
    ];

    const systemPages = isAdmin ? adminPages : userPages;

    const qLower = q.toLowerCase();
    const pages = systemPages.filter(p => 
      p.title.toLowerCase().includes(qLower) || p.desc.toLowerCase().includes(qLower)
    );

    const total = vehicles.length + routes.length + users.length + fastag.length + pages.length;

    res.json({
      query: q,
      vehicles,
      routes,
      users,
      fastag,
      pages,
      total
    });
  } catch (err) {
    console.error('[Search API Error]', err);
    res.status(500).json({ error: 'Search failed: ' + err.message });
  }
});

// ---------------- LIVE SIMULATION TICK ---------------- //
// Moves moving vehicles slightly along their route so live map tracking feels genuinely alive!
setInterval(() => {
  try {
    const movingVehicles = db.prepare(`
      SELECT v.id, v.current_lat, v.current_lng, v.current_speed, r.overview_polyline
      FROM vehicles v
      JOIN routes r ON v.id = r.vehicle_id AND r.is_active = 1
      WHERE v.status = 'moving'
    `).all();

    for (const veh of movingVehicles) {
      if (!veh.overview_polyline) continue;
      try {
        let coords = JSON.parse(veh.overview_polyline);
        if (Array.isArray(coords) && coords.length > 1) {
          // Find closest coordinate index
          let closestIdx = 0;
          let minDist = Infinity;
          for (let i = 0; i < coords.length; i++) {
            const d = (coords[i][0] - veh.current_lat) ** 2 + (coords[i][1] - veh.current_lng) ** 2;
            if (d < minDist) {
              minDist = d;
              closestIdx = i;
            }
          }
          // Progress to next point
          const nextIdx = (closestIdx + 1) % coords.length;
          const nextPoint = coords[nextIdx];
          const newSpeed = Math.floor(48 + Math.random() * 26); // 48 - 74 km/h

          db.prepare(`
            UPDATE vehicles SET
              current_lat = ?,
              current_lng = ?,
              current_speed = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(nextPoint[0], nextPoint[1], newSpeed, veh.id);
        }
      } catch (e) {
        // polyline parse error
      }
    }
  } catch (err) {
    // background loop error
  }
}, 15000); // update every 15 seconds

// SPA Catch-all: send index.html if frontend dist exists
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  const indexPath = path.join(__dirname, '../frontend/dist/index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  res.status(200).json({ status: 'ok', service: 'GpsTrackX Backend API' });
});

// Start Server - bind to 0.0.0.0 for Cloud containers (Render / Railway)
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`[GpsTrackX Server] Running on http://0.0.0.0:${PORT}`);
  // Hydrate persistent cloud data from Supabase into SQLite on boot
  try {
    await supabaseService.syncFromSupabaseToSqlite(db);
  } catch (err) {
    console.error('[Startup Hydration Warning]:', err.message);
  }
});
