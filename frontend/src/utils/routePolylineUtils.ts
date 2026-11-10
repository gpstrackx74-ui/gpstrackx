/**
 * routePolylineUtils.ts
 * High-precision telematic route polyline utilities:
 * 1. Road curve snapping & telematic breadcrumb smoothing (prevents straight lines across fields)
 * 2. Natural road-conforming micro-curvature ("हल्का वैब्रेट, दरदरा, ओरिजिनल मैप जैसा")
 * 3. Interactive polyline segment & point deletion / trimming
 * 4. Haversine distance and duration calculations
 */

export interface TrimResult {
  coordinates: [number, number][];
  distanceKm: number;
  timeMinutes: number;
}

/**
 * Calculates accurate cumulative road distance in kilometers using the Haversine formula
 */
export function calculateCumulativeDistanceKm(coords: [number, number][]): number {
  if (!coords || coords.length < 2) return 0;
  let totalKm = 0;
  const R = 6371; // Earth radius in km

  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const dLat = (p2[0] - p1[0]) * Math.PI / 180;
    const dLon = (p2[1] - p1[1]) * Math.PI / 180;
    const lat1 = p1[0] * Math.PI / 180;
    const lat2 = p2[0] * Math.PI / 180;

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    totalKm += R * c;
  }

  return parseFloat(totalKm.toFixed(1));
}

/**
 * Calculates estimated travel duration in minutes given distance in km and average speed
 */
export function calculateDurationMinutes(distanceKm: number, avgSpeedKmh = 42): number {
  if (distanceKm <= 0) return 0;
  const mins = Math.round((distanceKm / Math.max(15, avgSpeedKmh)) * 60);
  return Math.max(1, mins);
}

/**
 * Delete a single point from the coordinates array and recalculate distance & time
 */
export function deleteSinglePoint(
  coords: [number, number][],
  index: number,
  avgSpeedKmh = 42
): TrimResult {
  if (!coords || coords.length <= 2 || index < 0 || index >= coords.length) {
    const d = calculateCumulativeDistanceKm(coords);
    return { coordinates: coords, distanceKm: d, timeMinutes: calculateDurationMinutes(d, avgSpeedKmh) };
  }

  const nextCoords = coords.filter((_, i) => i !== index);
  const distanceKm = calculateCumulativeDistanceKm(nextCoords);
  const timeMinutes = calculateDurationMinutes(distanceKm, avgSpeedKmh);

  return { coordinates: nextCoords, distanceKm, timeMinutes };
}

/**
 * Delete a range of points (from startIndex to endIndex) to remove wrong polyline branches, detours or loops
 * Slices out intermediate points and connects start to end cleanly.
 */
export function deletePointRange(
  coords: [number, number][],
  idxA: number,
  idxB: number,
  avgSpeedKmh = 42
): TrimResult {
  if (!coords || coords.length <= 2) {
    const d = calculateCumulativeDistanceKm(coords);
    return { coordinates: coords, distanceKm: d, timeMinutes: calculateDurationMinutes(d, avgSpeedKmh) };
  }

  const start = Math.min(idxA, idxB);
  const end = Math.max(idxA, idxB);

  // If deleting from 0 to end or keeping fewer than 2 points, prevent complete wipeout
  if (end - start + 1 >= coords.length) {
    const kept: [number, number][] = [coords[0], coords[coords.length - 1]];
    const distanceKm = calculateCumulativeDistanceKm(kept);
    return { coordinates: kept, distanceKm, timeMinutes: calculateDurationMinutes(distanceKm, avgSpeedKmh) };
  }

  const nextCoords: [number, number][] = [];
  for (let i = 0; i < coords.length; i++) {
    // If trimming middle segment, skip indices between start and end
    if (i >= start && i <= end) {
      continue;
    }
    nextCoords.push(coords[i]);
  }

  // Ensure at least 2 points remain
  if (nextCoords.length < 2) {
    nextCoords.push(coords[coords.length - 1]);
  }

  const distanceKm = calculateCumulativeDistanceKm(nextCoords);
  const timeMinutes = calculateDurationMinutes(distanceKm, avgSpeedKmh);

  return { coordinates: nextCoords, distanceKm, timeMinutes };
}

/**
 * Natural telematic micro-texture generator ("हल्का वैब्रेट, दरदरा, ओरिजिनल मैप जैसा, सीधा लाइन नहीं")
 * Adds subtle real-world GPS receiver telematic texture between sparse segments
 */
