const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'fleet.db');
const db = new Database(dbPath);


  // 6. Saved Corridors / Excel Imported Routes Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_corridors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_name TEXT NOT NULL,
      start_location_name TEXT NOT NULL,
      start_address TEXT,
      start_lat REAL NOT NULL,
      start_lng REAL NOT NULL,
      end_location_name TEXT NOT NULL,
      end_address TEXT,
      end_lat REAL NOT NULL,
      end_lng REAL NOT NULL,
      total_distance_km REAL DEFAULT 0,
      estimated_travel_time_min INTEGER DEFAULT 0,
      overview_polyline TEXT,
      waypoints_json TEXT DEFAULT '[]',
      toll_gates_json TEXT DEFAULT '[]',
      alternative_routes_json TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

// Enable foreign keys and WAL mode for high performance
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

function initializeDatabase() {
  // 1. Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      password TEXT NOT NULL,
      phone TEXT,
      role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user')),
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
      avatar_color TEXT DEFAULT '#EF4444',
      company_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. Vehicles table
  db.exec(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      registration_no TEXT UNIQUE NOT NULL,
      name_model TEXT NOT NULL,
      vehicle_type TEXT NOT NULL,
      device_id TEXT,
      imei_number TEXT,
      chassis_number TEXT,
      fuel_type TEXT DEFAULT 'Diesel',
      assigned_user_id INTEGER,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'moving', 'stopped', 'stop', 'parking')),
      current_speed REAL DEFAULT 0,
      max_speed_limit REAL DEFAULT 80,
      current_lat REAL,
      current_lng REAL,
      odometer_km REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  // 3. Routes table
  db.exec(`
    CREATE TABLE IF NOT EXISTS routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER,
      route_name TEXT NOT NULL,
      start_location_name TEXT NOT NULL,
      start_address TEXT NOT NULL,
      start_lat REAL NOT NULL,
      start_lng REAL NOT NULL,
      end_location_name TEXT NOT NULL,
      end_address TEXT NOT NULL,
      end_lat REAL NOT NULL,
      end_lng REAL NOT NULL,
      total_distance_km REAL NOT NULL,
      estimated_travel_time_min INTEGER NOT NULL,
      overview_polyline TEXT,
      route_color TEXT DEFAULT '#EF4444',
      waypoints_json TEXT DEFAULT '[]',
      toll_gates_json TEXT DEFAULT '[]',
      alternative_routes_json TEXT DEFAULT '[]',
      trip_date TEXT,
      end_trip_date TEXT,
      start_trip_time TEXT,
      end_trip_time TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
    );
  `);

  // Ensure migration columns exist in users table
  try {
    const userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
    if (!userCols.includes('company_name')) {
      db.exec('ALTER TABLE users ADD COLUMN company_name TEXT');
    }
  } catch (e) {}

  // Ensure migration columns exist in vehicles table
  try {
    const vehCols = db.prepare('PRAGMA table_info(vehicles)').all().map(c => c.name);
    if (!vehCols.includes('axle_type')) {
      db.exec("ALTER TABLE vehicles ADD COLUMN axle_type TEXT DEFAULT '4-axle'");
    }
    if (!vehCols.includes('start_trip_time')) {
      db.exec("ALTER TABLE vehicles ADD COLUMN start_trip_time TEXT DEFAULT '08:00'");
    }
    if (!vehCols.includes('end_trip_time')) {
      db.exec("ALTER TABLE vehicles ADD COLUMN end_trip_time TEXT DEFAULT '18:00'");
    }
    if (!vehCols.includes('total_toll_fee')) {
      db.exec("ALTER TABLE vehicles ADD COLUMN total_toll_fee REAL DEFAULT 340");
    }
    if (!vehCols.includes('stoppages_count')) {
      db.exec("ALTER TABLE vehicles ADD COLUMN stoppages_count INTEGER DEFAULT 2");
    }
  } catch (e) {}

  // Ensure migration columns exist in routes table
  try {
    const routeCols = db.prepare('PRAGMA table_info(routes)').all().map(c => c.name);
    if (!routeCols.includes('trip_date')) {
      db.exec('ALTER TABLE routes ADD COLUMN trip_date TEXT');
    }
    if (!routeCols.includes('start_trip_time')) {
      db.exec('ALTER TABLE routes ADD COLUMN start_trip_time TEXT');
    }
    if (!routeCols.includes('end_trip_time')) {
      db.exec('ALTER TABLE routes ADD COLUMN end_trip_time TEXT');
    }
    if (!routeCols.includes('end_trip_date')) {
      db.exec('ALTER TABLE routes ADD COLUMN end_trip_date TEXT');
    }
    if (!routeCols.includes('operational_status')) {
      db.exec("ALTER TABLE routes ADD COLUMN operational_status TEXT DEFAULT 'moving'");
    }
    if (!routeCols.includes('total_toll_fee')) {
      db.exec('ALTER TABLE routes ADD COLUMN total_toll_fee REAL DEFAULT 0');
    }
    if (!routeCols.includes('stoppages_count')) {
      db.exec('ALTER TABLE routes ADD COLUMN stoppages_count INTEGER DEFAULT 0');
    }
    if (!routeCols.includes('toll_gates_count')) {
      db.exec('ALTER TABLE routes ADD COLUMN toll_gates_count INTEGER DEFAULT 0');
    }
    if (!routeCols.includes('vehicle_registration_no')) {
      db.exec('ALTER TABLE routes ADD COLUMN vehicle_registration_no TEXT');
    }
  } catch (e) {}

  // 4. Stoppages table
  db.exec(`
    CREATE TABLE IF NOT EXISTS stoppages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      sequence_order INTEGER NOT NULL,
      name TEXT NOT NULL,
      address TEXT,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      stop_duration_mins INTEGER DEFAULT 15,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE
    );
  `);

  // 5. Manual Toll Gates table
  db.exec(`
    CREATE TABLE IF NOT EXISTS manual_toll_gates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      charges REAL DEFAULT 0,
      toll_type TEXT DEFAULT 'Highway Plaza',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE
    );
  `);

  // 6. Settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // 7. Fastag Transactions & Invoices table
  db.exec(`
    CREATE TABLE IF NOT EXISTS fastag_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id TEXT UNIQUE NOT NULL,
      netc_reference_no TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      vehicle_id INTEGER,
      vehicle_registration_no TEXT NOT NULL,
      vehicle_class TEXT DEFAULT 'Commercial Truck (HCV / 3-Axle Truck)',
      route_id INTEGER,
      toll_plaza_name TEXT NOT NULL,
      highway_name TEXT,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      amount REAL NOT NULL,
      base_toll_fee REAL NOT NULL,
      gst_amount REAL DEFAULT 0,
      concessionaire_name TEXT DEFAULT 'National Highways Authority of India (NHAI)',
      gstin TEXT DEFAULT '22AAACN0123M1Z5',
      lane_direction TEXT DEFAULT 'Lane 04 - Northbound (FASTag ETC)',
      payment_status TEXT DEFAULT 'SUCCESS',
      crossing_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      wallet_balance_before REAL DEFAULT 15000,
      wallet_balance_after REAL DEFAULT 14660,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL,
      FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE SET NULL
    );
  `);

  try {
    const fastagCols = db.prepare('PRAGMA table_info(fastag_transactions)').all().map(c => c.name);
    if (!fastagCols.includes('description')) {
      db.exec('ALTER TABLE fastag_transactions ADD COLUMN description TEXT');
    }
    db.exec(`
      UPDATE fastag_transactions 
      SET vehicle_id = (SELECT id FROM vehicles WHERE vehicles.registration_no = fastag_transactions.vehicle_registration_no) 
      WHERE vehicle_id IS NULL AND vehicle_registration_no IS NOT NULL;
    `);
  } catch (e) {}

  // 8. User Logins Activity table
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_logins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      email TEXT NOT NULL,
      user_name TEXT,
      role TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      device_type TEXT,
      login_status TEXT DEFAULT 'SUCCESS',
      login_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  // 9. Vehicle Allocations Tracking table (Admin -> User/Driver -> Vehicle -> Route Flow)
  db.exec(`
    CREATE TABLE IF NOT EXISTS vehicle_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      allocated_by INTEGER,
      route_id INTEGER,
      allocation_status TEXT DEFAULT 'ACTIVE',
      notes TEXT,
      allocated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (allocated_by) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE SET NULL
    );
  `);

  seedData();
  seedVehicleAllocations();
  seedFastagTransactions();
}

