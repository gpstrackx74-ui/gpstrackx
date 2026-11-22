const net = require('net');
const os = require('os');
const { updateDeviceTelemetry, getDeviceByImei } = require('./hardwareGpsDb');

const GPS_TCP_PORT = process.env.GPS_TCP_PORT || 5023;

// Map of active socket connections: imei -> socket
const activeGpsSockets = new Map();

/**
 * Standard CRC-ITU 16 calculation for GT06 / Concox protocol
 */
function crc16(buffer, offset, length) {
  let crc = 0xFFFF;
  for (let i = 0; i < length; i++) {
    crc ^= (buffer[offset + i] << 8);
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return (~crc) & 0xFFFF;
}

/**
 * Convert 8-byte BCD buffer to 15 or 16 digit IMEI string
 */
function parseBcdImei(buffer, offset) {
  let imei = '';
  for (let i = 0; i < 8; i++) {
    const byte = buffer[offset + i];
    const high = (byte >> 4) & 0x0F;
    const low = byte & 0x0F;
    imei += high.toString(16) + low.toString(16);
  }
  // Trim leading zero if 16 digits to get standard 15-digit IMEI
  if (imei.startsWith('0') && imei.length === 16) {
    imei = imei.substring(1);
  }
  return imei;
}

/**
 * Create standard GT06 response packet
 */
function buildGt06Response(protocolNumber, serialNo) {
  const buf = Buffer.alloc(10);
  buf[0] = 0x78;
  buf[1] = 0x78;
  buf[2] = 0x05; // Length
  buf[3] = protocolNumber; // Protocol Number
  buf[4] = (serialNo >> 8) & 0xFF; // Serial No High
  buf[5] = serialNo & 0xFF;        // Serial No Low
  const crc = crc16(buf, 2, 4);
  buf[6] = (crc >> 8) & 0xFF;
  buf[7] = crc & 0xFF;
  buf[8] = 0x0D; // Stop Bit
  buf[9] = 0x0A; // Stop Bit
  return buf;
}

/**
 * Parse GT06 Location Packet (0x12 or 0x22)
 */
function parseLocationPacket(buf, offset, imei, mainFleetDb) {
  try {
    // Structure:
    // [0-1] 0x78 0x78
    // [2] Length
    // [3] Protocol (0x12 or 0x22)
    // [4-9] Date Time (Year, Month, Day, Hour, Min, Sec)
    // [10] Satellites count
    // [11-14] Latitude (4 bytes)
    // [15-18] Longitude (4 bytes)
    // [19] Speed (km/h)
    // [20-21] Course / Heading & Status
    // [22-23] Serial number

    const rawLat = buf.readUInt32BE(11);
    const rawLng = buf.readUInt32BE(15);

    let lat = rawLat / 1800000.0;
    let lng = rawLng / 1800000.0;

    const speed = buf[19] || 0;
    const courseStatus = buf.readUInt16BE(20);
    const heading = courseStatus & 0x03FF; // 0-360 degrees
    const isWest = (courseStatus & 0x0800) !== 0;
    const isSouth = (courseStatus & 0x0400) === 0;

    if (isSouth) lat = -lat;
    if (isWest) lng = -lng;

    // Validate coordinates are within sensible Earth range
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && (lat !== 0 || lng !== 0)) {
      // Update hardware telemetry database
      updateDeviceTelemetry({
        imei,
        latitude: Number(lat.toFixed(6)),
        longitude: Number(lng.toFixed(6)),
        speed,
        heading,
        altitude: 0,
        ignition: speed > 0 ? 1 : 0,
        rawData: buf.toString('hex')
      });

      // If device is linked to a vehicle in main fleet db, sync live position
      if (mainFleetDb) {
        try {
          const device = getDeviceByImei(imei);
          if (device && device.assigned_vehicle_id) {
            mainFleetDb.prepare(`
              UPDATE vehicles SET
                current_lat = ?,
                current_lng = ?,
                current_speed = ?,
                status = ?,
                updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `).run(
              Number(lat.toFixed(6)),
              Number(lng.toFixed(6)),
              speed,
              speed > 3 ? 'moving' : 'stop',
              device.assigned_vehicle_id
            );
          }
        } catch (e) {
          console.error('[Fleet Sync Error]:', e.message);
        }
      }
    }
  } catch (err) {
    console.error(`[GT06 Location Parse Error for IMEI ${imei}]:`, err.message);
  }
}

