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
      const res = await pool.query(`
        INSERT INTO users (name, email, password, phone, role, status, avatar_color, company_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (email) DO UPDATE SET
          name = EXCLUDED.name,
          password = COALESCE(EXCLUDED.password, users.password),
          phone = COALESCE(EXCLUDED.phone, users.phone),
          role = EXCLUDED.role,
          status = EXCLUDED.status,
          company_name = COALESCE(EXCLUDED.company_name, users.company_name)
        RETURNING id
      `, [user.name, user.email, user.password, user.phone || null, user.role || 'user', user.status || 'active', user.avatar_color || '#E60012', user.company_name || null]);
      console.log(`[Supabase] Synced user: ${user.email} (ID: ${res.rows[0]?.id})`);
      return res.rows[0]?.id;
    } catch (err) {
      console.error('[Supabase syncUser Error]:', err.message);
    }
  },

  // Delete user from Supabase and delete any vehicles assigned to them
  async deleteUser(userId) {
    if (!pool) return;
    try {
      // Find all vehicles assigned to this user in Supabase and permanently delete them
      try {
        const vehRes = await pool.query('SELECT id FROM vehicles WHERE assigned_user_id = $1', [userId]);
        for (const row of vehRes.rows) {
          await this.deleteVehicle(row.id);
        }
      } catch (vehErr) {
        console.error('[Supabase deleteUser Vehicles Warning]:', vehErr.message);
      }

      await pool.query('DELETE FROM user_logins WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM vehicle_allocations WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      console.log(`[Supabase] Permanently deleted user ID: ${userId} and associated vehicles`);
    } catch (err) {
      console.error('[Supabase deleteUser Error]:', err.message);
    }
  },

  // Sync new/updated vehicle to Supabase
  async syncVehicle(v, localDb) {
    if (!pool) return;
    try {
      // 1. Resolve assigned user in Supabase by email or phone to prevent foreign key errors
      let supabaseUserId = null;
      if (v.assigned_user_id) {
        let userEmail = null;
        let userPhone = null;
        let fullUser = null;
        if (localDb) {
          try {
            fullUser = localDb.prepare('SELECT * FROM users WHERE id = ?').get(v.assigned_user_id);
            if (fullUser) { userEmail = fullUser.email; userPhone = fullUser.phone; }
          } catch (e) { }
        }
        if (userEmail || userPhone) {
          const uRes = await pool.query('SELECT id FROM users WHERE email = $1 OR (phone IS NOT NULL AND phone = $2)', [userEmail, userPhone]);
          if (uRes.rows.length > 0) {
            supabaseUserId = uRes.rows[0].id;
          } else if (fullUser) {
            supabaseUserId = await this.syncUser(fullUser);
          }
        } else {
          // Check if id exists directly in Supabase
          const directU = await pool.query('SELECT id FROM users WHERE id = $1', [v.assigned_user_id]);
          if (directU.rows.length > 0) {
            supabaseUserId = directU.rows[0].id;
          } else if (fullUser) {
            supabaseUserId = await this.syncUser(fullUser);
          }
        }
      }

      // Fallback: If supabaseUserId is still not resolved, but vehicle has owner_name, match user by name or company_name
      if (!supabaseUserId && v.owner_name) {
        const ownerRes = await pool.query('SELECT id FROM users WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) OR LOWER(TRIM(company_name)) = LOWER(TRIM($1))', [v.owner_name]);
        if (ownerRes.rows.length > 0) {
          supabaseUserId = ownerRes.rows[0].id;
        }
      }

      const res = await pool.query(`
        INSERT INTO vehicles (
          registration_no, name_model, vehicle_type, device_id, imei_number, chassis_number,
          fuel_type, assigned_user_id, status, current_speed, max_speed_limit, current_lat, current_lng,
          odometer_km, axle_type, owner_name, total_toll_fee
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT (registration_no) DO UPDATE SET
          name_model = EXCLUDED.name_model,
          vehicle_type = EXCLUDED.vehicle_type,
          device_id = COALESCE(EXCLUDED.device_id, vehicles.device_id),
          imei_number = COALESCE(EXCLUDED.imei_number, vehicles.imei_number),
          chassis_number = COALESCE(EXCLUDED.chassis_number, vehicles.chassis_number),
          fuel_type = COALESCE(EXCLUDED.fuel_type, vehicles.fuel_type),
          assigned_user_id = COALESCE(EXCLUDED.assigned_user_id, vehicles.assigned_user_id),
          status = EXCLUDED.status,
          current_speed = EXCLUDED.current_speed,
          max_speed_limit = EXCLUDED.max_speed_limit,
          current_lat = EXCLUDED.current_lat,
          current_lng = EXCLUDED.current_lng,
          odometer_km = EXCLUDED.odometer_km,
          axle_type = EXCLUDED.axle_type,
          owner_name = COALESCE(EXCLUDED.owner_name, vehicles.owner_name),
          total_toll_fee = GREATEST(EXCLUDED.total_toll_fee, vehicles.total_toll_fee),
          updated_at = CURRENT_TIMESTAMP
        RETURNING id
      `, [
        v.registration_no,
        v.name_model,
        v.vehicle_type || 'Commercial Truck (HCV / 3-Axle Truck)',
        v.device_id || null,
        v.imei_number || null,
        v.chassis_number || null,
        v.fuel_type || 'Diesel',
        supabaseUserId,
        v.status || 'stop',
        v.current_speed || 0,
        v.max_speed_limit || 80,
        v.current_lat || 23.0125,
        v.current_lng || 79.0841,
        v.odometer_km || 0,
        v.axle_type || '3-Axle Rigid',
        v.owner_name || null,
        v.total_toll_fee || 0
      ]);
      console.log(`[Supabase Log] Synced vehicle: ${v.registration_no} (Supabase ID: ${res.rows[0]?.id}, Assigned User ID: ${supabaseUserId})`);
      return res.rows[0]?.id;
    } catch (err) {
      console.error('[Supabase syncVehicle Error]:', err.message);
    }
  },

  // Delete vehicle from Supabase
  async deleteVehicle(vehicleId) {
    if (!pool) return;
    try {
      await pool.query('DELETE FROM fastag_transactions WHERE vehicle_id = $1', [vehicleId]);
      await pool.query('DELETE FROM routes WHERE vehicle_id = $1', [vehicleId]);
      await pool.query('DELETE FROM vehicle_allocations WHERE vehicle_id = $1', [vehicleId]);
      await pool.query('DELETE FROM vehicles WHERE id = $1', [vehicleId]);
      console.log(`[Supabase] Permanently deleted vehicle ID: ${vehicleId}`);
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
          trip_date, start_trip_time, end_trip_time, is_active, end_trip_date
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
          end_trip_date = EXCLUDED.end_trip_date,
          updated_at = CURRENT_TIMESTAMP
      `, [r.id, r.vehicle_id || null, r.route_name, r.start_location_name, r.start_address || '', r.start_lat, r.start_lng,
      r.end_location_name, r.end_address || '', r.end_lat, r.end_lng, r.total_distance_km, r.estimated_travel_time_min,
      r.overview_polyline || '', r.route_color || '#E60012', r.waypoints_json || '[]', r.toll_gates_json || '[]',
      r.alternative_routes_json || '[]', r.trip_date || null, r.start_trip_time || null, r.end_trip_time || null, r.is_active !== undefined ? r.is_active : 1, r.end_trip_date || null]);
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

  // Ensure saved_corridors table exists in Supabase
  async ensureCorridorsTable() {
    if (!pool) return;
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS saved_corridors (
          id SERIAL PRIMARY KEY,
          route_name TEXT NOT NULL,
          start_location_name TEXT NOT NULL,
          start_address TEXT,
          start_lat DOUBLE PRECISION NOT NULL,
          start_lng DOUBLE PRECISION NOT NULL,
          end_location_name TEXT NOT NULL,
          end_address TEXT,
          end_lat DOUBLE PRECISION NOT NULL,
          end_lng DOUBLE PRECISION NOT NULL,
          total_distance_km DOUBLE PRECISION DEFAULT 0,
          estimated_travel_time_min INTEGER DEFAULT 0,
          overview_polyline TEXT,
          waypoints_json TEXT DEFAULT '[]',
          toll_gates_json TEXT DEFAULT '[]',
          alternative_routes_json TEXT DEFAULT '[]',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } catch (e) {
      console.error('[Supabase ensureCorridorsTable Warning]:', e.message);
    }
  },

  // Sync saved corridor permanently to Supabase
  async syncCorridor(c) {
    if (!pool || !c) return;
    try {
      await this.ensureCorridorsTable();
      const wp = typeof c.waypoints_json === 'string' ? c.waypoints_json : JSON.stringify(c.waypoints_json || c.waypoints || []);
      const tg = typeof c.toll_gates_json === 'string' ? c.toll_gates_json : JSON.stringify(c.toll_gates_json || c.toll_gates || []);
      const poly = typeof c.overview_polyline === 'string' ? c.overview_polyline : JSON.stringify(c.overview_polyline || []);

      const existing = await pool.query('SELECT id FROM saved_corridors WHERE LOWER(TRIM(route_name)) = LOWER(TRIM($1))', [c.route_name.trim()]);
      if (existing && existing.rows.length > 0) {
        await pool.query(`
          UPDATE saved_corridors SET
            start_location_name = $1, start_address = $2, start_lat = $3, start_lng = $4,
            end_location_name = $5, end_address = $6, end_lat = $7, end_lng = $8,
            total_distance_km = $9, estimated_travel_time_min = $10,
            overview_polyline = $11, waypoints_json = $12, toll_gates_json = $13,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $14
        `, [
          c.start_location_name, c.start_address || '', c.start_lat, c.start_lng,
          c.end_location_name, c.end_address || '', c.end_lat, c.end_lng,
          c.total_distance_km || 0, c.estimated_travel_time_min || 0,
          poly, wp, tg, existing.rows[0].id
        ]);
      } else {
        await pool.query(`
          INSERT INTO saved_corridors (
            route_name, start_location_name, start_address, start_lat, start_lng,
            end_location_name, end_address, end_lat, end_lng,
            total_distance_km, estimated_travel_time_min,
            overview_polyline, waypoints_json, toll_gates_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        `, [
          c.route_name.trim(), c.start_location_name, c.start_address || '', c.start_lat, c.start_lng,
          c.end_location_name, c.end_address || '', c.end_lat, c.end_lng,
          c.total_distance_km || 0, c.estimated_travel_time_min || 0,
          poly, wp, tg
        ]);
      }
      console.log(`[Supabase] Synced saved corridor permanently: ${c.route_name}`);
    } catch (err) {
      console.error('[Supabase syncCorridor Error]:', err.message);
    }
  },

  // Sync FASTag Toll transaction to Supabase
  async syncFastagTransaction(tx) {
    if (!pool) return;
    try {
      let supabaseVehId = null;
      if (tx.vehicle_registration_no) {
        const vRes = await pool.query('SELECT id FROM vehicles WHERE registration_no = $1', [tx.vehicle_registration_no]);
        if (vRes.rows.length > 0) supabaseVehId = vRes.rows[0].id;
      }

      await pool.query(`
        INSERT INTO fastag_transactions (
          transaction_id, netc_reference_no, tag_id, vehicle_id, vehicle_registration_no,
          vehicle_class, route_id, toll_plaza_name, description, highway_name, lat, lng, amount,
          base_toll_fee, gst_amount, concessionaire_name, gstin, lane_direction,
          payment_status, crossing_time, wallet_balance_before, wallet_balance_after
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
        ON CONFLICT (transaction_id) DO UPDATE SET
          toll_plaza_name = EXCLUDED.toll_plaza_name,
          description = EXCLUDED.description,
          amount = EXCLUDED.amount,
          crossing_time = EXCLUDED.crossing_time,
          wallet_balance_before = EXCLUDED.wallet_balance_before,
          wallet_balance_after = EXCLUDED.wallet_balance_after
      `, [
        tx.transaction_id,
        tx.netc_reference_no,
        tx.tag_id,
        supabaseVehId,
        tx.vehicle_registration_no,
        tx.vehicle_class || 'Commercial Truck (HCV / 3-Axle Truck)',
        tx.route_id || null,
        tx.toll_plaza_name,
        tx.description || tx.toll_plaza_name,
        tx.highway_name || '',
        tx.lat || 23.0125,
        tx.lng || 79.0841,
        tx.amount,
        tx.base_toll_fee || tx.amount,
        tx.gst_amount || 0,
        tx.concessionaire_name || 'National Highways Authority of India (NHAI)',
        tx.gstin || '22AAACN0123M1Z5',
        tx.lane_direction || 'Lane 04 - Dedicated FASTag ETC',
        tx.payment_status || 'SUCCESS',
        tx.crossing_time || new Date().toISOString(),
        tx.wallet_balance_before || 15000,
        tx.wallet_balance_after || 14000
      ]);
    } catch (err) {
      console.error('[Supabase syncFastag Error]:', err.message);
    }
  },

  // Batch sync FASTag Toll transactions to Supabase with multi-row SQL chunking
  async syncFastagTransactionsBatch(txList) {
    if (!pool || !Array.isArray(txList) || txList.length === 0) return;
    try {
      // Resolve Supabase vehicle ID for distinct registration_nos
      const regMap = new Map();
      for (const tx of txList) {
        if (tx.vehicle_registration_no && !regMap.has(tx.vehicle_registration_no)) {
          regMap.set(tx.vehicle_registration_no, null);
        }
      }

      for (const reg of regMap.keys()) {
        try {
          const vRow = await pool.query('SELECT id FROM vehicles WHERE registration_no = $1', [reg]);
          if (vRow && vRow.rows.length > 0) regMap.set(reg, vRow.rows[0].id);
        } catch (e) { }
      }

      const CHUNK_SIZE = 40;
      for (let i = 0; i < txList.length; i += CHUNK_SIZE) {
        const chunk = txList.slice(i, i + CHUNK_SIZE);
        const valuePlaceholders = [];
        const queryParams = [];
        let paramIdx = 1;

        for (const tx of chunk) {
          const supabaseVehId = (tx.vehicle_registration_no ? regMap.get(tx.vehicle_registration_no) : null) || tx.vehicle_id || null;
          const placeholders = [];
          const fields = [
            tx.transaction_id,
            tx.netc_reference_no,
            tx.tag_id,
            supabaseVehId,
            tx.vehicle_registration_no,
            tx.vehicle_class || 'Commercial Truck (HCV / 3-Axle Truck)',
            tx.route_id || null,
            tx.toll_plaza_name,
            tx.description || tx.toll_plaza_name,
            tx.highway_name || '',
            Number(tx.lat || 0),
            Number(tx.lng || 0),
            Number(tx.amount || 0),
            Number(tx.base_toll_fee || tx.amount || 0),
            Number(tx.gst_amount || 0),
            tx.concessionaire_name || 'National Highways Authority of India (NHAI)',
            tx.gstin || '22AAACN0123M1Z5',
            tx.lane_direction || 'Lane 04 - Dedicated FASTag ETC',
            tx.payment_status || 'SUCCESS',
            tx.crossing_time ? (typeof tx.crossing_time === 'string' ? tx.crossing_time : new Date(tx.crossing_time).toISOString()) : new Date().toISOString(),
            Number(tx.wallet_balance_before || 15000),
            Number(tx.wallet_balance_after || 14000)
          ];

          for (const val of fields) {
            placeholders.push(`$${paramIdx++}`);
            queryParams.push(val);
          }
          valuePlaceholders.push(`(${placeholders.join(', ')})`);
        }

        const sql = `
          INSERT INTO fastag_transactions (
            transaction_id, netc_reference_no, tag_id, vehicle_id, vehicle_registration_no,
            vehicle_class, route_id, toll_plaza_name, description, highway_name, lat, lng, amount,
            base_toll_fee, gst_amount, concessionaire_name, gstin, lane_direction,
            payment_status, crossing_time, wallet_balance_before, wallet_balance_after
          ) VALUES ${valuePlaceholders.join(', ')}
          ON CONFLICT (transaction_id) DO UPDATE SET
            toll_plaza_name = EXCLUDED.toll_plaza_name,
            description = EXCLUDED.description,
            amount = EXCLUDED.amount,
            crossing_time = EXCLUDED.crossing_time,
            wallet_balance_before = EXCLUDED.wallet_balance_before,
            wallet_balance_after = EXCLUDED.wallet_balance_after
        `;

        await pool.query(sql, queryParams);
      }
      console.log(`[Supabase] Batch synced ${txList.length} FASTag transactions via multi-row query.`);
    } catch (err) {
      console.error('[Supabase syncFastagTransactionsBatch Error]:', err.message);
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
      let vehId = alloc.vehicle_id;
      if (alloc.registration_no) {
        const vRow = await pool.query('SELECT id FROM vehicles WHERE registration_no = $1', [alloc.registration_no]);
        if (vRow.rows.length > 0) vehId = vRow.rows[0].id;
      }
      let usrId = alloc.user_id;
      if (alloc.user_phone || alloc.user_email) {
        const uRow = await pool.query('SELECT id FROM users WHERE phone = $1 OR email = $2', [alloc.user_phone || '', alloc.user_email || '']);
        if (uRow.rows.length > 0) usrId = uRow.rows[0].id;
      }

      if (!vehId || !usrId) {
        console.warn(`[Supabase Allocation Log] Skipped: vehId=${vehId}, usrId=${usrId}`);
        return;
      }

      const existing = await pool.query('SELECT id FROM vehicle_allocations WHERE vehicle_id = $1 AND user_id = $2', [vehId, usrId]);
      if (existing.rows.length > 0) {
        await pool.query('UPDATE vehicle_allocations SET allocation_status = $1, notes = $2 WHERE id = $3', [
          alloc.allocation_status || 'ACTIVE',
          alloc.notes || 'Admin vehicle & route corridor allotment',
          existing.rows[0].id
        ]);
        console.log(`[Supabase Log] Updated vehicle allocation: Vehicle ${vehId} -> User ${usrId}`);
        return;
      }

      await pool.query(`
        INSERT INTO vehicle_allocations (
          vehicle_id, user_id, allocated_by, route_id, allocation_status, notes
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        vehId,
        usrId,
        alloc.allocated_by || null,
        alloc.route_id || null,
        alloc.allocation_status || 'ACTIVE',
        alloc.notes || 'Admin vehicle & route corridor allotment'
      ]);
      console.log(`[Supabase Log] Created vehicle allocation: Vehicle ${vehId} -> User ${usrId}`);
    } catch (err) {
      console.error('[Supabase syncVehicleAllocation Error]:', err.message);
    }
  },

  // Hydrate local SQLite from live Supabase on server start (ensures persistent storage on Render)
  async syncFromSupabaseToSqlite(localDb) {
    if (!pool) return;
    const t0 = Date.now();
    try {
      console.log('>>> [Supabase -> SQLite] Hydrating live cloud data into local database...');
      // Temporarily disable foreign keys during hydration so differing IDs across tables don't block restore
      try { localDb.pragma('foreign_keys = OFF'); } catch (e) { }

      await this.ensureCorridorsTable();

      // Parallel fetch from Supabase
      const [usersRes, vehRes, routeRes, allocRes, fastagRes, corridorsRes] = await Promise.all([
        pool.query('SELECT * FROM users').catch(e => { console.error('[Hydration Users Query Error]:', e.message); return { rows: [] }; }),
        pool.query('SELECT * FROM vehicles').catch(e => { console.error('[Hydration Vehicles Query Error]:', e.message); return { rows: [] }; }),
        pool.query('SELECT * FROM routes').catch(e => { console.error('[Hydration Routes Query Error]:', e.message); return { rows: [] }; }),
        pool.query('SELECT * FROM vehicle_allocations').catch(e => { console.error('[Hydration Alloc Query Error]:', e.message); return { rows: [] }; }),
        pool.query('SELECT * FROM fastag_transactions').catch(e => { console.error('[Hydration Fastag Query Error]:', e.message); return { rows: [] }; }),
        pool.query('SELECT * FROM saved_corridors').catch(e => { console.error('[Hydration Corridors Query Error]:', e.message); return { rows: [] }; })
      ]);

      console.log(`>>> [Supabase -> SQLite] Fetched cloud data in ${Date.now() - t0}ms: Users=${usersRes.rows.length}, Vehicles=${vehRes.rows.length}, FASTag=${fastagRes.rows.length}`);

      // 1. Sync Users into SQLite
      const supabaseToLocalUserMap = new Map();
      if (usersRes.rows.length > 0) {
        const insertUser = localDb.prepare(`
          INSERT OR REPLACE INTO users (id, name, email, password, phone, role, status, avatar_color, company_name)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const syncUsersTx = localDb.transaction((users) => {
          for (const u of users) {
            insertUser.run(
              u.id, u.name, u.email, u.password, u.phone || null,
              u.role || 'user', u.status || 'active',
              u.avatar_color || '#E60012', u.company_name || null
            );
            supabaseToLocalUserMap.set(u.id, u.id);
          }
        });
        syncUsersTx(usersRes.rows);
      }

      // 2. Sync Vehicles into SQLite (Atomic transaction, 0 network roundtrips)
      if (vehRes.rows.length > 0) {
        const upsertVeh = localDb.prepare(`
          INSERT INTO vehicles (
            registration_no, name_model, vehicle_type, device_id, imei_number, chassis_number,
            fuel_type, assigned_user_id, status, current_speed, max_speed_limit, current_lat, current_lng,
            odometer_km, axle_type, owner_name, total_toll_fee
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (registration_no) DO UPDATE SET
            name_model = excluded.name_model,
            vehicle_type = excluded.vehicle_type,
            device_id = COALESCE(excluded.device_id, vehicles.device_id),
            imei_number = COALESCE(excluded.imei_number, vehicles.imei_number),
            chassis_number = COALESCE(excluded.chassis_number, vehicles.chassis_number),
            fuel_type = COALESCE(excluded.fuel_type, vehicles.fuel_type),
            assigned_user_id = COALESCE(excluded.assigned_user_id, vehicles.assigned_user_id),
            status = excluded.status,
            current_speed = excluded.current_speed,
            max_speed_limit = excluded.max_speed_limit,
            current_lat = excluded.current_lat,
            current_lng = excluded.current_lng,
            odometer_km = excluded.odometer_km,
            axle_type = excluded.axle_type,
            owner_name = COALESCE(excluded.owner_name, vehicles.owner_name),
            total_toll_fee = MAX(excluded.total_toll_fee, vehicles.total_toll_fee)
        `);

        const syncVehiclesTx = localDb.transaction((vehs) => {
          for (const v of vehs) {
            let localUserId = v.assigned_user_id ? (supabaseToLocalUserMap.get(v.assigned_user_id) || null) : null;
            if (!localUserId && v.owner_name) {
              const matchedUser = localDb.prepare('SELECT id FROM users WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) OR LOWER(TRIM(company_name)) = LOWER(TRIM(?))').get(v.owner_name, v.owner_name);
              if (matchedUser) localUserId = matchedUser.id;
            }
            upsertVeh.run(
              v.registration_no, v.name_model, v.vehicle_type, v.device_id || null, v.imei_number || null,
              v.chassis_number || null, v.fuel_type || 'Diesel', localUserId,
              v.status || 'stop', v.current_speed || 0, v.max_speed_limit || 80,
              v.current_lat || 23.0125, v.current_lng || 79.0841, v.odometer_km || 0,
              v.axle_type || '3-Axle Rigid', v.owner_name || null, v.total_toll_fee || 0
            );
          }
        });
        syncVehiclesTx(vehRes.rows);
      }

      // 3. Sync Routes
      if (routeRes && routeRes.rows.length > 0) {
        const insertRoute = localDb.prepare(`
          INSERT OR REPLACE INTO routes (
            id, vehicle_id, route_name, start_location_name, start_address, start_lat, start_lng,
            end_location_name, end_address, end_lat, end_lng, total_distance_km, estimated_travel_time_min,
            overview_polyline, route_color, waypoints_json, toll_gates_json, alternative_routes_json,
            trip_date, end_trip_date, start_trip_time, end_trip_time, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const syncRoutesTx = localDb.transaction((routes) => {
          for (const r of routes) {
            insertRoute.run(
              r.id, r.vehicle_id || null, r.route_name, r.start_location_name, r.start_address || '', r.start_lat, r.start_lng,
              r.end_location_name, r.end_address || '', r.end_lat, r.end_lng, r.total_distance_km, r.estimated_travel_time_min,
              r.overview_polyline || '', r.route_color || '#E60012', r.waypoints_json || '[]', r.toll_gates_json || '[]',
              r.alternative_routes_json || '[]', r.trip_date || null, r.end_trip_date || r.trip_date || null, r.start_trip_time || null, r.end_trip_time || null, r.is_active !== undefined ? r.is_active : 1
            );
          }
        });
        syncRoutesTx(routeRes.rows);
      }

      // 4. Sync Vehicle Allocations
      if (allocRes && allocRes.rows.length > 0) {
        const insertAlloc = localDb.prepare(`
          INSERT OR REPLACE INTO vehicle_allocations (
            id, vehicle_id, user_id, allocated_by, route_id, allocation_status, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const syncAllocTx = localDb.transaction((allocs) => {
          for (const a of allocs) {
            insertAlloc.run(
              a.id, a.vehicle_id, a.user_id, a.allocated_by,
              a.route_id, a.allocation_status || 'ACTIVE',
              a.notes || 'Admin vehicle & route corridor allotment'
            );
          }
        });
        syncAllocTx(allocRes.rows);
      }

      // Auto-heal missing vehicle allocations for any vehicle that has an assigned user
      try {
        localDb.exec(`
          INSERT OR IGNORE INTO vehicle_allocations (vehicle_id, user_id, allocated_by, allocation_status, notes)
          SELECT id, assigned_user_id, 1, 'active', 'Auto-restored allocation'
          FROM vehicles
          WHERE assigned_user_id IS NOT NULL;
        `);
      } catch (e) { }

      // 5. Sync FASTag Transactions (Single SQLite transaction, instantaneous)
      if (fastagRes && fastagRes.rows.length > 0) {
        const regToVehId = new Map();
        for (const v of localDb.prepare('SELECT id, registration_no FROM vehicles').all()) {
          regToVehId.set(v.registration_no, v.id);
        }

        const insertTx = localDb.prepare(`
          INSERT INTO fastag_transactions (
            transaction_id, netc_reference_no, tag_id, vehicle_id, vehicle_registration_no,
            vehicle_class, route_id, toll_plaza_name, description, highway_name, lat, lng, amount,
            base_toll_fee, gst_amount, concessionaire_name, gstin, lane_direction,
            payment_status, crossing_time, wallet_balance_before, wallet_balance_after
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(transaction_id) DO UPDATE SET
            toll_plaza_name = excluded.toll_plaza_name,
            description = excluded.description,
            amount = excluded.amount,
            crossing_time = excluded.crossing_time,
            wallet_balance_before = excluded.wallet_balance_before,
            wallet_balance_after = excluded.wallet_balance_after
        `);

        const syncTxsTx = localDb.transaction((txs) => {
          for (const tx of txs) {
            const localVehId = regToVehId.get(tx.vehicle_registration_no) || null;
            insertTx.run(
              tx.transaction_id, tx.netc_reference_no, tx.tag_id,
              localVehId, tx.vehicle_registration_no,
              tx.vehicle_class || 'Commercial Truck (HCV / 3-Axle Truck)', tx.route_id,
              tx.toll_plaza_name, tx.description || tx.toll_plaza_name, tx.highway_name || '',
              Number(tx.lat || 0), Number(tx.lng || 0), Number(tx.amount || 0),
              Number(tx.base_toll_fee || tx.amount || 0), Number(tx.gst_amount || 0),
              tx.concessionaire_name || 'National Highways Authority of India (NHAI)',
              tx.gstin || '22AAACN0123M1Z5',
              tx.lane_direction || 'Lane 04 - Dedicated FASTag ETC',
              tx.payment_status || 'SUCCESS',
              tx.crossing_time ? (typeof tx.crossing_time === 'string' ? tx.crossing_time : new Date(tx.crossing_time).toISOString()) : new Date().toISOString(),
              Number(tx.wallet_balance_before || 15000), Number(tx.wallet_balance_after || 14000)
            );
          }
        });
        syncTxsTx(fastagRes.rows);
      }

      // 6. Sync Saved Corridors permanently between Cloud Supabase & Local SQLite
      if (corridorsRes && corridorsRes.rows && corridorsRes.rows.length > 0) {
        const insertCorridor = localDb.prepare(`
          INSERT INTO saved_corridors (
            route_name, start_location_name, start_address, start_lat, start_lng,
            end_location_name, end_address, end_lat, end_lng,
            total_distance_km, estimated_travel_time_min,
            overview_polyline, waypoints_json, toll_gates_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const existingLocalCorrs = new Set(localDb.prepare('SELECT LOWER(TRIM(route_name)) as n FROM saved_corridors').all().map(r => r.n));
        for (const cr of corridorsRes.rows) {
          const normName = (cr.route_name || '').toLowerCase().trim();
          if (normName && !existingLocalCorrs.has(normName)) {
            try {
              insertCorridor.run(
                cr.route_name, cr.start_location_name, cr.start_address || '', cr.start_lat, cr.start_lng,
                cr.end_location_name, cr.end_address || '', cr.end_lat, cr.end_lng,
                cr.total_distance_km || 0, cr.estimated_travel_time_min || 0,
                cr.overview_polyline || '', cr.waypoints_json || '[]', cr.toll_gates_json || '[]'
              );
              existingLocalCorrs.add(normName);
            } catch (_) { }
          }
        }
      }

      // Also ensure any local corridors are pushed to Cloud Supabase
      try {
        const cloudCorridorNames = new Set((corridorsRes?.rows || []).map(c => (c.route_name || '').toLowerCase().trim()));
        const localCorridors = localDb.prepare('SELECT * FROM saved_corridors').all();
        for (const lc of localCorridors) {
          const normName = (lc.route_name || '').toLowerCase().trim();
          if (normName && !cloudCorridorNames.has(normName)) {
            await this.syncCorridor(lc);
          }
        }
      } catch (_) { }

      // 7. Re-enable foreign keys & flush WAL
      localDb.pragma('foreign_keys = ON');
      localDb.pragma('wal_checkpoint(FULL)');

      // 7. Check if any local SQLite vehicles were created offline and push ONLY those missing
      const supabaseRegs = new Set(vehRes.rows.map(v => v.registration_no));
      const unsyncedVehs = localDb.prepare('SELECT * FROM vehicles').all().filter(v => !supabaseRegs.has(v.registration_no));
      if (unsyncedVehs.length > 0) {
        console.log(`>>> [Supabase Sync] Pushing ${unsyncedVehs.length} unsynced vehicles to Cloud Supabase...`);
        for (const uv of unsyncedVehs) {
          await this.syncVehicle(uv, localDb);
        }
      }

      console.log(`>>> [Supabase -> SQLite] Hydration complete in ${Date.now() - t0}ms! Total local vehicles: ${localDb.prepare('SELECT count(*) as c FROM vehicles').get().c}`);
    } catch (err) {
      console.error('[Supabase -> SQLite Sync Error]:', err.message);
    }
  }
};

module.exports = supabaseService;
