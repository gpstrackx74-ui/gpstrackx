import * as XLSX from 'xlsx';

export interface ExtractedExcelTelemetry {
  distanceKm: number;
  vehicleReg: string;
  startDate: string;
  endDate: string;
  avgSpeed: number;
  maxSpeed: number;
  runningTime: string;
  haltedTime: string;
  rawPoints: Array<{ lat: number; lng: number; name: string }>;
  detailsSheetName: string;
  isAccurateMeterFound: boolean;
  meterSource: 'summary_cell' | 'odometer_column' | 'distance_column' | 'start_end_odometer' | 'gps_geometry';
}

/**
 * Safely parse a numeric value from cell content or strings like "42.5 KM", "42,500 m", etc.
 */
function cleanNumber(val: any): number | null {
  if (val === undefined || val === null) return null;
  if (typeof val === 'number') return isFinite(val) ? val : null;
  const str = String(val).replace(/,/g, '').trim();
  const m = str.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (m) {
    let num = parseFloat(m[1]);
    const lower = str.toLowerCase();
    // Convert meters to km if unit is m or meters (and not km, pm, am)
    if ((lower.includes(' m') || lower.endsWith('m')) && !lower.includes('km') && !lower.includes('pm') && !lower.includes('am')) {
      num = num / 1000;
    }
    return isFinite(num) ? num : null;
  }
  return null;
}

function parseCoordString(val: any): string {
  if (!val) return '';
  return String(val).replace(/°/g, '').replace(/[^\d.,\-+ ]/g, '').trim();
}

function splitLatLong(str: string): { lat: number; lng: number } | null {
  if (!str) return null;
  const clean = String(str).replace(/°/g, '').trim();
  const parts = clean.split(/[,;\/]+/).map(p => parseFloat(p.replace(/[^\d.\-+]/g, '').trim()));
  if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return { lat: parts[0], lng: parts[1] };
  }
  return null;
}

function parseSingleCoord(val: any): number | null {
  if (val === undefined || val === null) return null;
  if (typeof val === 'number') return isFinite(val) ? val : null;
  const clean = String(val).replace(/°/g, '').replace(/[^\d.,\-+]/g, '').trim();
  const num = parseFloat(clean);
  return !isNaN(num) && isFinite(num) ? num : null;
}

/**
 * Universal, 100% Accurate Telematics & Route Distance Extractor from GPS Tracker Excel / CSV Files
 */
