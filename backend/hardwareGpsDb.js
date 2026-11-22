const Database = require('better-sqlite3');
const path = require('path');

// Completely separate database for Hardware GPS devices & live telemetry logs
const hardwareDbPath = path.join(__dirname, 'gps_hardware.db');
const hardwareDb = new Database(hardwareDbPath);

hardwareDb.pragma('journal_mode = WAL');

// Initialize dedicated tables
hardwareDb.exec(`
  CREATE TABLE IF NOT EXISTS registered_imei_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    imei TEXT UNIQUE NOT NULL,
    device_model TEXT NOT NULL,
    pairing_code TEXT NOT NULL,
    status TEXT DEFAULT 'UNLINKED' CHECK(status IN ('UNLINKED', 'LINKED')),
    assigned_user_id INTEGER,
    assigned_user_email TEXT,
    assigned_user_name TEXT,
    vehicle_name TEXT,
    vehicle_number TEXT,
    assigned_vehicle_id INTEGER,
    last_latitude REAL DEFAULT 21.2514,
    last_longitude REAL DEFAULT 81.6296,
    last_speed REAL DEFAULT 0,
    last_heading REAL DEFAULT 0,
    last_altitude REAL DEFAULT 0,
    ignition_status INTEGER DEFAULT 1,
    last_telemetry_time DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS hardware_telemetry_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    imei TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    speed REAL DEFAULT 0,
    heading REAL DEFAULT 0,
    altitude REAL DEFAULT 0,
    ignition INTEGER DEFAULT 1,
    raw_data TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_hardware_imei ON registered_imei_devices(imei);
  CREATE INDEX IF NOT EXISTS idx_hardware_code ON registered_imei_devices(pairing_code);
  CREATE INDEX IF NOT EXISTS idx_telemetry_imei ON hardware_telemetry_logs(imei);
  CREATE INDEX IF NOT EXISTS idx_telemetry_time ON hardware_telemetry_logs(timestamp);
`);

/**
 * Generate a random 6-digit numeric pairing code (e.g. "482910")
 */
function generate6DigitCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Register a new hardware IMEI device (Admin action)
 */
function registerDevice(imei, deviceModel) {
  const cleanImei = String(imei).trim();
  const cleanModel = String(deviceModel || 'Concox GT06N').trim();

  // Check if already registered
  const existing = hardwareDb.prepare('SELECT * FROM registered_imei_devices WHERE imei = ?').get(cleanImei);
  if (existing) {
    throw new Error(`IMEI ${cleanImei} is already registered (${existing.device_model}). Status: ${existing.status}`);
  }

  // Generate unique 6-digit code
  let code = generate6DigitCode();
  let codeExists = hardwareDb.prepare("SELECT id FROM registered_imei_devices WHERE pairing_code = ? AND status = 'UNLINKED'").get(code);
  while (codeExists) {
    code = generate6DigitCode();
    codeExists = hardwareDb.prepare("SELECT id FROM registered_imei_devices WHERE pairing_code = ? AND status = 'UNLINKED'").get(code);
  }

  const stmt = hardwareDb.prepare(`
    INSERT INTO registered_imei_devices (imei, device_model, pairing_code, status)
    VALUES (?, ?, ?, 'UNLINKED')
  `);
  stmt.run(cleanImei, cleanModel, code);

  return hardwareDb.prepare('SELECT * FROM registered_imei_devices WHERE imei = ?').get(cleanImei);
}

/**
 * Get all registered IMEI devices (Admin view)
 */
function getAllDevices() {
  return hardwareDb.prepare('SELECT * FROM registered_imei_devices ORDER BY created_at DESC').all();
}

/**
 * Get device by IMEI
 */
function getDeviceByImei(imei) {
  return hardwareDb.prepare('SELECT * FROM registered_imei_devices WHERE imei = ?').get(String(imei).trim());
}

/**
 * Delete a registered device (Admin action)
 */
