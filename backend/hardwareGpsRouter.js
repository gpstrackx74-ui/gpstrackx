const express = require('express');
const { 
  registerDevice, 
  getAllDevices, 
  getDeviceByImei, 
  deleteDevice, 
  regeneratePairingCode, 
  verifyAndLinkDevice, 
  updateDeviceTelemetry, 
  getDeviceTelemetryHistory 
} = require('./hardwareGpsDb');
const { getHostNetworkIps } = require('./gpsHardwareServer');

function createHardwareGpsRouter(mainFleetDb, authenticateToken, requireAdmin) {
  const router = express.Router();

  /**
   * 1. GET /api/hardware-gps/devices
   * Fetch all registered IMEI devices (Admin only)
   */
  router.get('/devices', authenticateToken, requireAdmin, (req, res) => {
    try {
      const devices = getAllDevices();
      res.json(devices);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * 2. POST /api/hardware-gps/register
   * Register a new IMEI & generate 6-digit pairing code (Admin only)
   */
  router.post('/register', authenticateToken, requireAdmin, (req, res) => {
    try {
      const { imei, deviceModel } = req.body;
      if (!imei || !String(imei).trim()) {
        return res.status(400).json({ error: 'IMEI number is required' });
      }

      const cleanImei = String(imei).trim();
      if (!/^\d{10,18}$/.test(cleanImei)) {
        return res.status(400).json({ error: 'IMEI must contain 10 to 18 numeric digits' });
      }

      const device = registerDevice(cleanImei, deviceModel || 'Concox GT06N');
      res.status(201).json({
        success: true,
        message: `IMEI ${cleanImei} registered successfully with 6-digit code ${device.pairing_code}`,
        device
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  /**
   * 3. DELETE /api/hardware-gps/devices/:imei
   * Delete an IMEI registration (Admin only)
   */
  router.delete('/devices/:imei', authenticateToken, requireAdmin, (req, res) => {
    try {
      const { imei } = req.params;
      const success = deleteDevice(imei);
      if (!success) {
        return res.status(404).json({ error: 'Device not found' });
      }
      res.json({ success: true, message: `Device ${imei} deleted successfully` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * 4. POST /api/hardware-gps/regenerate-code
   * Regenerate 6-digit code for an unlinked device (Admin only)
   */
  router.post('/regenerate-code', authenticateToken, requireAdmin, (req, res) => {
    try {
      const { imei } = req.body;
      if (!imei) return res.status(400).json({ error: 'IMEI is required' });

      const device = regeneratePairingCode(imei);
      res.json({
        success: true,
        message: `New 6-digit code generated for IMEI ${imei}: ${device.pairing_code}`,
        device
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  /**
   * 5. POST /api/hardware-gps/link-device
   * User side (+Add Device Modal): validates IMEI & 6-digit code against Admin database
   */
  router.post('/link-device', authenticateToken, (req, res) => {
    try {
      const { vehicleName, vehicleNumber, imeiNumber, deviceCode } = req.body;

      if (!vehicleName || !vehicleName.trim()) {
        return res.status(400).json({ error: 'Vehicle Name is required' });
      }
      if (!vehicleNumber || !vehicleNumber.trim()) {
        return res.status(400).json({ error: 'Vehicle Number is required' });
      }
      if (!imeiNumber || !imeiNumber.trim()) {
        return res.status(400).json({ error: 'IMEI Number is required' });
      }
      if (!deviceCode || !deviceCode.trim()) {
        return res.status(400).json({ error: '6-digit pairing code is required' });
      }

      const cleanImei = String(imeiNumber).trim();
      const cleanCode = String(deviceCode).trim();
      const cleanReg = String(vehicleNumber).trim().toUpperCase();
      const cleanName = String(vehicleName).trim();

      // Check device in hardware database
      const device = getDeviceByImei(cleanImei);
      if (!device) {
        return res.status(404).json({ 
          error: `IMEI ${cleanImei} is not registered in the system. Please ask Admin to register this IMEI.` 
        });
      }

      if (device.pairing_code !== cleanCode) {
        return res.status(400).json({ 
          error: '6-digit code mismatch! The code you entered does not match the Admin pairing code for this IMEI.' 
        });
      }

      if (device.status === 'LINKED') {
        return res.status(400).json({ 
          error: `This device is already linked to vehicle ${device.vehicle_number || ''}.` 
        });
      }

      // 1. Create or link vehicle in main fleet db
      let vehicleId = null;
      try {
        const existingVeh = mainFleetDb.prepare('SELECT id FROM vehicles WHERE registration_no = ?').get(cleanReg);
        if (existingVeh) {
          // Update vehicle assignment and device ID
          mainFleetDb.prepare(`
            UPDATE vehicles SET
              name_model = ?,
              device_id = ?,
              imei_number = ?,
              assigned_user_id = ?,
              current_lat = COALESCE(current_lat, ?),
              current_lng = COALESCE(current_lng, ?),
              status = 'stop',
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(cleanName, cleanImei, cleanImei, req.user.id, device.last_latitude, device.last_longitude, existingVeh.id);
          vehicleId = existingVeh.id;
        } else {
          // Insert brand new vehicle in fleet db for this user
          const insertStmt = mainFleetDb.prepare(`
            INSERT INTO vehicles (
              registration_no, name_model, vehicle_type, device_id, imei_number,
              assigned_user_id, status, current_speed, current_lat, current_lng, axle_type
            ) VALUES (?, ?, 'Commercial GPS Fleet', ?, ?, ?, 'stop', 0, ?, ?, '2-Axle / 3-Axle')
          `);
          const info = insertStmt.run(
            cleanReg,
            cleanName,
            cleanImei,
            cleanImei,
            req.user.id,
            device.last_latitude || 21.2514,
            device.last_longitude || 81.6296
          );
          vehicleId = info.lastInsertRowid;
        }
      } catch (dbErr) {
        console.error('[Vehicle Fleet Insert Warning]:', dbErr.message);
      }

      // 2. Mark device as LINKED in hardware database
      const linkedDevice = verifyAndLinkDevice({
        imei: cleanImei,
        code: cleanCode,
        vehicleName: cleanName,
        vehicleNumber: cleanReg,
        userId: req.user.id,
        userEmail: req.user.email,
        userName: req.user.name,
        vehicleId
      });

      res.json({
        success: true,
        message: `Device ${cleanImei} successfully linked to vehicle ${cleanReg}! Live tracking is now active.`,
        vehicleId,
        device: linkedDevice
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  /**
   * 6. GET /api/hardware-gps/device/:imei/live
   * Get real-time coordinates and recent telemetry trail for an IMEI
   */
  router.get('/device/:imei/live', authenticateToken, (req, res) => {
    try {
      const { imei } = req.params;
      const device = getDeviceByImei(imei);
      if (!device) {
        return res.status(404).json({ error: 'Device not found' });
      }

      const trail = getDeviceTelemetryHistory(imei, 30);
      res.json({
        device,
        trail
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * 7. POST /api/hardware-gps/simulate-telemetry
   * Simulate live moving GPS telemetry from Web / API (testing tool)
   */
  router.post('/simulate-telemetry', authenticateToken, (req, res) => {
    try {
      const { imei, latitude, longitude, speed = 45, heading = 90, ignition = 1 } = req.body;
      if (!imei) return res.status(400).json({ error: 'IMEI is required' });

      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);
      if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({ error: 'Valid latitude and longitude required' });
      }

      const updated = updateDeviceTelemetry({
        imei,
        latitude: lat,
        longitude: lng,
        speed: Number(speed) || 0,
        heading: Number(heading) || 0,
        ignition: ignition ? 1 : 0,
        rawData: 'SIMULATED_TEST_PACKET'
      });

      // Also sync to main fleet db vehicle if linked
      if (updated && updated.assigned_vehicle_id) {
        try {
          mainFleetDb.prepare(`
            UPDATE vehicles SET
              current_lat = ?,
              current_lng = ?,
              current_speed = ?,
              status = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(lat, lng, Number(speed) || 0, Number(speed) > 3 ? 'moving' : 'stop', updated.assigned_vehicle_id);
        } catch (e) {}
      }

      res.json({
        success: true,
        message: 'Telemetry updated successfully',
        device: updated
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  /**
   * 8. GET /api/hardware-gps/server-info
   * Get server IP, TCP port, and SMS configuration guide for physical trackers
   */
  router.get('/server-info', authenticateToken, (req, res) => {
    try {
      const info = getHostNetworkIps();
      res.json({
        ...info,
        protocols: [
          {
            model: 'Concox GT06N / WeTrack2 / ET200',
            protocol: 'GT06 Binary Protocol',
            port: 5023,
            smsExample: `SERVER,1,${info.preferredLocalIp},5023,0#`
          },
          {
            model: 'V5 / PT06 GPS Tracker',
            protocol: 'GT06 / TK Protocol',
            port: 5023,
            smsExample: `SERVER,1,${info.preferredLocalIp},5023,0#`
          },
          {
            model: 'G206 / G19 Mini GPS',
            protocol: 'GT06 Protocol',
            port: 5023,
            smsExample: `IP#${info.preferredLocalIp}#5023#`
          },
          {
            model: 'Coban TK103 / TK102',
            protocol: 'TK103 Protocol',
            port: 5002,
            smsExample: `adminip123456 ${info.preferredLocalIp} 5002`
          }
        ]
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createHardwareGpsRouter };
