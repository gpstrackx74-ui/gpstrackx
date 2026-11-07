require('dotenv').config();
const { Pool } = require('pg');

let pool = null;
let isConnected = false;

const connectionString = process.env.DATABASE_URL || 
  'postgresql://postgres.ydvicefnlyoeedisaruz:UTuzXysEehCGFWUi@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres';

if (connectionString) {
  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });

  pool.query('SELECT NOW() as current_time, current_database() as db')
    .then(res => {
      isConnected = true;
      console.log('>>> [Supabase] Connected to live Cloud Database successfully:', res.rows[0].db, 'at', res.rows[0].current_time);
    })
    .catch(err => {
      console.error('>>> [Supabase] Connection warning:', err.message);
    });
} else {
  console.log('>>> [Supabase] No DATABASE_URL configured. Running on local storage.');
}

const supabaseService = {
  get isConnected() {
    return isConnected;
  },

  async query(text, params) {
    if (!pool) return null;
    try {
      return await pool.query(text, params);
    } catch (err) {
      console.error('[Supabase Query Error]:', err.message);
      return null;
    }
  },

  // Sync new/updated user to Supabase
  async syncUser(user) {
    if (!pool) return;
    try {
      await pool.query(`
        INSERT INTO users (id, name, email, password, phone, role, status, avatar_color, company_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (email) DO UPDATE SET
          name = EXCLUDED.name,
          password = EXCLUDED.password,
          phone = EXCLUDED.phone,
          role = EXCLUDED.role,
          status = EXCLUDED.status,
          company_name = EXCLUDED.company_name
      `, [user.id, user.name, user.email, user.password, user.phone || null, user.role || 'user', user.status || 'active', user.avatar_color || '#E60012', user.company_name || null]);
      console.log(`[Supabase] Synced user: ${user.email}`);
    } catch (err) {
      console.error('[Supabase syncUser Error]:', err.message);
    }
  },

  // Delete user from Supabase
  async deleteUser(userId, email) {
    if (!pool) return;
    try {
      if (email) {
        await pool.query('DELETE FROM user_logins WHERE email = $1', [email]);
        await pool.query('DELETE FROM users WHERE email = $1', [email]);
      }
      await pool.query('DELETE FROM user_logins WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM vehicle_allocations WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      console.log(`[Supabase] Permanently deleted user ID: ${userId} (${email || ''})`);
    } catch (err) {
      console.error('[Supabase deleteUser Error]:', err.message);
    }
  },

  // Sync new/updated vehicle to Supabase
  async syncVehicle(v) {
    if (!pool) return;
    try {
      await pool.query(`
        INSERT INTO vehicles (
          id, registration_no, name_model, vehicle_type, device_id, imei_number, chassis_number,
          fuel_type, assigned_user_id, status, current_speed, max_speed_limit, current_lat, current_lng, odometer_km, axle_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (registration_no) DO UPDATE SET
          name_model = EXCLUDED.name_model,
          vehicle_type = EXCLUDED.vehicle_type,
          assigned_user_id = EXCLUDED.assigned_user_id,
          status = EXCLUDED.status,
          current_speed = EXCLUDED.current_speed,
          current_lat = EXCLUDED.current_lat,
          current_lng = EXCLUDED.current_lng,
          odometer_km = EXCLUDED.odometer_km,
          axle_type = EXCLUDED.axle_type,
          updated_at = CURRENT_TIMESTAMP
      `, [v.id, v.registration_no, v.name_model, v.vehicle_type, v.device_id || null, v.imei_number || null,
          v.chassis_number || null, v.fuel_type || 'Diesel', v.assigned_user_id || null, v.status || 'active',
          v.current_speed || 0, v.max_speed_limit || 80, v.current_lat || null, v.current_lng || null, v.odometer_km || 0, v.axle_type || '4-axle']);
      console.log(`[Supabase] Synced vehicle: ${v.registration_no}`);
    } catch (err) {
      console.error('[Supabase syncVehicle Error]:', err.message);
    }
  },

  // Delete vehicle from Supabase
  async deleteVehicle(vehicleId, regNo) {
    if (!pool) return;
    try {
      if (regNo) {
        await pool.query('DELETE FROM fastag_transactions WHERE vehicle_registration_no = $1', [regNo]);
        await pool.query('DELETE FROM vehicles WHERE registration_no = $1', [regNo]);
      }
      await pool.query('DELETE FROM fastag_transactions WHERE vehicle_id = $1', [vehicleId]);
      await pool.query('DELETE FROM routes WHERE vehicle_id = $1', [vehicleId]);
      await pool.query('DELETE FROM vehicle_allocations WHERE vehicle_id = $1', [vehicleId]);
      await pool.query('DELETE FROM vehicles WHERE id = $1', [vehicleId]);
      console.log(`[Supabase] Permanently deleted vehicle ID: ${vehicleId} (${regNo || ''})`);
    } catch (err) {
      console.error('[Supabase deleteVehicle Error]:', err.message);
    }
  },

  // Sync route and allocated highway corridor to Supabase
  async syncRoute(r) {
    if (!pool) return;
    try {
      await pool.query(`
        INSERT INTO routes (
          id, vehicle_id, route_name, start_location_name, start_address, start_lat, start_lng,
          end_location_name, end_address, end_lat, end_lng, total_distance_km, estimated_travel_time_min,
          overview_polyline, route_color, waypoints_json, toll_gates_json, alternative_routes_json,
          trip_date, end_trip_date, start_trip_time, end_trip_time, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
        ON CONFLICT (id) DO UPDATE SET
          route_name = EXCLUDED.route_name,
          vehicle_id = EXCLUDED.vehicle_id,
          start_location_name = EXCLUDED.start_location_name,
          end_location_name = EXCLUDED.end_location_name,
          total_distance_km = EXCLUDED.total_distance_km,
          estimated_travel_time_min = EXCLUDED.estimated_travel_time_min,
          overview_polyline = EXCLUDED.overview_polyline,
          toll_gates_json = EXCLUDED.toll_gates_json,
          trip_date = EXCLUDED.trip_date,
          end_trip_date = EXCLUDED.end_trip_date,
          start_trip_time = EXCLUDED.start_trip_time,
          end_trip_time = EXCLUDED.end_trip_time,
          is_active = EXCLUDED.is_active,
          updated_at = CURRENT_TIMESTAMP
      `, [r.id, r.vehicle_id || null, r.route_name, r.start_location_name, r.start_address || '', r.start_lat, r.start_lng,
          r.end_location_name, r.end_address || '', r.end_lat, r.end_lng, r.total_distance_km, r.estimated_travel_time_min,
          r.overview_polyline || '', r.route_color || '#E60012', r.waypoints_json || '[]', r.toll_gates_json || '[]',
          r.alternative_routes_json || '[]', r.trip_date || null, r.end_trip_date || null, r.start_trip_time || null, r.end_trip_time || null, r.is_active !== undefined ? r.is_active : 1]);
      console.log(`[Supabase] Synced route: ${r.route_name}`);
    } catch (err) {
      console.error('[Supabase syncRoute Error]:', err.message);
    }
  },

  // Delete route from Supabase
  async deleteRoute(routeId) {
    if (!pool) return;
    try {
      await pool.query('DELETE FROM stoppages WHERE route_id = $1', [routeId]);
      await pool.query('DELETE FROM manual_toll_gates WHERE route_id = $1', [routeId]);
      await pool.query('DELETE FROM routes WHERE id = $1', [routeId]);
      console.log(`[Supabase] Permanently deleted route ID: ${routeId}`);
    } catch (err) {
      console.error('[Supabase deleteRoute Error]:', err.message);
    }
  },

  // Sync FASTag Toll transaction to Supabase
  async syncFastagTransaction(tx) {
    if (!pool) return;
    try {
      await pool.query(`
        INSERT INTO fastag_transactions (
          transaction_id, netc_reference_no, tag_id, vehicle_id, vehicle_registration_no,
          vehicle_class, route_id, toll_plaza_name, highway_name, lat, lng, amount,
          base_toll_fee, gst_amount, concessionaire_name, gstin, lane_direction,
          payment_status, wallet_balance_before, wallet_balance_after, crossing_time
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
        ON CONFLICT (transaction_id) DO UPDATE SET
          amount = EXCLUDED.amount,
          payment_status = EXCLUDED.payment_status,
          wallet_balance_after = EXCLUDED.wallet_balance_after
      `, [tx.transaction_id, tx.netc_reference_no, tx.tag_id, tx.vehicle_id || null, tx.vehicle_registration_no,
          tx.vehicle_class || 'Commercial Truck', tx.route_id || null, tx.toll_plaza_name, tx.highway_name || '',
          tx.lat, tx.lng, tx.amount, tx.base_toll_fee, tx.gst_amount || 0, tx.concessionaire_name || '',
          tx.gstin || '', tx.lane_direction || '', tx.payment_status || 'SUCCESS',
          tx.wallet_balance_before || 15000, tx.wallet_balance_after || 14000,
          tx.crossing_time || new Date().toISOString()]);
      console.log(`[Supabase] Synced FASTag transaction: ${tx.transaction_id}`);
    } catch (err) {
      console.error('[Supabase syncFastag Error]:', err.message);
    }
  },

  // Log user / admin login event into Supabase
  async logUserLogin(login) {
    if (!pool) return;
    try {
      await pool.query(`
        INSERT INTO user_logins (
          user_id, email, user_name, role, ip_address, user_agent, device_type, login_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        login.user_id || null,
        login.email,
        login.user_name || null,
        login.role || 'user',
        login.ip_address || '127.0.0.1',
        login.user_agent || 'Unknown Browser',
        login.device_type || 'Desktop/Mobile',
        login.login_status || 'SUCCESS'
      ]);
      console.log(`[Supabase] Logged login event for: ${login.email} (${login.login_status})`);
    } catch (err) {
      console.error('[Supabase logUserLogin Error]:', err.message);
    }
  },

  // Sync vehicle allocation to Supabase
  async syncVehicleAllocation(alloc) {
    if (!pool) return;
    try {
      await pool.query(`
        INSERT INTO vehicle_allocations (
          vehicle_id, user_id, allocated_by, route_id, allocation_status, notes
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        alloc.vehicle_id,
        alloc.user_id,
        alloc.allocated_by || null,
        alloc.route_id || null,
        alloc.allocation_status || 'ACTIVE',
        alloc.notes || 'Admin vehicle & route corridor allotment'
      ]);
      console.log(`[Supabase] Synced vehicle allocation: Vehicle ${alloc.vehicle_id} -> User ${alloc.user_id}`);
    } catch (err) {
      console.error('[Supabase syncVehicleAllocation Error]:', err.message);
    }
  },

  // Hydrate local SQLite from live Supabase on server start (ensures persistent storage on Render)
  async syncFromSupabaseToSqlite(localDb) {
    if (!pool) return;
    const toSql = (v) => {
      if (v === undefined || v === null) return null;
      if (v instanceof Date) return v.toISOString().replace('T', ' ').substring(0, 19);
      if (typeof v === 'boolean') return v ? 1 : 0;
      if (typeof v === 'object' && !(v instanceof Buffer)) return JSON.stringify(v);
      return v;
    };

    try {
      console.log('>>> [Supabase -> SQLite] Hydrating live cloud data into local database...');
      // 1. Sync Users
      const usersRes = await pool.query('SELECT * FROM users');
      if (usersRes.rows.length > 0) {
        const insertUser = localDb.prepare(`
          INSERT OR REPLACE INTO users (id, name, email, password, phone, role, status, avatar_color, company_name)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const u of usersRes.rows) {
          insertUser.run(
            toSql(u.id), toSql(u.name), toSql(u.email), toSql(u.password), toSql(u.phone),
            toSql(u.role || 'user'), toSql(u.status || 'active'), toSql(u.avatar_color || '#E60012'), toSql(u.company_name)
          );
        }
      }

      // 2. Sync Vehicles
      const vehRes = await pool.query('SELECT * FROM vehicles');
      if (vehRes.rows.length > 0) {
        const insertVeh = localDb.prepare(`
          INSERT OR REPLACE INTO vehicles (
            id, registration_no, name_model, vehicle_type, device_id, imei_number, chassis_number,
            fuel_type, assigned_user_id, status, current_speed, max_speed_limit, current_lat, current_lng, odometer_km, axle_type
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const v of vehRes.rows) {
          insertVeh.run(
            toSql(v.id), toSql(v.registration_no), toSql(v.name_model), toSql(v.vehicle_type),
            toSql(v.device_id), toSql(v.imei_number), toSql(v.chassis_number), toSql(v.fuel_type || 'Diesel'),
            toSql(v.assigned_user_id), toSql(v.status || 'active'), toSql(v.current_speed || 0),
            toSql(v.max_speed_limit || 80), toSql(v.current_lat), toSql(v.current_lng),
            toSql(v.odometer_km || 0), toSql(v.axle_type || '4-axle')
          );
        }
      }

      // 3. Sync Routes
      const routeRes = await pool.query('SELECT * FROM routes');
      if (routeRes.rows.length > 0) {
        const insertRoute = localDb.prepare(`
          INSERT OR REPLACE INTO routes (
            id, vehicle_id, route_name, start_location_name, start_address, start_lat, start_lng,
            end_location_name, end_address, end_lat, end_lng, total_distance_km, estimated_travel_time_min,
            overview_polyline, route_color, waypoints_json, toll_gates_json, alternative_routes_json,
            trip_date, end_trip_date, start_trip_time, end_trip_time, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const r of routeRes.rows) {
          insertRoute.run(
            toSql(r.id), toSql(r.vehicle_id), toSql(r.route_name), toSql(r.start_location_name),
            toSql(r.start_address || ''), toSql(r.start_lat), toSql(r.start_lng),
            toSql(r.end_location_name), toSql(r.end_address || ''), toSql(r.end_lat), toSql(r.end_lng),
            toSql(r.total_distance_km), toSql(r.estimated_travel_time_min),
            toSql(r.overview_polyline || ''), toSql(r.route_color || '#E60012'),
            toSql(r.waypoints_json || '[]'), toSql(r.toll_gates_json || '[]'),
            toSql(r.alternative_routes_json || '[]'), toSql(r.trip_date),
            toSql(r.end_trip_date), toSql(r.start_trip_time), toSql(r.end_trip_time),
            toSql(r.is_active !== undefined ? r.is_active : 1)
          );
        }
      }

      // 4. Sync Vehicle Allocations
      const allocRes = await pool.query('SELECT * FROM vehicle_allocations');
      if (allocRes.rows.length > 0) {
        const insertAlloc = localDb.prepare(`
          INSERT OR REPLACE INTO vehicle_allocations (
            id, vehicle_id, user_id, allocated_by, route_id, allocation_status, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const a of allocRes.rows) {
          insertAlloc.run(
            toSql(a.id), toSql(a.vehicle_id), toSql(a.user_id), toSql(a.allocated_by),
            toSql(a.route_id), toSql(a.allocation_status || 'ACTIVE'),
            toSql(a.notes || 'Admin vehicle & route corridor allotment')
          );
        }
      }

      // 5. Sync FASTag Transactions
      const fastagRes = await pool.query('SELECT * FROM fastag_transactions');
      if (fastagRes.rows.length > 0) {
        const insertTx = localDb.prepare(`
          INSERT OR REPLACE INTO fastag_transactions (
            id, transaction_id, netc_reference_no, tag_id, vehicle_id, vehicle_registration_no,
            vehicle_class, route_id, toll_plaza_name, highway_name, lat, lng, amount,
            base_toll_fee, gst_amount, concessionaire_name, gstin, lane_direction,
            payment_status, crossing_time, wallet_balance_before, wallet_balance_after
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const tx of fastagRes.rows) {
          insertTx.run(
            toSql(tx.id), toSql(tx.transaction_id), toSql(tx.netc_reference_no), toSql(tx.tag_id),
            toSql(tx.vehicle_id), toSql(tx.vehicle_registration_no),
            toSql(tx.vehicle_class || 'Commercial Truck'), toSql(tx.route_id),
            toSql(tx.toll_plaza_name), toSql(tx.highway_name || ''),
            toSql(tx.lat), toSql(tx.lng), toSql(tx.amount),
            toSql(tx.base_toll_fee), toSql(tx.gst_amount || 0),
            toSql(tx.concessionaire_name || ''), toSql(tx.gstin || ''),
            toSql(tx.lane_direction || ''), toSql(tx.payment_status || 'SUCCESS'),
            toSql(tx.crossing_time || new Date()),
            toSql(tx.wallet_balance_before || 15000), toSql(tx.wallet_balance_after || 14000)
          );
        }
      }

      console.log(`>>> [Supabase -> SQLite] Hydration complete: ${usersRes.rows.length} users, ${vehRes.rows.length} vehicles, ${routeRes.rows.length} routes, ${allocRes.rows.length} allocations, ${fastagRes.rows.length} FASTag transactions.`);
    } catch (err) {
      console.error('[Supabase -> SQLite Sync Error]:', err.message);
    }
  }
};

module.exports = supabaseService;