function deleteDevice(imei) {
  const cleanImei = String(imei).trim();
  const del = hardwareDb.prepare('DELETE FROM registered_imei_devices WHERE imei = ?').run(cleanImei);
  hardwareDb.prepare('DELETE FROM hardware_telemetry_logs WHERE imei = ?').run(cleanImei);
  return del.changes > 0;
}

/**
 * Regenerate 6-digit code for an unlinked device (Admin action)
 */
function regeneratePairingCode(imei) {
  const cleanImei = String(imei).trim();
  const device = getDeviceByImei(cleanImei);
  if (!device) throw new Error('Device not found');
  if (device.status === 'LINKED') throw new Error('Cannot regenerate code for an already linked device');

  const newCode = generate6DigitCode();
  hardwareDb.prepare(`
    UPDATE registered_imei_devices 
    SET pairing_code = ?, updated_at = CURRENT_TIMESTAMP 
    WHERE imei = ?
  `).run(newCode, cleanImei);

  return getDeviceByImei(cleanImei);
}

/**
 * Verify and Link device from User Login (+Add Device)
 */
function verifyAndLinkDevice({ imei, code, vehicleName, vehicleNumber, userId, userEmail, userName, vehicleId }) {
  const cleanImei = String(imei).trim();
  const cleanCode = String(code).trim();

  const device = hardwareDb.prepare('SELECT * FROM registered_imei_devices WHERE imei = ?').get(cleanImei);
  if (!device) {
    throw new Error('This IMEI number is not registered in system. Please contact Admin.');
  }

  if (device.pairing_code !== cleanCode) {
    throw new Error('6-Digit Security Code does not match with Admin registration. Please verify code.');
  }

  if (device.status === 'LINKED') {
    throw new Error(`This device is already linked to vehicle ${device.vehicle_number || ''}.`);
  }

  hardwareDb.prepare(`
    UPDATE registered_imei_devices SET
      status = 'LINKED',
      assigned_user_id = ?,
      assigned_user_email = ?,
      assigned_user_name = ?,
      vehicle_name = ?,
      vehicle_number = ?,
      assigned_vehicle_id = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE imei = ?
  `).run(
    userId || null,
    userEmail || null,
    userName || null,
    vehicleName || 'Commercial GPS Vehicle',
    vehicleNumber || 'CG04-GPS',
    vehicleId || null,
    cleanImei
  );

  return getDeviceByImei(cleanImei);
}

/**
 * Record incoming telemetry coordinates from TCP socket or HTTP simulator
 */
function updateDeviceTelemetry({ imei, latitude, longitude, speed = 0, heading = 0, altitude = 0, ignition = 1, rawData = '' }) {
  const cleanImei = String(imei).trim();

  // Update latest position in registered_imei_devices
  hardwareDb.prepare(`
    UPDATE registered_imei_devices SET
      last_latitude = ?,
      last_longitude = ?,
      last_speed = ?,
      last_heading = ?,
      last_altitude = ?,
      ignition_status = ?,
      last_telemetry_time = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    WHERE imei = ?
  `).run(latitude, longitude, speed, heading, altitude, ignition ? 1 : 0, cleanImei);

  // Insert historical log
  hardwareDb.prepare(`
    INSERT INTO hardware_telemetry_logs (imei, latitude, longitude, speed, heading, altitude, ignition, raw_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(cleanImei, latitude, longitude, speed, heading, altitude, ignition ? 1 : 0, rawData);

  return getDeviceByImei(cleanImei);
}

/**
 * Get recent telemetry history for map trail
 */
function getDeviceTelemetryHistory(imei, limit = 50) {
  const cleanImei = String(imei).trim();
  return hardwareDb.prepare(`
    SELECT * FROM hardware_telemetry_logs 
    WHERE imei = ? 
    ORDER BY id DESC 
    LIMIT ?
  `).all(cleanImei, limit);
}

module.exports = {
  hardwareDb,
  registerDevice,
  getAllDevices,
  getDeviceByImei,
  deleteDevice,
  regeneratePairingCode,
  verifyAndLinkDevice,
  updateDeviceTelemetry,
  getDeviceTelemetryHistory
};
