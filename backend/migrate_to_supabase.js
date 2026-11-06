require('dotenv').config();
const { Pool } = require('pg');
const Database = require('better-sqlite3');
const path = require('path');

const connectionString = process.env.DATABASE_URL || 
  'postgresql://postgres.ydvicefnlyoeedisaruz:UTuzXysEehCGFWUi@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres';

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

const localDb = new Database(path.join(__dirname, 'fleet.db'));

async function initSupabase() {
  console.log('[1/7] Connecting and ensuring all core tables exist in Supabase...');

  // 1. Users Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      phone VARCHAR(50),
      role VARCHAR(20) DEFAULT 'user' CHECK(role IN ('admin', 'user')),
      status VARCHAR(20) DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
      avatar_color VARCHAR(20) DEFAULT '#E60012',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. Vehicles Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id SERIAL PRIMARY KEY,
      registration_no VARCHAR(50) UNIQUE NOT NULL,
      name_model VARCHAR(255) NOT NULL,
      vehicle_type VARCHAR(100) NOT NULL,
      device_id VARCHAR(100),
      imei_number VARCHAR(100),
      chassis_number VARCHAR(100),
      fuel_type VARCHAR(50) DEFAULT 'Diesel',
      assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      status VARCHAR(20) DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'moving', 'stopped')),
      current_speed NUMERIC DEFAULT 0,
      max_speed_limit NUMERIC DEFAULT 80,
      current_lat NUMERIC,
      current_lng NUMERIC,
      odometer_km NUMERIC DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 3. Routes Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS routes (
      id SERIAL PRIMARY KEY,
      vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
      route_name VARCHAR(255) NOT NULL,
      start_location_name VARCHAR(255) NOT NULL,
      start_address TEXT NOT NULL,
      start_lat NUMERIC NOT NULL,
      start_lng NUMERIC NOT NULL,
      end_location_name VARCHAR(255) NOT NULL,
      end_address TEXT NOT NULL,
      end_lat NUMERIC NOT NULL,
      end_lng NUMERIC NOT NULL,
      total_distance_km NUMERIC NOT NULL,
      estimated_travel_time_min INTEGER NOT NULL,
      overview_polyline TEXT,
      route_color VARCHAR(20) DEFAULT '#E60012',
      waypoints_json TEXT DEFAULT '[]',
      toll_gates_json TEXT DEFAULT '[]',
      alternative_routes_json TEXT DEFAULT '[]',
      trip_date VARCHAR(50),
      start_trip_time VARCHAR(50),
      end_trip_time VARCHAR(50),
      is_active INTEGER DEFAULT 1,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 4. Stoppages Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stoppages (
      id SERIAL PRIMARY KEY,
      route_id INTEGER REFERENCES routes(id) ON DELETE CASCADE,
      sequence_order INTEGER NOT NULL,
      name VARCHAR(255) NOT NULL,
      address TEXT,
      lat NUMERIC NOT NULL,
      lng NUMERIC NOT NULL,
      stop_duration_mins INTEGER DEFAULT 15,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 5. Manual Toll Gates Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS manual_toll_gates (
      id SERIAL PRIMARY KEY,
      route_id INTEGER REFERENCES routes(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      lat NUMERIC NOT NULL,
      lng NUMERIC NOT NULL,
      charges NUMERIC DEFAULT 0,
      toll_type VARCHAR(100) DEFAULT 'Highway Plaza',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 6. FASTag Transactions Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fastag_transactions (
      id SERIAL PRIMARY KEY,
      transaction_id VARCHAR(100) UNIQUE NOT NULL,
      netc_reference_no VARCHAR(100) NOT NULL,
      tag_id VARCHAR(100) NOT NULL,
      vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
      vehicle_registration_no VARCHAR(50) NOT NULL,
      vehicle_class VARCHAR(100) DEFAULT 'Commercial Truck (HCV / 3-Axle Truck)',
      route_id INTEGER REFERENCES routes(id) ON DELETE SET NULL,
      toll_plaza_name VARCHAR(255) NOT NULL,
      highway_name VARCHAR(100),
      lat NUMERIC NOT NULL,
      lng NUMERIC NOT NULL,
      amount NUMERIC NOT NULL,
      base_toll_fee NUMERIC NOT NULL,
      gst_amount NUMERIC DEFAULT 0,
      concessionaire_name VARCHAR(255) DEFAULT 'National Highways Authority of India (NHAI)',
      gstin VARCHAR(50) DEFAULT '22AAACN0123M1Z5',
      lane_direction VARCHAR(100) DEFAULT 'Lane 04 - Northbound (FASTag ETC)',
      payment_status VARCHAR(50) DEFAULT 'SUCCESS',
      crossing_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      wallet_balance_before NUMERIC DEFAULT 15000,
      wallet_balance_after NUMERIC DEFAULT 14660,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 7. Dedicated User Logins Activity Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_logins (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      email VARCHAR(255) NOT NULL,
      user_name VARCHAR(255),
      role VARCHAR(20) NOT NULL,
      ip_address VARCHAR(100),
      user_agent TEXT,
      device_type VARCHAR(50),
      login_status VARCHAR(50) DEFAULT 'SUCCESS',
      login_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 8. Vehicle & Route Allocations Flow Tracking Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vehicle_allocations (
      id SERIAL PRIMARY KEY,
      vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      allocated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      route_id INTEGER REFERENCES routes(id) ON DELETE SET NULL,
      allocation_status VARCHAR(50) DEFAULT 'ACTIVE',
      notes TEXT,
      allocated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Ensure company_name and axle_type exist in Supabase
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS company_name VARCHAR(255);`);
  await pool.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS axle_type VARCHAR(50) DEFAULT '4-axle';`);

  // [2/7] Sync Users
  console.log('[2/7] Syncing Users...');
  const users = localDb.prepare('SELECT * FROM users').all();
  for (const u of users) {
    await pool.query(`
      INSERT INTO users (id, name, email, password, phone, role, status, avatar_color)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (email) DO UPDATE SET 
        name = EXCLUDED.name,
        password = EXCLUDED.password,
        phone = EXCLUDED.phone,
        role = EXCLUDED.role,
        status = EXCLUDED.status
    `, [u.id, u.name, u.email, u.password, u.phone, u.role, u.status, u.avatar_color]);
  }
  await pool.query(`SELECT setval('users_id_seq', (SELECT COALESCE(MAX(id), 1) FROM users))`);
  console.log(`>>> [2/7] ${users.length} Users synced to Supabase!`);

  // [3/7] Sync Vehicles
  console.log('[3/7] Syncing Vehicles...');
  const vehicles = localDb.prepare('SELECT * FROM vehicles').all();
  for (const v of vehicles) {
    await pool.query(`
      INSERT INTO vehicles (
        id, registration_no, name_model, vehicle_type, device_id, imei_number, chassis_number,
        fuel_type, assigned_user_id, status, current_speed, max_speed_limit, current_lat, current_lng, odometer_km
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (registration_no) DO UPDATE SET
        name_model = EXCLUDED.name_model,
        vehicle_type = EXCLUDED.vehicle_type,
        assigned_user_id = EXCLUDED.assigned_user_id,
        status = EXCLUDED.status,
        current_speed = EXCLUDED.current_speed,
        current_lat = EXCLUDED.current_lat,
        current_lng = EXCLUDED.current_lng,
        odometer_km = EXCLUDED.odometer_km
    `, [v.id, v.registration_no, v.name_model, v.vehicle_type, v.device_id, v.imei_number, v.chassis_number,
        v.fuel_type, v.assigned_user_id, v.status, v.current_speed, v.max_speed_limit, v.current_lat, v.current_lng, v.odometer_km]);
  }
  await pool.query(`SELECT setval('vehicles_id_seq', (SELECT COALESCE(MAX(id), 1) FROM vehicles))`);
  console.log(`>>> [3/7] ${vehicles.length} Vehicles synced to Supabase!`);

  // [4/7] Sync Routes
  console.log('[4/7] Syncing Routes...');
  const routes = localDb.prepare('SELECT * FROM routes').all();
  for (const r of routes) {
    await pool.query(`
      INSERT INTO routes (
        id, vehicle_id, route_name, start_location_name, start_address, start_lat, start_lng,
        end_location_name, end_address, end_lat, end_lng, total_distance_km, estimated_travel_time_min,
        overview_polyline, route_color, waypoints_json, toll_gates_json, alternative_routes_json,
        trip_date, start_trip_time, end_trip_time, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
      ON CONFLICT (id) DO UPDATE SET
        route_name = EXCLUDED.route_name,
        vehicle_id = EXCLUDED.vehicle_id,
        start_location_name = EXCLUDED.start_location_name,
        end_location_name = EXCLUDED.end_location_name,
        total_distance_km = EXCLUDED.total_distance_km,
        estimated_travel_time_min = EXCLUDED.estimated_travel_time_min,
        is_active = EXCLUDED.is_active
    `, [r.id, r.vehicle_id, r.route_name, r.start_location_name, r.start_address, r.start_lat, r.start_lng,
        r.end_location_name, r.end_address, r.end_lat, r.end_lng, r.total_distance_km, r.estimated_travel_time_min,
        r.overview_polyline, r.route_color, r.waypoints_json, r.toll_gates_json, r.alternative_routes_json,
        r.trip_date, r.start_trip_time, r.end_trip_time, r.is_active]);
  }
  await pool.query(`SELECT setval('routes_id_seq', (SELECT COALESCE(MAX(id), 1) FROM routes))`);
  console.log(`>>> [4/7] ${routes.length} Routes synced to Supabase!`);

  // [5/7] Sync FASTag Transactions
  console.log('[5/7] Syncing FASTag Transactions...');
  const txs = localDb.prepare('SELECT * FROM fastag_transactions').all();
  for (const tx of txs) {
    await pool.query(`
      INSERT INTO fastag_transactions (
        transaction_id, netc_reference_no, tag_id, vehicle_id, vehicle_registration_no,
        vehicle_class, route_id, toll_plaza_name, highway_name, lat, lng,
        amount, base_toll_fee, gst_amount, concessionaire_name, gstin,
        lane_direction, payment_status, wallet_balance_before, wallet_balance_after
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      ON CONFLICT (transaction_id) DO NOTHING
    `, [tx.transaction_id, tx.netc_reference_no, tx.tag_id, tx.vehicle_id, tx.vehicle_registration_no,
        tx.vehicle_class, tx.route_id, tx.toll_plaza_name, tx.highway_name, tx.lat, tx.lng,
        tx.amount, tx.base_toll_fee, tx.gst_amount, tx.concessionaire_name, tx.gstin,
        tx.lane_direction, tx.payment_status, tx.wallet_balance_before, tx.wallet_balance_after]);
  }
  console.log(`>>> [5/7] ${txs.length} FASTag Transactions synced to Supabase!`);

  // [6/7] Sync Vehicle Allocations
  console.log('[6/7] Syncing Vehicle Allocations...');
  // Ensure local allocations seeded
  const assignedVehicles = localDb.prepare(`
    SELECT v.id as vehicle_id, v.assigned_user_id as user_id, r.id as route_id
    FROM vehicles v
    LEFT JOIN routes r ON r.vehicle_id = v.id AND r.is_active = 1
    WHERE v.assigned_user_id IS NOT NULL
  `).all();

  for (const item of assignedVehicles) {
    await pool.query(`
      INSERT INTO vehicle_allocations (vehicle_id, user_id, allocated_by, route_id, allocation_status, notes)
      VALUES ($1, $2, 1, $3, 'ACTIVE', 'Admin fleet vehicle & corridor allotment')
      ON CONFLICT DO NOTHING
    `, [item.vehicle_id, item.user_id, item.route_id || null]);
  }
  console.log(`>>> [6/7] Active vehicle allocations synced to Supabase!`);

  // [7/7] Seed Super Admin Login record into user_logins
  console.log('[7/7] Initializing User Logins table...');
  await pool.query(`
    INSERT INTO user_logins (user_id, email, user_name, role, ip_address, user_agent, device_type, login_status)
    VALUES (1, 'admin@gpstrackx.com', 'Super Admin', 'admin', '127.0.0.1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Desktop (Windows)', 'SUCCESS')
    ON CONFLICT DO NOTHING
  `);

  console.log('>>> [7/7] Complete Verification:');
  const counts = await Promise.all([
    pool.query('SELECT COUNT(*) as count FROM users'),
    pool.query('SELECT COUNT(*) as count FROM vehicles'),
    pool.query('SELECT COUNT(*) as count FROM routes'),
    pool.query('SELECT COUNT(*) as count FROM fastag_transactions'),
    pool.query('SELECT COUNT(*) as count FROM vehicle_allocations'),
    pool.query('SELECT COUNT(*) as count FROM user_logins')
  ]);

  console.log(`- Users in Supabase: ${counts[0].rows[0].count}`);
  console.log(`- Vehicles in Supabase: ${counts[1].rows[0].count}`);
  console.log(`- Routes in Supabase: ${counts[2].rows[0].count}`);
  console.log(`- FASTag Tolls in Supabase: ${counts[3].rows[0].count}`);
  console.log(`- Allocations in Supabase: ${counts[4].rows[0].count}`);
  console.log(`- User Logins in Supabase: ${counts[5].rows[0].count}`);

  await pool.end();
  console.log('ALL COMPLETE! Supabase migration & flow sync successfully finished.');
}

initSupabase().catch(e => {
  console.error('Migration error:', e.message);
  pool.end();
  process.exit(1);
});