export function addNaturalTelematicsTexture(
  p1: [number, number],
  p2: [number, number],
  steps = 5
): [number, number][] {
  const pts: [number, number][] = [];
  const dLat = p2[0] - p1[0];
  const dLon = p2[1] - p1[1];
  const dist = Math.hypot(dLat, dLon);

  // If points are very close (< ~50m), no interpolation needed
  if (dist < 0.0005) {
    return [p1, p2];
  }

  // Generate intermediate natural curve points with micro-jitter
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    // Base linear position
    let lat = p1[0] + dLat * t;
    let lon = p1[1] + dLon * t;

    // Add subtle organic curve along normal vector (curvature) + micro-jitter in the middle
    if (s > 0 && s < steps) {
      const curveMag = Math.sin(t * Math.PI) * (dist * 0.04);
      // Normal vector (-dLon, dLat)
      const nLat = -dLon / (dist || 1);
      const nLon = dLat / (dist || 1);

      // Micro telematic jitter (reproducing genuine GPS telematics receiver noise ±0.00004 deg ~ 4 meters)
      const seed = Math.sin(lat * 129898 + lon * 78233) * 43758.5453;
      const jitter = (seed - Math.floor(seed) - 0.5) * 0.00007;

      lat += nLat * curveMag + jitter;
      lon += nLon * curveMag + jitter;
    }

    pts.push([parseFloat(lat.toFixed(6)), parseFloat(lon.toFixed(6))]);
  }

  return pts;
}

/**
 * Snaps sparse waypoints to real road geometry using OSRM where gaps exist (> 300m),
 * or applies organic road curvature interpolation so lines never cut straight across fields.
 */
export async function enhanceRouteWithRoadGeometry(
  inputPoints: [number, number][]
): Promise<[number, number][]> {
  if (!inputPoints || inputPoints.length < 2) return inputPoints;

  // If input points are already dense telematic breadcrumbs (> 300 points),
  // retain 100% of authentic breadcrumbs with zero distortion!
  if (inputPoints.length >= 250) {
    return inputPoints;
  }

  // Check if any consecutive gaps are large (> ~350m)
  let hasLargeGap = false;
  for (let i = 0; i < inputPoints.length - 1; i++) {
    const p1 = inputPoints[i];
    const p2 = inputPoints[i + 1];
    const distKm = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * 111;
    if (distKm > 0.35) {
      hasLargeGap = true;
      break;
    }
  }

  if (!hasLargeGap) {
    return inputPoints;
  }

  // Attempt road snapping via OSRM if waypoint count is manageable (<= 25 waypoints)
  try {
    const waypointsSample = inputPoints.length <= 25 
      ? inputPoints 
      : sampleWaypoints(inputPoints, 22);

    const coordStr = waypointsSample.map(p => `${p[1]},${p[0]}`).join(';');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`,
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data?.routes?.[0]?.geometry?.coordinates?.length > 10) {
        const roadCoords: [number, number][] = data.routes[0].geometry.coordinates.map(
          (c: [number, number]) => [parseFloat(c[1].toFixed(6)), parseFloat(c[0].toFixed(6))]
        );
        return roadCoords;
      }
    }
  } catch (e) {
    // Network or timeout: fallback to client-side natural curve smoothing
  }

  // Fallback: smooth client-side natural road curvature interpolation for large gaps
  const refined: [number, number][] = [];
  for (let i = 0; i < inputPoints.length - 1; i++) {
    const p1 = inputPoints[i];
    const p2 = inputPoints[i + 1];
    const distKm = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * 111;

    if (distKm > 0.35 && distKm < 25) {
      const steps = Math.min(12, Math.max(4, Math.round(distKm * 3)));
      const curve = addNaturalTelematicsTexture(p1, p2, steps);
      // Add all except the last point (which will be added as p1 of next pair)
      for (let j = 0; j < curve.length - 1; j++) {
        refined.push(curve[j]);
      }
    } else {
      refined.push(p1);
    }
  }
  refined.push(inputPoints[inputPoints.length - 1]);

  return refined;
}

function sampleWaypoints(pts: [number, number][], maxPoints: number): [number, number][] {
  if (pts.length <= maxPoints) return pts;
  const result: [number, number][] = [pts[0]];
  const step = (pts.length - 1) / (maxPoints - 1);
  for (let i = 1; i < maxPoints - 1; i++) {
    const idx = Math.round(i * step);
    result.push(pts[idx]);
  }
  result.push(pts[pts.length - 1]);
  return result;
}