function seedVehicleAllocations() {
  const count = db.prepare('SELECT COUNT(*) as count FROM vehicle_allocations').get().count;
  if (count > 0) return;

  const assignedVehicles = db.prepare(`
    SELECT v.id as vehicle_id, v.assigned_user_id as user_id, r.id as route_id
    FROM vehicles v
    LEFT JOIN routes r ON r.vehicle_id = v.id AND r.is_active = 1
    WHERE v.assigned_user_id IS NOT NULL
  `).all();

  if (assignedVehicles.length === 0) return;

  const insertAlloc = db.prepare(`
    INSERT INTO vehicle_allocations (vehicle_id, user_id, allocated_by, route_id, allocation_status, notes)
    VALUES (?, ?, 1, ?, 'ACTIVE', 'Initial fleet allocation to commercial driver')
  `);

  for (const item of assignedVehicles) {
    insertAlloc.run(item.vehicle_id, item.user_id, item.route_id || null);
  }
}

function seedData() {
  // Only ensure Super Admin exists if no admin account is present
  const adminExists = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get().count;
  if (adminExists === 0) {
    console.log('[Database] Creating Super Admin account...');
    const passwordHash = bcrypt.hashSync('admin123', 10);
    const insertUser = db.prepare(`
      INSERT INTO users (name, email, password, phone, role, status, avatar_color)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertUser.run('Super Admin', 'admin@gpstrackx.com', passwordHash, '+91 98765 43210', 'admin', 'active', '#EF4444');
  }

  // Ensure default Google Maps and system settings exist
  const insertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('google_maps_api_key', 'AIzaSyAGLhFvC7LKYMreuva23KCxbhhrGn2rvFc');
  insertSetting.run('fleet_company_name', 'GpsTrackX Logistics Fleet');
  insertSetting.run('speed_alert_threshold', '80');
}

function seedFastagTransactions() {
  // Clean real-time flow: only genuine user transactions are recorded
}

initializeDatabase();

module.exports = db;
