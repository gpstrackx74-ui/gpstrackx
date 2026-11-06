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
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      phone TEXT,
      role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user')),
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
      avatar_color TEXT DEFAULT '#EF4444',
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
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'moving', 'stopped')),
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

  const insertAlloc = db.prepare(`
    INSERT INTO vehicle_allocations (vehicle_id, user_id, allocated_by, route_id, allocation_status, notes)
    VALUES (?, ?, 1, ?, 'ACTIVE', 'Initial fleet allocation to commercial driver')
  `);

  for (const item of assignedVehicles) {
    insertAlloc.run(item.vehicle_id, item.user_id, item.route_id || null);
  }
}

function seedData() {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount > 0) return; // Already seeded

  console.log('[Database] Seeding initial GpsTrackX data...');

  const passwordHash = bcrypt.hashSync('admin123', 10);
  const userPasswordHash = bcrypt.hashSync('user123', 10);

  // Insert Super Admin
  const insertUser = db.prepare(`
    INSERT INTO users (name, email, password, phone, role, status, avatar_color)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertUser.run('Super Admin', 'admin@gpstrackx.com', passwordHash, '+91 98765 43210', 'admin', 'active', '#EF4444');
  const rajeshId = insertUser.run('Rajesh Sharma', 'rajesh@logistics.com', userPasswordHash, '+91 98112 34567', 'user', 'active', '#3B82F6').lastInsertRowid;
  const priyaId = insertUser.run('Priya Nair', 'priya@supplychain.in', userPasswordHash, '+91 98223 45678', 'user', 'active', '#10B981').lastInsertRowid;
  const amitId = insertUser.run('Amit Kumar', 'amit.kumar@express.com', userPasswordHash, '+91 98334 56789', 'user', 'active', '#8B5CF6').lastInsertRowid;
  const sunitaId = insertUser.run('Sunita Patel', 'sunita@fleetops.com', userPasswordHash, '+91 98445 67890', 'user', 'active', '#F59E0B').lastInsertRowid;
  const deepakId = insertUser.run('Deepak Verma', 'deepak@transnet.in', userPasswordHash, '+91 98556 78901', 'user', 'inactive', '#64748B').lastInsertRowid;

  // Insert Vehicles
  const insertVehicle = db.prepare(`
    INSERT INTO vehicles (
      registration_no, name_model, vehicle_type, device_id, imei_number, chassis_number,
      fuel_type, assigned_user_id, status, current_speed, max_speed_limit, current_lat, current_lng, odometer_km
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Mumbai - Pune corridor vehicle (Moving)
  const v1 = insertVehicle.run(
    'MH12-RN-4589', 'Tata Signa 4825.TK', 'Truck', 'GPS-DEV-8821', '864209041234567', 'MAT612034N3P12891',
    'Diesel', rajeshId, 'moving', 64.5, 80, 18.9894, 73.1175, 48210
  ).lastInsertRowid;

  // Delhi - Jaipur corridor vehicle (Moving)
  const v2 = insertVehicle.run(
    'DL01-AB-1024', 'Mahindra Bolero Maxi Truck', 'Pickup', 'GPS-DEV-7742', '864209049876543', 'MA1N35V76E4B99120',
    'Diesel', priyaId, 'moving', 58.2, 75, 28.3587, 76.9248, 23400
  ).lastInsertRowid;

  // Bangalore - Chennai corridor vehicle (Active / Idling)
  const v3 = insertVehicle.run(
    'KA05-MJ-9901', 'Ashok Leyland 2820', 'Heavy Truck', 'GPS-DEV-9912', '864209043321456', 'MB1T2VLD2PPLW0917',
    'Diesel', amitId, 'active', 0, 80, 12.9716, 77.5946, 79540
  ).lastInsertRowid;

  // Ahmedabad - Surat vehicle (Active)
  const v4 = insertVehicle.run(
    'GJ01-TX-3321', 'Tata Ace Gold', 'Mini Truck', 'GPS-DEV-3341', '864209047788990', 'MAT350124P9L55412',
    'CNG', sunitaId, 'active', 0, 70, 22.8022, 72.8426, 15120
  ).lastInsertRowid;

  // Hyderabad - Vijayawada vehicle (Inactive / Maintenance)
  const v5 = insertVehicle.run(
    'TS09-UB-4422', 'Eicher Pro 3015', 'Cargo', 'GPS-DEV-4455', '864209046655443', 'MC2E12997R1K88231',
    'Diesel', null, 'inactive', 0, 80, 17.3850, 78.4867, 92100
  ).lastInsertRowid;

  // Kolkata - Durgapur vehicle (Moving)
  const v6 = insertVehicle.run(
    'WB19-CL-7810', 'BharatBenz 1617R', 'Truck', 'GPS-DEV-6129', '864209042211334', 'MD3BB4519T7X44109',
    'Diesel', rajeshId, 'moving', 51.8, 80, 23.0112, 87.8542, 63890
  ).lastInsertRowid;

  // Insert default Google Maps settings with active system key
  const insertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('google_maps_api_key', 'AIzaSyAGLhFvC7LKYMreuva23KCxbhhrGn2rvFc');
  insertSetting.run('fleet_company_name', 'GpsTrackX Logistics Fleet');
  insertSetting.run('speed_alert_threshold', '80');

  // Insert Pre-Planned Routes with actual real-road waypoints, stoppages & toll plazas
  const insertRoute = db.prepare(`
    INSERT INTO routes (
      vehicle_id, route_name, start_location_name, start_address, start_lat, start_lng,
      end_location_name, end_address, end_lat, end_lng, total_distance_km, estimated_travel_time_min,
      overview_polyline, route_color, waypoints_json, toll_gates_json, alternative_routes_json, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  // Route 1: Mumbai CST to Pune Swargate via Mumbai-Pune Expressway
  const mumbaiPuneWaypoints = [
    { name: 'Navi Mumbai Transit Hub', address: 'APMC Market, Vashi, Navi Mumbai', lat: 19.0760, lng: 73.0077, duration: 25 },
    { name: 'Lonavala Expressway Rest Stop', address: 'Old Mumbai Pune Hwy, Lonavala', lat: 18.7557, lng: 73.4091, duration: 20 }
  ];

  const mumbaiPuneTolls = [
    { name: 'Khalapur Toll Plaza', lat: 18.8284, lng: 73.2843, charges: 320, is_manual: false, verified: true },
    { name: 'Talegaon Toll Plaza', lat: 18.7329, lng: 73.6761, charges: 280, is_manual: false, verified: true },
    { name: 'Dehu Road Expressway Plaza (Manual)', lat: 18.7180, lng: 73.7250, charges: 90, is_manual: true, verified: false }
  ];

  const altRoutesMumbaiPune = [
    {
      id: 'alt-1',
      name: 'via Mumbai - Pune Expressway (Fastest)',
      distanceKm: 148.5,
      timeMinutes: 175,
      tollGatesCount: 3,
      stopsCount: 2,
      summary: 'NH 48 & Mumbai-Pune Expy - Best road surface, multi-lane divided highway with fast-tag electronic tolls.',
      color: '#EF4444',
      coordinates: [
        [18.9401, 72.8347], [18.9950, 72.8450], [19.0420, 72.8910], [19.0760, 73.0077],
        [19.0330, 73.0820], [18.9894, 73.1175], [18.8284, 73.2843], [18.7557, 73.4091],
        [18.7329, 73.6761], [18.7180, 73.7250], [18.6270, 73.8050], [18.5018, 73.8584]
      ]
    },
    {
      id: 'alt-2',
      name: 'via Old Mumbai - Pune Highway (NH 48)',
      distanceKm: 162.2,
      timeMinutes: 220,
      tollGatesCount: 2,
      stopsCount: 2,
      summary: 'Scenic route through Khopoli and Bhor Ghat, slightly longer travel time with heavier local traffic.',
      color: '#3B82F6',
      coordinates: [
        [18.9401, 72.8347], [19.0420, 72.8910], [19.0760, 73.0077], [18.9800, 73.1800],
        [18.7850, 73.3400], [18.7557, 73.4091], [18.7100, 73.6200], [18.5800, 73.7800],
        [18.5018, 73.8584]
      ]
    },
    {
      id: 'alt-3',
      name: 'via JNPT Port Bypass & Khopoli Link',
      distanceKm: 171.0,
      timeMinutes: 245,
      tollGatesCount: 2,
      stopsCount: 2,
      summary: 'Industrial logistics corridor bypassing Panvel central traffic, optimal for oversized cargo.',
      color: '#8B5CF6',
      coordinates: [
        [18.9401, 72.8347], [18.9500, 72.9500], [18.9100, 73.0500], [18.8284, 73.2843],
        [18.7557, 73.4091], [18.7329, 73.6761], [18.5018, 73.8584]
      ]
    }
  ];

  const r1Id = insertRoute.run(
    v1,
    'Mumbai Central - Pune Hub Express Route',
    'Mumbai CST Freight Depot',
    'Chhatrapati Shivaji Maharaj Terminus, Fort, Mumbai, Maharashtra 400001',
    18.9401, 72.8347,
    'Pune Logistics Terminal',
    'Swargate Transport Nagar, Pune, Maharashtra 411042',
    18.5018, 73.8584,
    148.5,
    175,
    JSON.stringify(altRoutesMumbaiPune[0].coordinates),
    '#EF4444',
    JSON.stringify(mumbaiPuneWaypoints),
    JSON.stringify(mumbaiPuneTolls),
    JSON.stringify(altRoutesMumbaiPune)
  ).lastInsertRowid;

  // Insert stoppages for Route 1
  const insertStoppage = db.prepare(`
    INSERT INTO stoppages (route_id, sequence_order, name, address, lat, lng, stop_duration_mins)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertStoppage.run(r1Id, 1, 'Navi Mumbai Transit Hub', 'APMC Market, Vashi, Navi Mumbai', 19.0760, 73.0077, 25);
  insertStoppage.run(r1Id, 2, 'Lonavala Expressway Rest Stop', 'Old Mumbai Pune Hwy, Lonavala', 18.7557, 73.4091, 20);

  // Insert manual toll for Route 1
  const insertManualToll = db.prepare(`
    INSERT INTO manual_toll_gates (route_id, name, lat, lng, charges, toll_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertManualToll.run(r1Id, 'Dehu Road Expressway Plaza (Manual)', 18.7180, 73.7250, 90, 'Manual Checkpoint');

  // Route 2: Delhi to Jaipur
  const delhiJaipurWaypoints = [
    { name: 'Gurugram Logistics Center', address: 'Sector 37, Pace City, Gurugram, Haryana', lat: 28.4350, lng: 76.9950, duration: 30 },
    { name: 'Neemrana Industrial Zone', address: 'RIICO Industrial Area, Neemrana, Rajasthan', lat: 27.9950, lng: 76.3850, duration: 15 }
  ];

  const delhiJaipurTolls = [
    { name: 'Kherki Daula Toll Plaza', lat: 28.3980, lng: 76.9740, charges: 80, is_manual: false, verified: true },
    { name: 'Shahjahanpur Toll Plaza', lat: 28.0120, lng: 76.3680, charges: 175, is_manual: false, verified: true },
    { name: 'Manoharpur Toll Plaza', lat: 27.3100, lng: 75.9800, charges: 110, is_manual: false, verified: true }
  ];

  const altRoutesDelhiJaipur = [
    {
      id: 'alt-del-1',
      name: 'via Delhi - Jaipur Expressway (NH 48)',
      distanceKm: 272.0,
      timeMinutes: 285,
      tollGatesCount: 3,
      stopsCount: 2,
      summary: 'Direct 6-lane National Highway with full high-speed corridors and electronic tolling.',
      color: '#EF4444',
      coordinates: [
        [28.6139, 77.2090], [28.5300, 77.1000], [28.4350, 76.9950], [28.3980, 76.9740],
        [28.3587, 76.9248], [28.2100, 76.7100], [28.0120, 76.3680], [27.9950, 76.3850],
        [27.6500, 76.1500], [27.3100, 75.9800], [26.9124, 75.7873]
      ]
    },
    {
      id: 'alt-del-2',
      name: 'via Western Peripheral (KMP) & Sohna Elevated Corridor',
      distanceKm: 290.4,
      timeMinutes: 305,
      tollGatesCount: 4,
      stopsCount: 2,
      summary: 'Bypasses central Gurugram city congestion, recommended during peak morning rush.',
      color: '#3B82F6',
      coordinates: [
        [28.6139, 77.2090], [28.4800, 77.2200], [28.3100, 77.1800], [28.2200, 77.0500],
        [28.0120, 76.3680], [27.9950, 76.3850], [27.3100, 75.9800], [26.9124, 75.7873]
      ]
    }
  ];

  const r2Id = insertRoute.run(
    v2,
    'Delhi NCR - Jaipur Industrial Gateway',
    'Indira Gandhi Cargo Complex',
    'Cargo Terminal 2, IGI Airport, New Delhi 110037',
    28.6139, 77.2090,
    'Jaipur Transport Nagar',
    'Transport Nagar, Agra Road, Jaipur, Rajasthan 302004',
    26.9124, 75.7873,
    272.0,
    285,
    JSON.stringify(altRoutesDelhiJaipur[0].coordinates),
    '#EF4444',
    JSON.stringify(delhiJaipurWaypoints),
    JSON.stringify(delhiJaipurTolls),
    JSON.stringify(altRoutesDelhiJaipur)
  ).lastInsertRowid;

  insertStoppage.run(r2Id, 1, 'Gurugram Logistics Center', 'Sector 37, Pace City, Gurugram, Haryana', 28.4350, 76.9950, 30);
  insertStoppage.run(r2Id, 2, 'Neemrana Industrial Zone', 'RIICO Industrial Area, Neemrana, Rajasthan', 27.9950, 76.3850, 15);

  console.log('[Database] Seeded successfully with Admin, Users, Vehicles and Routes!');
}

function seedFastagTransactions() {
  const count = db.prepare('SELECT COUNT(*) as count FROM fastag_transactions').get().count;
  if (count > 0) return;

  console.log('[Database] Seeding initial FASTag transactions & toll bills...');
  const fastagService = require('./fastagService');

  const insertTx = db.prepare(`
    INSERT INTO fastag_transactions (
      transaction_id, netc_reference_no, tag_id, vehicle_id, vehicle_registration_no,
      vehicle_class, route_id, toll_plaza_name, highway_name, lat, lng,
      amount, base_toll_fee, gst_amount, concessionaire_name, gstin,
      lane_direction, payment_status, crossing_time, wallet_balance_before, wallet_balance_after
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const initialTolls = [
    {
      vehReg: 'WB19-CL-7810',
      vehId: 6,
      plaza: 'Simga Toll Plaza',
      highway: 'NH-30 (Raipur - Bilaspur Expressway)',
      lat: 21.6241,
      lng: 81.6983,
      amount: 340,
      concessionaire: 'Raipur-Bilaspur Expressway Ltd. / NHAI',
      gstin: '22AAACR9821P1Z4',
      lane: 'Lane 04 - Northbound (FASTag ETC)',
      time: '2026-11-02 09:42:15',
      balBefore: 18500,
      balAfter: 18160
    },
    {
      vehReg: 'WB19-CL-7810',
      vehId: 6,
      plaza: 'Mandir Hasaud Toll Plaza',
      highway: 'NH-53 (Raipur - Sambalpur National Highway)',
      lat: 21.2180,
      lng: 81.8210,
      amount: 245,
      concessionaire: 'NHAI Regional Office Raipur',
      gstin: '22AAACN0123M1Z5',
      lane: 'Lane 02 - Eastbound (FASTag ETC)',
      time: '2026-11-02 08:15:30',
      balBefore: 18745,
      balAfter: 18500
    },
    {
      vehReg: 'WB19-CL-7810',
      vehId: 6,
      plaza: 'Boirdadar Commercial Toll Gate',
      highway: 'SH-2 Raigarh Industrial Corridor',
      lat: 21.8920,
      lng: 83.3980,
      amount: 210,
      concessionaire: 'Chhattisgarh State Road Development Corp (CSRDC)',
      gstin: '22AABCC4455Q1Z8',
      lane: 'Lane 01 - Commercial Truck Weighbridge Lane',
      time: '2026-11-01 16:30:10',
      balBefore: 18955,
      balAfter: 18745
    },
    {
      vehReg: 'MH12-RN-4589',
      vehId: 1,
      plaza: 'Khalapur Toll Plaza',
      highway: 'Yashwantrao Chavan Mumbai - Pune Expressway',
      lat: 18.8120,
      lng: 73.2840,
      amount: 465,
      concessionaire: 'MSRDC / IRB Infrastructure Developers Ltd.',
      gstin: '27AABCI4890K1ZX',
      lane: 'Lane 06 - Southbound Expressway FASTag',
      time: '2026-11-02 11:20:44',
      balBefore: 12400,
      balAfter: 11935
    },
    {
      vehReg: 'MH12-RN-4589',
      vehId: 1,
      plaza: 'Talegaon Toll Plaza',
      highway: 'Mumbai - Pune Expressway Section B',
      lat: 18.7350,
      lng: 73.6820,
      amount: 275,
      concessionaire: 'MSRDC / Ideal Tollways Ltd.',
      gstin: '27AABCI4890K1ZX',
      lane: 'Lane 03 - Pune Entry FASTag ETC',
      time: '2026-11-02 12:45:18',
      balBefore: 11935,
      balAfter: 11660
    },
    {
      vehReg: 'DL01-AB-1024',
      vehId: 2,
      plaza: 'Kherki Daula Toll Plaza',
      highway: 'NH-48 (Delhi - Gurugram Expressway)',
      lat: 28.4010,
      lng: 76.9920,
      amount: 240,
      concessionaire: 'Millennium City Expressway Pvt Ltd / NHAI',
      gstin: '06AACCM9981K1Z2',
      lane: 'Lane 05 - Jaipur Bound (FASTag Dedicated)',
      time: '2026-11-02 07:15:22',
      balBefore: 9800,
      balAfter: 9560
    },
    {
      vehReg: 'DL01-AB-1024',
      vehId: 2,
      plaza: 'Shahjahanpur Toll Plaza',
      highway: 'NH-48 (Haryana - Rajasthan Interstate Corridor)',
      lat: 27.9920,
      lng: 76.3810,
      amount: 360,
      concessionaire: 'NHAI Project Implementation Unit Jaipur',
      gstin: '08AAACN0123M1Z3',
      lane: 'Lane 04 - Heavy Commercial Truck Fastag',
      time: '2026-11-02 09:35:50',
      balBefore: 9560,
      balAfter: 9200
    },
    {
      vehReg: 'DL01-AB-1024',
      vehId: 2,
      plaza: 'Manoharpur Toll Plaza',
      highway: 'NH-48 (Jaipur Bypass National Corridor)',
      lat: 27.3120,
      lng: 75.9810,
      amount: 385,
      concessionaire: 'Pink City Tollways / NHAI',
      gstin: '08AAACP1199F1Z9',
      lane: 'Lane 02 - Southbound Commercial FASTag',
      time: '2026-11-02 11:50:12',
      balBefore: 9200,
      balAfter: 8815
    }
  ];

  initialTolls.forEach((t, i) => {
    const txnId = fastagService.generateTransactionId(t.time);
    const netcRef = fastagService.generateNetcReference(t.time);
    const tagId = fastagService.generateTagId(t.vehReg);

    insertTx.run(
      txnId,
      netcRef,
      tagId,
      t.vehId,
      t.vehReg,
      'Commercial Truck (HCV / 3-Axle Truck)',
      null,
      t.plaza,
      t.highway,
      t.lat,
      t.lng,
      t.amount,
      t.amount, // base fee (exempt GST on Indian National Highways)
      0, // GST amount (exempt under Notification No. 12/2017)
      t.concessionaire,
      t.gstin,
      t.lane,
      'SUCCESS',
      t.time,
      t.balBefore,
      t.balAfter
    );
  });

  console.log('[Database] Seeded 8 initial FASTag transactions & tax invoices successfully!');
}

initializeDatabase();

module.exports = db;

