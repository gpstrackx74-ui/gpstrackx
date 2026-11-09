import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { Vehicle, RouteDetail, Stoppage, TollGate } from '../types';
import { InteractiveMap } from '../components/InteractiveMap';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { DMYDateInput, formatToDMY, normalizeToYMD } from '../components/DMYDateInput';
import {
  Navigation,
  Plus,
  ArrowLeft,
  Truck,
  MapPin,
  Flag,
  Calendar,
  Clock,
  Gauge,
  Phone,
  Mail,
  Hash,
  Radio,
  ShieldCheck,
  FileText,
  Download,
  AlertCircle,
  RefreshCw,
  Play,
  Pause,
  RotateCcw,
  FastForward
} from 'lucide-react';

interface VehicleTrackingProps {
  vehicleId: number;
  onBack: () => void;
  onPlanRoute?: (vehicleId: number) => void;
  onSwitchVehicle?: (vehicleId: number) => void;
}

export const VehicleTracking: React.FC<VehicleTrackingProps> = ({ vehicleId, onBack, onPlanRoute, onSwitchVehicle }) => {
  const { isAdmin } = useAuth();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [vehicleList, setVehicleList] = useState<Vehicle[]>([]);
  const [activeRoute, setActiveRoute] = useState<RouteDetail | null>(null);
  const [stoppages, setStoppages] = useState<Stoppage[]>([]);
  const [manualTolls, setManualTolls] = useState<TollGate[]>([]);
  const [loading, setLoading] = useState(true);
  const [allTrips, setAllTrips] = useState<any[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');

  // Filter Period
  const [period, setPeriod] = useState<'today' | '7days' | '30days'>('today');
  const [fromDate, setFromDate] = useState('2026-10-31');
  const [fromTime, setFromTime] = useState('12:00 AM');
  const [toDate, setToDate] = useState('2026-10-31');
  const [toTime, setToTime] = useState('11:59 PM');

  // Vehicle Route Playback Simulation State (Unconditional top-level hooks)
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackIndex, setPlaybackIndex] = useState<number>(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);

  // Load available vehicles for instant in-map vehicle switching
  useEffect(() => {
    api.getVehicles()
      .then(vehs => setVehicleList(vehs || []))
      .catch(() => { });
  }, []);

  const fetchVehicleDetails = async (targetId: number, isInitial = false) => {
    try {
      if (isInitial) setLoading(true);
      const [data, trips] = await Promise.all([
        api.getVehicle(targetId),
        api.getVehicleTrips(targetId).catch(() => [])
      ]);
      setVehicle(data.vehicle);
      const tripsList = trips || [];
      setAllTrips(tripsList);

      // If initial load or user hasn't explicitly chosen a date yet, use active route or today
      if (isInitial || !selectedDate) {
        if (data.activeRoute) {
          setActiveRoute(data.activeRoute);
          const rDate = normalizeToYMD(data.activeRoute.trip_date || (data.activeRoute.created_at ? data.activeRoute.created_at.split('T')[0] : ''));
          if (rDate) {
            setSelectedDate(rDate);
            setFromDate(rDate);
            setToDate(rDate);
          }
        }
        setStoppages(data.stoppages || []);
        setManualTolls(data.manualTolls || []);
      } else {
        // User has explicitly chosen a date, find trip matching selectedDate
        const targetYMD = normalizeToYMD(selectedDate);
        const matchingTrip = tripsList.find((t: any) => {
          const d1 = normalizeToYMD(t.trip_date || (t.created_at ? t.created_at.split('T')[0] : ''));
          const d2 = normalizeToYMD(t.end_trip_date || t.trip_date || d1);
          return d1 === targetYMD || (d1 <= targetYMD && d2 >= targetYMD);
        });

        if (matchingTrip) {
          setActiveRoute(matchingTrip);
          try {
            if (matchingTrip.waypoints_json) {
              const wp = typeof matchingTrip.waypoints_json === 'string' ? JSON.parse(matchingTrip.waypoints_json) : matchingTrip.waypoints_json;
              if (Array.isArray(wp)) setStoppages(wp);
            }
          } catch (_) {}
          try {
            if (matchingTrip.toll_gates_json) {
              const tg = typeof matchingTrip.toll_gates_json === 'string' ? JSON.parse(matchingTrip.toll_gates_json) : matchingTrip.toll_gates_json;
              if (Array.isArray(tg)) setManualTolls(tg);
            }
          } catch (_) {}
        } else {
          setActiveRoute(null);
          setStoppages([]);
          setManualTolls([]);
        }
      }
    } catch (err) {
      console.error('Failed to load vehicle telemetry:', err);
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  const handleDateChange = (newDate: string, tripsList = allTrips) => {
    const ymd = normalizeToYMD(newDate);
    setSelectedDate(ymd);
    setFromDate(ymd);
    setToDate(ymd);

    if (!ymd) return;

    // Check if any trip exists on this date
    const found = tripsList.find((t: any) => {
      const d1 = normalizeToYMD(t.trip_date || (t.created_at ? t.created_at.split('T')[0] : ''));
      const d2 = normalizeToYMD(t.end_trip_date || t.trip_date || d1);
      return d1 === ymd || (d1 <= ymd && d2 >= ymd);
    });

    if (found) {
      setActiveRoute(found);
      try {
        if (found.waypoints_json) {
          const wp = typeof found.waypoints_json === 'string' ? JSON.parse(found.waypoints_json) : found.waypoints_json;
          if (Array.isArray(wp)) setStoppages(wp);
        }
      } catch (_) {}
      try {
        if (found.toll_gates_json) {
          const tg = typeof found.toll_gates_json === 'string' ? JSON.parse(found.toll_gates_json) : found.toll_gates_json;
          if (Array.isArray(tg)) setManualTolls(tg);
        }
      } catch (_) {}
    } else {
      // Clear route, stoppages and tolls so map is completely empty/blank and details reset to zero
      setActiveRoute(null);
      setStoppages([]);
      setManualTolls([]);
    }
  };

  useEffect(() => {
    if (!vehicleId) return;
    fetchVehicleDetails(vehicleId, true);
    const interval = setInterval(() => {
      // Background network fetch preserves user selected date
      if (!isPlaying) {
        fetchVehicleDetails(vehicleId, false);
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [vehicleId, isPlaying, selectedDate]);

  // Parse route coordinates safely with useMemo
  const parsedCoordinates = React.useMemo<[number, number][]>(() => {
    if (!activeRoute) return [];
    let coords: [number, number][] = [];
    if (activeRoute.overview_polyline) {
      try {
        const parsed = typeof activeRoute.overview_polyline === 'string'
          ? JSON.parse(activeRoute.overview_polyline)
          : activeRoute.overview_polyline;
        if (Array.isArray(parsed)) {
          coords = parsed
            .map((p: any): [number, number] => Array.isArray(p) ? [Number(p[0]), Number(p[1])] : [Number(p.lat), Number(p.lng)])
            .filter((c: [number, number]): boolean => !isNaN(c[0]) && !isNaN(c[1]));
        }
      } catch (e) {
        coords = [];
      }
    }
    // Fallback if coordinates array is empty but route has start and end points
    if (coords.length < 2 && activeRoute.start_lat && activeRoute.end_lat) {
      coords = [
        [Number(activeRoute.start_lat), Number(activeRoute.start_lng)],
        [Number(activeRoute.end_lat), Number(activeRoute.end_lng)]
      ];
    }
    return coords;
  }, [activeRoute?.id, activeRoute?.overview_polyline, activeRoute?.start_lat, activeRoute?.start_lng, activeRoute?.end_lat, activeRoute?.end_lng]);

  // Smooth sub-step interpolated path for buttery-smooth vehicle motion without vibration/jitter
  const smoothPlaybackCoordinates = React.useMemo<[number, number][]>(() => {
    if (parsedCoordinates.length <= 1) return parsedCoordinates;

    // If already dense, use directly
    if (parsedCoordinates.length >= 300) return parsedCoordinates;

    // Sub-steps between waypoints
    const subSteps = parsedCoordinates.length > 100 ? 3 : parsedCoordinates.length > 30 ? 6 : 10;
    const interpolated: [number, number][] = [];

    for (let i = 0; i < parsedCoordinates.length - 1; i++) {
      const p1 = parsedCoordinates[i];
      const p2 = parsedCoordinates[i + 1];
      for (let s = 0; s < subSteps; s++) {
        const ratio = s / subSteps;
        const lat = p1[0] + (p2[0] - p1[0]) * ratio;
        const lng = p1[1] + (p2[1] - p1[1]) * ratio;
        interpolated.push([Number(lat.toFixed(6)), Number(lng.toFixed(6))]);
      }
    }
    interpolated.push(parsedCoordinates[parsedCoordinates.length - 1]);
    return interpolated;
  }, [parsedCoordinates]);

  // Parse tolls safely with useMemo
  const routeTolls = React.useMemo<TollGate[]>(() => {
    if (activeRoute?.toll_gates_json) {
      try {
        const parsed = typeof activeRoute.toll_gates_json === 'string'
          ? JSON.parse(activeRoute.toll_gates_json)
          : activeRoute.toll_gates_json;
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch (e) { }
    }
    return manualTolls;
  }, [activeRoute?.toll_gates_json, manualTolls]);

  // Auto play/move when vehicle status is 'moving', park at END POINT when status is NOT 'moving'
  useEffect(() => {
    if (!vehicle) return;
    if (vehicle.status === 'moving') {
      setIsPlaying(true);
    } else {
      setIsPlaying(false);
      if (smoothPlaybackCoordinates.length > 0) {
        setPlaybackIndex(smoothPlaybackCoordinates.length - 1);
      }
    }
  }, [vehicle?.id, vehicle?.status, smoothPlaybackCoordinates.length]);

  // Playback timer ticker - smoothly and calmly moves vehicle along smoothPlaybackCoordinates
  useEffect(() => {
    if (!isPlaying || smoothPlaybackCoordinates.length <= 1) return;

    // Very slow, calm real-time movement (1200ms per step) when vehicle is in moving status
    const intervalMs = vehicle?.status === 'moving'
      ? Math.max(300, Math.round(1200 / playbackSpeed))
      : Math.max(100, Math.round(250 / playbackSpeed));

    const interval = setInterval(() => {
      setPlaybackIndex(prev => {
        const step = 1;
        const next = prev + step;
        if (next >= smoothPlaybackCoordinates.length - 1) {
          // If vehicle is actively set to moving, loop continuously along the route
          if (vehicle?.status === 'moving') {
            return 0;
          }
          setIsPlaying(false);
          return smoothPlaybackCoordinates.length - 1;
        }
        return next;
      });
    }, intervalMs);

    return () => clearInterval(interval);
  }, [isPlaying, playbackSpeed, smoothPlaybackCoordinates.length, vehicle?.status]);

  const handleResetPlayback = () => {
    setIsPlaying(false);
    setPlaybackIndex(0);
  };

  // Memoize routes and endpoints BEFORE any early return to strictly adhere to React Rules of Hooks
  const trackingRoutes = React.useMemo(() => {
    if (!activeRoute) return [];
    return [{
      id: `active-${activeRoute.id}`,
      name: (activeRoute.route_name || 'Commercial Highway Route').replace(/\r?\n/g, ' '),
      distanceKm: Number(activeRoute.total_distance_km || 0),
      timeMinutes: Number(activeRoute.estimated_travel_time_min || 0),
      tollGatesCount: routeTolls.length,
      stopsCount: stoppages.length,
      summary: 'Active Commercial Highway Route',
      color: activeRoute.route_color || '#EF4444',
      coordinates: parsedCoordinates,
      tollGates: routeTolls
    }];
  }, [
    activeRoute?.id,
    activeRoute?.route_name,
    activeRoute?.total_distance_km,
    activeRoute?.estimated_travel_time_min,
    activeRoute?.route_color,
    routeTolls,
    stoppages.length,
    parsedCoordinates
  ]);

  const memoizedStart = React.useMemo(() => {
    if (!activeRoute?.start_lat || !activeRoute?.start_lng) return null;
    return {
      lat: Number(activeRoute.start_lat),
      lng: Number(activeRoute.start_lng),
      name: (activeRoute.start_location_name || 'Start Point').replace(/\r?\n/g, ' ')
    };
  }, [activeRoute?.start_lat, activeRoute?.start_lng, activeRoute?.start_location_name]);

  const memoizedEnd = React.useMemo(() => {
    if (!activeRoute?.end_lat || !activeRoute?.end_lng) return null;
    return {
      lat: Number(activeRoute.end_lat),
      lng: Number(activeRoute.end_lng),
      name: (activeRoute.end_location_name || 'Destination').replace(/\r?\n/g, ' ')
    };
  }, [activeRoute?.end_lat, activeRoute?.end_lng, activeRoute?.end_location_name]);

  // Determine current simulated position with rock-solid coordinates
  const currentPlaybackPoint: [number, number] | null = React.useMemo(() => {
    // If no active route (vehicle did not run on this selected date), return null so map is completely blank
    if (!activeRoute) return null;
    if (smoothPlaybackCoordinates.length > 0) {
      // If vehicle status is NOT moving and not actively replaying, park truck at the END POINT of the route
      if (vehicle?.status !== 'moving' && !isPlaying) {
        return smoothPlaybackCoordinates[smoothPlaybackCoordinates.length - 1];
      }
      return smoothPlaybackCoordinates[Math.min(playbackIndex, smoothPlaybackCoordinates.length - 1)];
    }
    if (vehicle?.current_lat && vehicle?.current_lng) {
      return [Number(vehicle.current_lat), Number(vehicle.current_lng)];
    }
    return null;
  }, [activeRoute, smoothPlaybackCoordinates, playbackIndex, vehicle?.current_lat, vehicle?.current_lng, vehicle?.status, isPlaying]);

  const playbackProgressPercent = activeRoute && smoothPlaybackCoordinates.length > 1
    ? Math.min(100, Math.round((playbackIndex / (smoothPlaybackCoordinates.length - 1)) * 100))
    : (activeRoute && vehicle?.status !== 'moving' ? 100 : 0);

  const simulatedDistanceCoveredKm = activeRoute?.total_distance_km
    ? ((playbackProgressPercent / 100) * Number(activeRoute.total_distance_km)).toFixed(1)
    : '0';

  const simulatedSpeed = (activeRoute && (vehicle?.status === 'moving' || isPlaying))
    ? (vehicle?.current_speed && vehicle.current_speed > 0 ? vehicle.current_speed : 48)
    : 0;

  const simulatedVehiclePosition = React.useMemo(() => {
    if (!activeRoute || !currentPlaybackPoint || !vehicle) return null;
    return {
      lat: currentPlaybackPoint[0],
      lng: currentPlaybackPoint[1],
      speed: simulatedSpeed,
      status: (vehicle.status === 'moving' || isPlaying) ? 'moving' : 'stopped',
      plate: vehicle.registration_no
    };
  }, [activeRoute, currentPlaybackPoint, vehicle, simulatedSpeed, isPlaying]);

  // Stoppages with calculated arrival and departure times based on route duration
  const stoppagesWithTimings = React.useMemo(() => {
    if (!stoppages || stoppages.length === 0) return [];

    const parseTimeToMins = (tStr?: string, defaultMin = 8 * 60): number => {
      if (!tStr) return defaultMin;
      const clean = tStr.trim().toLowerCase();
      const isPM = clean.includes('pm');
      const isAM = clean.includes('am');
      const match = clean.replace(/[^0-9:]/g, '').split(':');
      if (match.length >= 2) {
        let h = parseInt(match[0], 10);
        const m = parseInt(match[1], 10) || 0;
        if (isPM && h < 12) h += 12;
        if (isAM && h === 12) h = 0;
        if (!isNaN(h)) return h * 60 + m;
      }
      return defaultMin;
    };

    const routeStartMins = parseTimeToMins(activeRoute?.start_trip_time, 8 * 60);
    const routeDurationMins = (() => {
      if (activeRoute?.estimated_travel_time_min && Number(activeRoute.estimated_travel_time_min) > 0) {
        return Number(activeRoute.estimated_travel_time_min);
      }
      if (activeRoute?.start_trip_time && activeRoute?.end_trip_time) {
        const sMin = parseTimeToMins(activeRoute.start_trip_time);
        const eMin = parseTimeToMins(activeRoute.end_trip_time);
        if (eMin > sMin) return eMin - sMin;
      }
      if (activeRoute?.total_distance_km && Number(activeRoute.total_distance_km) > 0) {
        return Math.max(60, Math.round((Number(activeRoute.total_distance_km) / 50) * 60));
      }
      return 180;
    })();

    const formatTime = (totalMinutes: number) => {
      const h = Math.floor(totalMinutes / 60) % 24;
      const m = Math.floor(totalMinutes % 60);
      const hr = (h % 12) || 12;
      const ampm = h >= 12 ? 'PM' : 'AM';
      return `${String(hr).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
    };

    const nStops = stoppages.length;
    return stoppages.map((s, idx) => {
      const fraction = (idx + 1) / (nStops + 1);
      const arrTotal = Math.round(routeStartMins + fraction * routeDurationMins);
      const durationMins = s.stop_duration_mins || s.duration || Math.min(25, Math.max(10, Math.round(routeDurationMins / (nStops * 4))));
      const depTotal = arrTotal + durationMins;

      return {
        ...s,
        duration: durationMins,
        stop_duration_mins: durationMins,
        arrival_time: formatTime(arrTotal),
        departure_time: formatTime(depTotal)
      };
    });
  }, [stoppages, activeRoute?.start_trip_time, activeRoute?.end_trip_time, activeRoute?.estimated_travel_time_min, activeRoute?.total_distance_km]);

  // Safe early returns AFTER all hooks are registered
  if (loading && !vehicle) {
    return (
      <div className="p-12 text-center text-slate-500 text-xs">
        <div className="w-6 h-6 border-2 border-red-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        <p>Loading vehicle telemetry and road routes...</p>
      </div>
    );
  }

  if (!vehicle) {
    return (
      <div className="p-8 text-center text-slate-500 max-w-md mx-auto my-12 bg-white rounded-3xl border border-slate-200 shadow-xs">
        <AlertCircle className="w-9 h-9 text-red-500 mx-auto mb-3" />
        <p className="font-extrabold text-slate-900 text-sm">Vehicle Map Not Found</p>
        <p className="text-xs text-slate-500 mt-1">
          This vehicle record may not be assigned to your account or has been updated.
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          {vehicleList.length > 0 && onSwitchVehicle && (
            <button
              onClick={() => onSwitchVehicle(vehicleList[0].id)}
              className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition cursor-pointer"
            >
              Open {vehicleList[0].registration_no}
            </button>
          )}
          <button
            onClick={onBack}
            className="px-3.5 py-1.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-bold text-xs transition cursor-pointer"
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  const isMoving = (vehicle?.status as string) === 'moving' || (activeRoute?.operational_status === 'moving');
  const isStopped = (vehicle?.status as string) === 'stop' || (vehicle?.status as string) === 'stopped' || (activeRoute?.operational_status === 'stop');
  const isParking = (vehicle?.status as string) === 'parking' || (activeRoute?.operational_status === 'parking');

  return (
    <div className="p-4 sm:p-6 lg:p-7 space-y-4 max-w-7xl mx-auto w-full min-w-0 font-sans">
      {/* ONE LARGE UNIFIED MAIN CONTAINER (ALL-IN-ONE ENTERPRISE LAYOUT) */}
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-xs overflow-hidden">
        {/* Section 1: Back Button, Vehicle Switcher & Action Bar */}
        <div className="p-5 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition shadow-xs cursor-pointer"
              title="Back to Vehicles List"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-xl font-black text-slate-900 tracking-tight font-mono">
                  {vehicle.registration_no}
                </h2>
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${isMoving
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : isStopped
                  ? 'bg-rose-50 text-rose-700 border border-rose-200'
                  : isParking
                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                  : vehicle.status === 'active'
                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                  : 'bg-slate-100 text-slate-600 border border-slate-200'
                  }`}>
                  {isMoving && <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 animate-pulse"></span>}
                  {vehicle.status?.toUpperCase()}
                </span>
                <span className="text-xs font-bold text-slate-500">
                  {vehicle.name_model}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {isAdmin && onPlanRoute && (
              <button
                type="button"
                onClick={() => onPlanRoute(vehicle.id)}
                className="px-4 py-2 bg-[#E60012] hover:bg-[#CC0010] text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer whitespace-nowrap"
              >
                Modify Route on Map
              </button>
            )}

            <button
              type="button"
              onClick={() => fetchVehicleDetails(vehicleId)}
              className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition cursor-pointer shadow-xs"
              title="Refresh Telemetry"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Thin divider with light red 10% opacity */}
        <div className="border-t border-[#E60012]/10" />

        {/* Section 2: Filter Period Bar */}
        <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-50/40">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5 font-bold text-slate-700">
              <Calendar className="w-4 h-4 text-[#0F172A]" />
              <span>Filter Period:</span>
            </div>

            <div className="flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-xl border border-slate-200 shadow-2xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase">From:</span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => handleDateChange(e.target.value)}
                className="bg-transparent font-mono text-slate-800 focus:outline-none text-xs"
              />
              <span className="text-slate-300 mx-0.5">|</span>
              <input
                type="text"
                value={fromTime}
                onChange={(e) => setFromTime(e.target.value)}
                className="w-16 bg-transparent font-mono text-slate-800 focus:outline-none text-xs"
              />
            </div>

            <div className="flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-xl border border-slate-200 shadow-2xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase">To:</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => handleDateChange(e.target.value)}
                className="bg-transparent font-mono text-slate-800 focus:outline-none text-xs"
              />
              <span className="text-slate-300 mx-0.5">|</span>
              <input
                type="text"
                value={toTime}
                onChange={(e) => setToTime(e.target.value)}
                className="w-16 bg-transparent font-mono text-slate-800 focus:outline-none text-xs"
              />
            </div>

            {/* Quick presets */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setPeriod('today');
                  const todayStr = new Date().toISOString().split('T')[0];
                  handleDateChange(todayStr);
                }}
                className={`px-3 py-1.5 rounded-xl font-bold text-xs transition cursor-pointer ${period === 'today' ? 'bg-white text-slate-900 border border-slate-300 shadow-2xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => {
                  setPeriod('7days');
                  const now = new Date();
                  const pastDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                  const todayStr = now.toISOString().split('T')[0];
                  const found = allTrips.find((t: any) => {
                    const d1 = normalizeToYMD(t.trip_date || (t.created_at ? t.created_at.split('T')[0] : ''));
                    return d1 >= pastDate && d1 <= todayStr;
                  });
                  if (found) {
                    handleDateChange(found.trip_date || pastDate);
                  } else {
                    setSelectedDate(todayStr);
                    setFromDate(todayStr);
                    setToDate(todayStr);
                    setActiveRoute(null);
                    setStoppages([]);
                    setManualTolls([]);
                  }
                }}
                className={`px-3 py-1.5 rounded-xl font-bold text-xs transition cursor-pointer ${period === '7days' ? 'bg-white text-slate-900 border border-slate-300 shadow-2xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
              >
                7 Days
              </button>
              <button
                type="button"
                onClick={() => {
                  setPeriod('30days');
                  const now = new Date();
                  const pastDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                  const todayStr = now.toISOString().split('T')[0];
                  const found = allTrips.find((t: any) => {
                    const d1 = normalizeToYMD(t.trip_date || (t.created_at ? t.created_at.split('T')[0] : ''));
                    return d1 >= pastDate && d1 <= todayStr;
                  });
                  if (found) {
                    handleDateChange(found.trip_date || pastDate);
                  } else {
                    setSelectedDate(todayStr);
                    setFromDate(todayStr);
                    setToDate(todayStr);
                    setActiveRoute(null);
                    setStoppages([]);
                    setManualTolls([]);
                  }
                }}
                className={`px-3 py-1.5 rounded-xl font-bold text-xs transition cursor-pointer ${period === '30days' ? 'bg-white text-slate-900 border border-slate-300 shadow-2xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
              >
                30 Days
              </button>
            </div>
          </div>

          {isAdmin && (
            <div className="flex items-center gap-2 self-end lg:self-auto text-xs">
              <button
                type="button"
                onClick={() => alert('Exporting PDF Telemetry Report...')}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 hover:text-[#0F172A] text-slate-700 font-bold rounded-xl border border-slate-200 transition cursor-pointer shadow-2xs"
              >
                <Download className="w-3.5 h-3.5 text-[#0F172A]" />
                <span>Export PDF</span>
              </button>
            </div>
          )}
        </div>

        {/* Thin divider with light red 10% opacity */}
        <div className="border-t border-[#E60012]/10" />

        {/* Section 3: Landscape Information Panel (Horizontal Arrangement) */}
        <div className="p-5 sm:p-6 space-y-5">
          {/* Single Plain Telemetry Overview Card (Speed, Fuel Type, Ignition Status, Trip, Date, Total Distance, Vehicle No, Address) */}
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-4 sm:p-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 sm:gap-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
              {/* 1. Vehicle No */}
              <div className="pt-2 sm:pt-0 sm:pl-3 first:pl-0 first:pt-0">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Vehicle No</span>
                <span className="font-mono font-black text-slate-900 text-sm block truncate mt-1">
                  {vehicle.registration_no}
                </span>
              </div>

              {/* 2. Speed */}
              <div className="pt-2 sm:pt-0 sm:pl-3 first:pl-0 first:pt-0">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Speed</span>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="font-mono font-black text-slate-900 text-sm">
                    {activeRoute && isMoving ? (vehicle.current_speed || 45) : 0}
                  </span>
                  <span className="text-[10px] font-bold text-slate-400">KM/H</span>
                </div>
              </div>

              {/* 3. Fuel Type */}
              <div className="pt-2 sm:pt-0 sm:pl-3 first:pl-0 first:pt-0">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Fuel Type</span>
                <span className="font-bold text-slate-800 text-xs sm:text-sm block truncate mt-1">
                  {vehicle.fuel_type || 'Diesel'}
                </span>
              </div>

              {/* 4. Ignition Status */}
              <div className="pt-2 sm:pt-0 sm:pl-3 first:pl-0 first:pt-0">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Ignition Status</span>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className={`inline-block w-2 h-2 rounded-full ${activeRoute && isMoving ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
                  <span className={`font-black text-xs ${activeRoute && isMoving ? 'text-emerald-700' : 'text-slate-500'}`}>
                    {activeRoute && isMoving ? 'ON' : 'OFF'}
                  </span>
                </div>
              </div>

              {/* 5. Trip */}
              <div className="pt-2 sm:pt-0 sm:pl-3 first:pl-0 first:pt-0">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Trip</span>
                <span className="font-bold text-slate-800 text-xs block truncate mt-1" title={activeRoute?.route_name || 'No Active Trip'}>
                  {activeRoute?.route_name || 'No Active Trip'}
                </span>
              </div>

              {/* 6. Date */}
              <div className="pt-2 sm:pt-0 sm:pl-3 first:pl-0 first:pt-0">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Date</span>
                <span className="font-mono font-bold text-slate-800 text-xs block truncate mt-1">
                  {activeRoute?.trip_date ? formatToDMY(activeRoute.trip_date) : (fromDate ? formatToDMY(fromDate) : '-')}
                </span>
              </div>

              {/* 7. Total Distance */}
              <div className="pt-2 sm:pt-0 sm:pl-3 first:pl-0 first:pt-0">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Distance</span>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="font-mono font-black text-slate-900 text-sm">
                    {activeRoute ? (activeRoute.total_distance_km || 0) : 0}
                  </span>
                  <span className="text-[10px] font-bold text-slate-400">KM</span>
                </div>
              </div>

              {/* 8. Address */}
              <div className="pt-2 sm:pt-0 sm:pl-3 first:pl-0 first:pt-0">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Address</span>
                <span className="font-medium text-slate-700 text-xs block truncate mt-1" title={activeRoute?.start_location_name || vehicle.location || 'Raipur, Chhattisgarh'}>
                  {activeRoute?.start_location_name || vehicle.location || 'Raipur, Chhattisgarh'}
                </span>
              </div>
            </div>
          </div>

          {/* Full-Width Route Map Section */}
          <div className="flex flex-col space-y-3">
            {/* No Allotted Route Banner if vehicle has no route yet */}
            {!activeRoute && (
              <div className="mb-4 p-4 rounded-2xl bg-amber-50/80 border border-amber-200/90 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center font-bold shrink-0">
                    <Navigation className="w-5 h-5 text-amber-700" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-slate-900 text-xs">No Active Route Allotted Yet</h4>
                    <p className="text-[11px] text-slate-600 mt-0.5">
                      This vehicle has not been assigned a road corridor. Allot a route with GPS Excel import, stoppages, and FASTag toll pricing.
                    </p>
                  </div>
                </div>

                {isAdmin && onPlanRoute && (
                  <button
                    type="button"
                    onClick={() => onPlanRoute(vehicle.id)}
                    className="px-4 py-2 bg-[#E60012] hover:bg-[#CC0010] text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>+ Allot Route for {vehicle.registration_no}</span>
                  </button>
                )}
              </div>
            )}

            {/* VEHICLE ROUTE PLAYBACK CONTROLLER BAR */}
            {activeRoute && parsedCoordinates.length > 0 && (
              <div className="mb-3.5 p-3.5 rounded-2xl bg-slate-50/80 border border-slate-200/90 shadow-2xs space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                    <span className="text-xs font-black uppercase tracking-wider text-slate-900">
                      Route Motion Playback Simulation
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border tabular-nums ${isPlaying
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : playbackIndex === smoothPlaybackCoordinates.length - 1
                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : 'bg-slate-100 text-slate-600 border-slate-200'
                      }`}>
                      {isPlaying ? `Moving • ${simulatedSpeed} km/h` : playbackIndex === smoothPlaybackCoordinates.length - 1 ? 'Trip Completed' : 'Paused / Standby'}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs">
                    <div className="flex items-center gap-1 font-mono font-bold text-slate-700">
                      <span className="text-slate-400 font-normal">Covered:</span>
                      <span className="text-slate-900 font-black tabular-nums min-w-[3.2rem] text-right inline-block">{simulatedDistanceCoveredKm}</span>
                      <span className="text-slate-400">/ {activeRoute.total_distance_km} KM</span>
                      <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-bold ml-1 tabular-nums min-w-[2.6rem] text-center inline-block">
                        {playbackProgressPercent}%
                      </span>
                    </div>

                    {activeRoute.trip_date && (
                      <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-600 font-mono bg-white px-2.5 py-1 rounded-xl border border-slate-200 shadow-2xs">
                        <Calendar className="w-3.5 h-3.5 text-red-500" />
                        <span className="font-bold">{activeRoute.trip_date}{activeRoute.end_trip_date && activeRoute.end_trip_date !== activeRoute.trip_date ? ` → ${activeRoute.end_trip_date}` : ''}</span>
                        <span className="text-slate-300">|</span>
                        <span>{activeRoute.start_trip_time || '08:00'} - {activeRoute.end_trip_time || '18:00'}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Progress Scrub Slider */}
                <div className="space-y-1">
                  <input
                    type="range"
                    min="0"
                    max={Math.max(1, smoothPlaybackCoordinates.length - 1)}
                    value={playbackIndex}
                    onChange={(e) => setPlaybackIndex(Number(e.target.value))}
                    className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#E60012]"
                  />
                </div>

                {/* Playback Controls & Speed Buttons */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-[#E2E8F0]">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (playbackIndex >= smoothPlaybackCoordinates.length - 1) {
                          setPlaybackIndex(0);
                        }
                        setIsPlaying(!isPlaying);
                      }}
                      className="px-3.5 py-1.5 rounded-xl bg-[#E60012] hover:bg-[#CC0010] text-white font-bold text-xs flex items-center gap-1.5 transition shadow-xs cursor-pointer"
                    >
                      {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                      <span>{isPlaying ? 'Pause' : playbackIndex >= smoothPlaybackCoordinates.length - 1 ? 'Replay Trip' : 'Play Route'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleResetPlayback}
                      className="p-1.5 rounded-xl bg-white hover:bg-slate-100 text-slate-600 border border-[#E2E8F0] text-xs transition cursor-pointer"
                      title="Reset to Start Point"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Speed Multiplier Options */}
                  <div className="flex items-center gap-1 text-xs">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">Speed:</span>
                    {[1, 2, 4, 8].map(speed => (
                      <button
                        key={speed}
                        type="button"
                        onClick={() => setPlaybackSpeed(speed)}
                        className={`px-2.5 py-0.5 rounded-lg font-mono font-bold text-[11px] transition cursor-pointer ${playbackSpeed === speed
                          ? 'bg-[#0F172A] text-white shadow-2xs'
                          : 'bg-white hover:bg-slate-100 text-slate-600 border border-[#E2E8F0]'
                          }`}
                      >
                        {speed === 1 ? '1x (Calm)' : `${speed}x`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="flex-1 min-h-[500px]">
              <ErrorBoundary title="Live Telemetry & Road Map">
                <InteractiveMap
                  height="520px"
                  center={vehicle.current_lat && Number(vehicle.current_lat) !== 0 ? [Number(vehicle.current_lat), Number(vehicle.current_lng)] : (activeRoute?.start_lat ? [Number(activeRoute.start_lat), Number(activeRoute.start_lng)] : (parsedCoordinates.length > 0 ? parsedCoordinates[0] : [21.8974, 82.8000]))}
                  zoom={8}
                  routes={trackingRoutes}
                  selectedRouteId={activeRoute ? `active-${activeRoute.id}` : ''}
                  vehiclePosition={simulatedVehiclePosition}
                  startPoint={memoizedStart}
                  endPoint={memoizedEnd}
                  stoppages={stoppagesWithTimings}
                  tollGates={routeTolls}
                />
              </ErrorBoundary>
            </div>

            {/* Route Leg Legend */}
            <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between text-xs font-semibold text-slate-600 gap-3">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <Flag className="w-3.5 h-3.5 text-emerald-600 fill-emerald-500" />
                  <span className="font-bold text-slate-800">Start (Green Flag)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Flag className="w-3.5 h-3.5 text-red-600 fill-red-500" />
                  <span className="font-bold text-slate-800">Destination (Red Flag)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-orange-500"></span>
                  <span>Stoppage Point</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-amber-500"></span>
                  <span>Toll Plaza</span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-red-600 font-bold">
                <span className="w-2 h-2 rounded-full bg-red-600"></span>
                <span>Vehicle Moving Live</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