/**
 * Start the Hardware GPS TCP Server
 */
function startGpsHardwareServer(mainFleetDb) {
  const server = net.createServer((socket) => {
    let clientImei = null;
    const clientAddress = `${socket.remoteAddress}:${socket.remotePort}`;

    socket.on('data', (data) => {
      try {
        if (data.length < 5) return;

        // Check for GT06 Header (0x78 0x78)
        if (data[0] === 0x78 && data[1] === 0x78) {
          const packetLen = data[2];
          const protocolNumber = data[3];

          // 1. LOGIN PACKET (0x01)
          if (protocolNumber === 0x01 && data.length >= 16) {
            clientImei = parseBcdImei(data, 4);
            const serialNo = data.readUInt16BE(12);

            activeGpsSockets.set(clientImei, socket);
            console.log(`[GPS Hardware TCP] Login accepted: IMEI ${clientImei} from ${clientAddress}`);

            // Respond with GT06 Login ACK
            const ack = buildGt06Response(0x01, serialNo);
            socket.write(ack);
          }

          // 2. LOCATION PACKET (0x12 or 0x22)
          else if ((protocolNumber === 0x12 || protocolNumber === 0x22) && data.length >= 24) {
            if (clientImei) {
              const serialNo = data.readUInt16BE(data.length - 6);
              parseLocationPacket(data, 0, clientImei, mainFleetDb);

              // Some trackers require ACK for location
              const ack = buildGt06Response(protocolNumber, serialNo);
              socket.write(ack);
            }
          }

          // 3. HEARTBEAT PACKET (0x13)
          else if (protocolNumber === 0x13 && data.length >= 10) {
            const serialNo = data.readUInt16BE(data.length - 6);
            const ack = buildGt06Response(0x13, serialNo);
            socket.write(ack);
          }

          // 4. ALARM PACKET (0x16 or 0x26)
          else if ((protocolNumber === 0x16 || protocolNumber === 0x26) && data.length >= 10) {
            if (clientImei) {
              parseLocationPacket(data, 0, clientImei, mainFleetDb);
            }
            const serialNo = data.readUInt16BE(data.length - 6);
            const ack = buildGt06Response(protocolNumber, serialNo);
            socket.write(ack);
          }
        }
      } catch (err) {
        console.error(`[GPS Socket Data Processing Error]:`, err.message);
      }
    });

    socket.on('close', () => {
      if (clientImei) {
        activeGpsSockets.delete(clientImei);
        console.log(`[GPS Hardware TCP] Disconnected: IMEI ${clientImei}`);
      }
    });

    socket.on('error', (err) => {
      console.warn(`[GPS Socket ${clientAddress} Warning]:`, err.message);
    });
  });

  server.listen(GPS_TCP_PORT, '0.0.0.0', () => {
    console.log(`[GPS Hardware TCP Server] Listening for Concox/GT06/V5/PT06/G206 on 0.0.0.0:${GPS_TCP_PORT}`);
  });

  server.on('error', (err) => {
    console.error(`[GPS Hardware TCP Server Error]:`, err.message);
  });

  return server;
}

/**
 * Get host network IP addresses to assist admin setup
 */
function getHostNetworkIps() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({
          interface: name,
          ip: iface.address
        });
      }
    }
  }

  return {
    tcpPort: GPS_TCP_PORT,
    addresses,
    preferredLocalIp: addresses[0] ? addresses[0].ip : '127.0.0.1'
  };
}

module.exports = {
  startGpsHardwareServer,
  getHostNetworkIps,
  activeGpsSockets
};