export function extractAccurateExcelTelemetry(workbook: XLSX.WorkBook): ExtractedExcelTelemetry {
  let distanceKm = 0;
  let vehicleReg = '';
  let startDate = '';
  let endDate = '';
  let avgSpeed = 0;
  let maxSpeed = 0;
  let runningTime = '';
  let haltedTime = '';
  let meterSource: ExtractedExcelTelemetry['meterSource'] = 'gps_geometry';

  // ---------------------------------------------------------------------------
  // STEP 1: Scan ALL sheets for Summary Telemetry & Distance / Odometer cells
  // ---------------------------------------------------------------------------
  let summaryStartOdo: number | null = null;
  let summaryEndOdo: number | null = null;

  for (const sName of workbook.SheetNames) {
    const ws = workbook.Sheets[sName];
    if (!ws) continue;
    const aoa: any[] = XLSX.utils.sheet_to_json(ws, { header: 1 });
    if (!Array.isArray(aoa) || aoa.length === 0) continue;

    // Scan up to first 120 rows of each sheet (summary blocks are typically at the top)
    const maxScanRows = Math.min(aoa.length, 120);
    for (let r = 0; r < maxScanRows; r++) {
      const row = aoa[r];
      if (!Array.isArray(row)) continue;
      const fullText = row.map(c => String(c || '').trim()).join(' ');

      // Match 'Trip History report for CG28P9730 from 15 Oct 2026,10:19 PM to 16 Oct 2026,12:18 AM'
      const reportMatch = fullText.match(/report for\s+([A-Za-z0-9\-]+)\s+from\s+(.+?)\s+to\s+(.+)/i);
      if (reportMatch) {
        if (!vehicleReg) vehicleReg = reportMatch[1].trim();
        if (!startDate) startDate = reportMatch[2].trim();
        if (!endDate) endDate = reportMatch[3].trim();
      }

      // Check for standalone Vehicle Reg: 'Vehicle: CG28P9730' or 'Reg No: CG28P9730'
      if (!vehicleReg) {
        const regMatch = fullText.match(/(?:vehicle(?:\s*no|\s*number|\s*reg|\s*registration)?|reg\s*no)\s*[:=]\s*([A-Za-z0-9\-]+)/i);
        if (regMatch) vehicleReg = regMatch[1].trim();
      }

      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (cell === undefined || cell === null) continue;
        const cellStr = String(cell).toLowerCase().trim();

        // A. Single cell containing both label and value: "Total Distance : 42.5 KM"
        const inlineDistMatch = cellStr.match(/(?:total\s+distance|distance\s*\(km\)|distance\s*\(m\)|trip\s+distance|distance\s+covered|total\s+km|run\s+km|odo\s+distance|distance)\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(km|kms|kilometers|m|mtrs)?/i);
        if (inlineDistMatch && !distanceKm) {
          let num = parseFloat(inlineDistMatch[1]);
          const unit = inlineDistMatch[2]?.toLowerCase();
          if (unit === 'm' || unit === 'mtrs') num = num / 1000;
          if (num > 0) {
            distanceKm = Math.round(num * 10) / 10;
            meterSource = 'summary_cell';
          }
        }

        // B. Cell contains Distance / KM label, value is in adjacent column or row below
        const isDistLabel = (
          cellStr.includes('total distance') ||
          cellStr.includes('distance(km)') ||
          cellStr.includes('distance (km)') ||
          cellStr.includes('distance(m)') ||
          cellStr.includes('distance (m)') ||
          cellStr.includes('trip distance') ||
          cellStr.includes('distance covered') ||
          cellStr.includes('distance traveled') ||
          cellStr.includes('total km') ||
          cellStr.includes('run km') ||
          cellStr.includes('odo distance') ||
          (cellStr.includes('distance') && !cellStr.includes('start') && !cellStr.includes('end') && cellStr.length < 25) ||
          cellStr === 'km' || cellStr === 'km.'
        );

        if (isDistLabel && !distanceKm) {
          // Look in subsequent cells in this row (c+1, c+2, c+3)
          for (let nextC = c + 1; nextC <= Math.min(row.length - 1, c + 3); nextC++) {
            const valNum = cleanNumber(row[nextC]);
            if (valNum !== null && valNum > 0) {
              distanceKm = Math.round(valNum * 10) / 10;
              meterSource = 'summary_cell';
              break;
            }
          }
          // If table layout (headers on row r, values on row r+1):
          if (!distanceKm && r + 1 < aoa.length && Array.isArray(aoa[r + 1])) {
            const valNum = cleanNumber(aoa[r + 1][c]);
            if (valNum !== null && valNum > 0) {
              distanceKm = Math.round(valNum * 10) / 10;
              meterSource = 'summary_cell';
            }
          }
        }

        // C. Check for Start Odometer and End Odometer in summary rows
        if ((cellStr.includes('start') && (cellStr.includes('odo') || cellStr.includes('meter'))) || cellStr === 'initial odo') {
          for (let nextC = c + 1; nextC <= Math.min(row.length - 1, c + 3); nextC++) {
            const valNum = cleanNumber(row[nextC]);
            if (valNum !== null && valNum > 0) { summaryStartOdo = valNum; break; }
          }
        }
        if ((cellStr.includes('end') && (cellStr.includes('odo') || cellStr.includes('meter'))) || cellStr === 'final odo') {
          for (let nextC = c + 1; nextC <= Math.min(row.length - 1, c + 3); nextC++) {
            const valNum = cleanNumber(row[nextC]);
            if (valNum !== null && valNum > 0) { summaryEndOdo = valNum; break; }
          }
        }

        // D. Average Speed
        if ((cellStr.includes('avg speed') || cellStr.includes('average speed')) && !avgSpeed) {
          for (let nextC = c + 1; nextC <= Math.min(row.length - 1, c + 3); nextC++) {
            const valNum = cleanNumber(row[nextC]);
            if (valNum !== null && valNum > 0) { avgSpeed = Math.round(valNum); break; }
          }
        }

        // E. Max Speed
        if ((cellStr.includes('max speed') || cellStr.includes('maximum speed')) && !maxSpeed) {
          for (let nextC = c + 1; nextC <= Math.min(row.length - 1, c + 3); nextC++) {
            const valNum = cleanNumber(row[nextC]);
            if (valNum !== null && valNum > 0) { maxSpeed = Math.round(valNum); break; }
          }
        }

        // F. Running Time
        if ((cellStr.includes('running time') || cellStr.includes('duration') || cellStr === 'running') && !runningTime) {
          for (let nextC = c + 1; nextC <= Math.min(row.length - 1, c + 3); nextC++) {
            if (row[nextC]) { runningTime = String(row[nextC]).trim(); break; }
          }
        }

        // G. Halted Time
        if ((cellStr.includes('halted time') || cellStr.includes('stoppage time') || cellStr === 'halted') && !haltedTime) {
          for (let nextC = c + 1; nextC <= Math.min(row.length - 1, c + 3); nextC++) {
            if (row[nextC]) { haltedTime = String(row[nextC]).trim(); break; }
          }
        }
      }
    }
  }

  // If summary had Start & End Odometer
  if (!distanceKm && summaryStartOdo !== null && summaryEndOdo !== null && summaryEndOdo >= summaryStartOdo) {
    let delta = summaryEndOdo - summaryStartOdo;
    if (delta > 10000) delta = delta / 1000; // in meters
    if (delta > 0) {
      distanceKm = Math.round(delta * 10) / 10;
      meterSource = 'start_end_odometer';
    }
  }

  // ---------------------------------------------------------------------------
  // STEP 2: Find Details Sheet with GPS Coordinates & Row-by-Row Data
  // ---------------------------------------------------------------------------
  let detailsSheetName = workbook.SheetNames.find(s =>
    s.toLowerCase().includes('trip') ||
    s.toLowerCase().includes('detail') ||
    s.toLowerCase().includes('history') ||
    s.toLowerCase().includes('points') ||
    s.toLowerCase().includes('track') ||
    s.toLowerCase().includes('gps') ||
    s.toLowerCase().includes('log') ||
    s.toLowerCase().includes('data')
  );

  if (!detailsSheetName) {
    detailsSheetName = workbook.SheetNames.find(s => !s.toLowerCase().includes('summary')) || workbook.SheetNames[0];
  }

  const wsDetails = workbook.Sheets[detailsSheetName];
  const rawRows: any[] = wsDetails ? XLSX.utils.sheet_to_json(wsDetails) : [];

  // ---------------------------------------------------------------------------
  // STEP 3: If Summary distance was not found, check Odometer & Distance Columns in Data Rows!
  // ---------------------------------------------------------------------------
  if (!distanceKm && rawRows.length > 0) {
    const sampleRow = rawRows[0] || {};
    let odoKey = '';
    let distKey = '';
    let startOdoKey = '';
    let endOdoKey = '';

    for (const k of Object.keys(sampleRow)) {
      const lk = k.toLowerCase().replace(/[_\-\s]+/g, ' ').trim();
      if (
        lk.includes('odometer') || lk.includes('odo meter') || lk.includes('gps odometer') ||
        lk === 'odo' || lk.startsWith('odo ') || lk.startsWith('odo(') || lk === 'meter' ||
        lk === 'odometer reading'
      ) {
        odoKey = k;
      }
      if (
        lk.includes('distance') || lk.includes('trip distance') || lk.includes('segment dist') ||
        lk.includes('dist(km)') || lk.includes('dist (km)') || lk === 'dist' ||
        lk === 'run km' || lk === 'km covered' || lk === 'distance covered' ||
        (lk === 'km' && !lk.includes('speed'))
      ) {
        distKey = k;
      }
      if (lk.includes('start') && (lk.includes('odo') || lk.includes('meter'))) {
        startOdoKey = k;
      }
      if (lk.includes('end') && (lk.includes('odo') || lk.includes('meter'))) {
        endOdoKey = k;
      }
    }

    // A. Calculate from Start & End Odometer columns (if present in each row or across table)
    if (startOdoKey && endOdoKey) {
      const firstStart = cleanNumber(rawRows[0][startOdoKey]);
      const lastEnd = cleanNumber(rawRows[rawRows.length - 1][endOdoKey]);
      if (firstStart !== null && lastEnd !== null && lastEnd >= firstStart) {
        let delta = lastEnd - firstStart;
        if (startOdoKey.toLowerCase().includes('(m)') || delta > 10000) delta = delta / 1000;
        if (delta > 0) {
          distanceKm = Math.round(delta * 10) / 10;
          meterSource = 'start_end_odometer';
        }
      }
    }

    // B. Calculate from Odometer column (last odometer - first odometer)
    if (!distanceKm && odoKey) {
      const odoVals: number[] = [];
      for (const r of rawRows) {
        const v = cleanNumber(r[odoKey]);
        if (v !== null && v > 0) odoVals.push(v);
      }
      if (odoVals.length >= 2) {
        const first = odoVals[0];
        const last = odoVals[odoVals.length - 1];
        let delta = Math.abs(last - first);
        if (delta === 0) {
          delta = Math.max(...odoVals) - Math.min(...odoVals);
        }
        if (delta > 0) {
          const isMeters = odoKey.toLowerCase().includes('(m)') || delta > 10000;
          const km = isMeters ? delta / 1000 : delta;
          distanceKm = Math.round(km * 10) / 10;
          meterSource = 'odometer_column';
        }
      }
    }

    // C. Calculate from Distance column (sum of row distances)
    if (!distanceKm && distKey) {
      let sumDist = 0;
      for (const r of rawRows) {
        const v = cleanNumber(r[distKey]);
        if (v !== null && v > 0) sumDist += v;
      }
      if (sumDist > 0) {
        const isMeters = distKey.toLowerCase().includes('(m)') || (sumDist > 5000 && rawRows.length > 5);
        const km = isMeters ? sumDist / 1000 : sumDist;
        distanceKm = Math.round(km * 10) / 10;
        meterSource = 'distance_column';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // STEP 4: Parse GPS Coordinates from rawRows
  // ---------------------------------------------------------------------------
  const rawPoints: Array<{ lat: number; lng: number; name: string }> = [];

  const addPointIfValid = (lat: number | null, lng: number | null, name?: string) => {
    if (lat === null || lng === null || isNaN(lat) || isNaN(lng)) return;
    // Coordinate sanity bounds for India (lat 6-38, lng 68-98)
    if (lat < 6 || lat > 38 || lng < 68 || lng > 98) return;

    const roundedLat = parseFloat(lat.toFixed(6));
    const roundedLng = parseFloat(lng.toFixed(6));

    if (rawPoints.length > 0) {
      const last = rawPoints[rawPoints.length - 1];
      // Skip micro-duplicates within ~2 meters
      if (Math.abs(last.lat - roundedLat) < 0.00003 && Math.abs(last.lng - roundedLng) < 0.00003) {
        return;
      }
    }

    rawPoints.push({
      lat: roundedLat,
      lng: roundedLng,
      name: name || `Point #${rawPoints.length + 1}`
    });
  };

  rawRows.forEach((row, i) => {
    let startLat: number | null = null, startLng: number | null = null, startLoc = '';
    let endLat: number | null = null, endLng: number | null = null, endLoc = '';
    let singleLat: number | null = null, singleLng: number | null = null, singleLoc = '';

    for (const key of Object.keys(row)) {
      const k = key.toLowerCase().trim();
      const val = row[key];

      if (k.includes('start') && (k.includes('lat') || k.includes('coord') || k.includes('point'))) {
        const coords = splitLatLong(val);
        if (coords) {
          startLat = coords.lat;
          startLng = coords.lng;
        }
      } else if (k.includes('end') && (k.includes('lat') || k.includes('coord') || k.includes('point'))) {
        const coords = splitLatLong(val);
        if (coords) {
          endLat = coords.lat;
          endLng = coords.lng;
        }
      } else if (k.includes('start') && (k.includes('loc') || k.includes('address') || k.includes('name') || k.includes('city'))) {
        startLoc = String(val).trim();
      } else if (k.includes('end') && (k.includes('loc') || k.includes('address') || k.includes('name') || k.includes('city'))) {
        endLoc = String(val).trim();
      } else if (['start_latitude', 'start_lat', 'startlat', 'start latitude', 'from_lat', 'origin_lat'].includes(k)) {
        startLat = parseSingleCoord(val);
      } else if (['start_longitude', 'start_lng', 'startlng', 'start longitude', 'from_lng', 'origin_lng', 'start_lon'].includes(k)) {
        startLng = parseSingleCoord(val);
      } else if (['end_latitude', 'end_lat', 'endlat', 'end latitude', 'to_lat', 'dest_lat'].includes(k)) {
        endLat = parseSingleCoord(val);
      } else if (['end_longitude', 'end_lng', 'endlng', 'end longitude', 'to_lng', 'dest_lng', 'end_lon'].includes(k)) {
        endLng = parseSingleCoord(val);
      } else if (['latitude', 'lat', 'y', 'lat.'].includes(k)) {
        singleLat = parseSingleCoord(val);
      } else if (['longitude', 'lng', 'lon', 'long', 'x', 'long.'].includes(k)) {
        singleLng = parseSingleCoord(val);
      } else if (['location', 'location name', 'address', 'name', 'city'].includes(k)) {
        singleLoc = String(val).trim();
      }
    }

    if (startLat !== null && startLng !== null) {
      addPointIfValid(startLat, startLng, startLoc || `Point #${rawPoints.length + 1}`);
      if (endLat !== null && endLng !== null) {
        addPointIfValid(endLat, endLng, endLoc || (i === rawRows.length - 1 ? 'Destination' : `Point #${rawPoints.length + 1}`));
      }
    } else if (singleLat !== null && singleLng !== null) {
      addPointIfValid(singleLat, singleLng, singleLoc || `Point #${rawPoints.length + 1}`);
    }
  });

  // Filter isolated GPS drift spikes
  const validPoints: typeof rawPoints = [];
  for (let i = 0; i < rawPoints.length; i++) {
    const curr = rawPoints[i];
    if (i > 0 && i < rawPoints.length - 1) {
      const prev = rawPoints[i - 1];
      const next = rawPoints[i + 1];
      const distToPrev = Math.hypot(curr.lat - prev.lat, curr.lng - prev.lng);
      const distToNext = Math.hypot(curr.lat - next.lat, curr.lng - next.lng);
      const distDirect = Math.hypot(next.lat - prev.lat, next.lng - prev.lng);
      if (distToPrev > 0.15 && distToNext > 0.15 && distDirect < 0.05) {
        continue;
      }
    }
    validPoints.push(curr);
  }

  // ---------------------------------------------------------------------------
  // STEP 5: Fallback to cumulative GPS geometry distance ONLY if no distance/odometer in Excel
  // ---------------------------------------------------------------------------
  const isAccurateMeterFound = distanceKm > 0;
  if (!isAccurateMeterFound && validPoints.length >= 2) {
    let computedDist = 0;
    for (let i = 0; i < validPoints.length - 1; i++) {
      const p1 = validPoints[i];
      const p2 = validPoints[i + 1];
      const R = 6371;
      const dLat = (p2.lat - p1.lat) * Math.PI / 180;
      const dLon = (p2.lng - p1.lng) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const cc = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      computedDist += R * cc;
    }
    distanceKm = parseFloat(computedDist.toFixed(1));
    meterSource = 'gps_geometry';
  }

  return {
    distanceKm,
    vehicleReg,
    startDate,
    endDate,
    avgSpeed,
    maxSpeed,
    runningTime,
    haltedTime,
    rawPoints: validPoints,
    detailsSheetName,
    isAccurateMeterFound,
    meterSource
  };
}
