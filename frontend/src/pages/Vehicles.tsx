import * as XLSX from 'xlsx';
import { InteractiveMap } from '../components/InteractiveMap';
import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { Vehicle, User } from '../types';
import { DMYDateInput } from '../components/DMYDateInput';
import {
  enhanceRouteWithRoadGeometry,
  calculateCumulativeDistanceKm
} from '../utils/routePolylineUtils';
import { extractAccurateExcelTelemetry } from '../utils/excelTelemetryExtractor';
import {
  FileSpreadsheet,
  Navigation,
  History,
  Truck,
  Search,
  Filter,
  Plus,
  Edit3,
  Trash2,
  X,
  Check,
  AlertTriangle,
  MapPin,
  RefreshCw,
  Calendar,
  User as UserIcon
} from 'lucide-react';

interface VehiclesProps {
  onViewVehicle: (vehicleId: number, trip?: any, source?: 'assigned-vehicle' | 'trip-history') => void;
  onPlanRouteForVehicle?: (vehicleId: number) => void;
}

// Indian vehicle registration standard format validation
const INDIAN_VEHICLE_REGEX = /^[A-Z]{2}[ -]?[0-9]{1,2}[ -]?[A-Z]{0,3}[ -]?[0-9]{4}$/;

// Helper to reliably parse time into 12-hour components (hh, mm, AM/PM)
const parseTimeComponents = (timeStr?: string) => {
  if (!timeStr) return { hour: '08', minute: '00', period: 'AM' as const };
  const clean = timeStr.trim();
  const isPM = clean.toUpperCase().includes('PM');
  const isAM = clean.toUpperCase().includes('AM');
  const parts = clean.replace(/[^0-9:]/g, '').split(':');
  let h = parseInt(parts[0]) || 8;
  const m = parts[1] ? String(parseInt(parts[1]) || 0).padStart(2, '0') : '00';
  let period: 'AM' | 'PM' = 'AM';

  if (isPM) {
    period = 'PM';
    if (h > 12) h -= 12;
  } else if (isAM) {
    period = 'AM';
    if (h === 0) h = 12;
  } else {
    // 24-hour format fallback
    if (h >= 12) {
      period = 'PM';
      if (h > 12) h -= 12;
    } else {
      period = 'AM';
      if (h === 0) h = 12;
    }
  }
  return {
    hour: String(h).padStart(2, '0'),
    minute: m,
    period
  };
};

// Reusable Production-grade 12-Hour AM/PM Time Picker Component
const AmPmTimeInput: React.FC<{
  label: string;
  value: string;
  onChange: (val: string) => void;
}> = ({ label, value, onChange }) => {
  const parsed = parseTimeComponents(value);

  const handleHourChange = (newHour: string) => {
    onChange(`${newHour.padStart(2, '0')}:${parsed.minute} ${parsed.period}`);
  };

  const handleMinuteChange = (newMinute: string) => {
    onChange(`${parsed.hour}:${newMinute.padStart(2, '0')} ${parsed.period}`);
  };

  const handlePeriodChange = (newPeriod: 'AM' | 'PM') => {
    onChange(`${parsed.hour}:${parsed.minute} ${newPeriod}`);
  };

  const hours = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
  const minutes = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'];

  return (
    <div className="min-w-0">
      <label className="block text-slate-600 font-bold mb-1 text-xs">
        {label}
      </label>
      <div className="flex items-center justify-between gap-1 px-2 py-1.5 rounded-xl border border-slate-200 bg-white shadow-2xs">
        <div className="flex items-center gap-0.5 min-w-0">
          <select
            value={parsed.hour}
            onChange={(e) => handleHourChange(e.target.value)}
            className="bg-transparent font-mono font-bold text-xs text-slate-800 focus:outline-none cursor-pointer py-0.5 px-0.5"
          >
            {hours.map(h => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
          <span className="font-mono font-black text-slate-400">:</span>
          <select
            value={parsed.minute}
            onChange={(e) => handleMinuteChange(e.target.value)}
            className="bg-transparent font-mono font-bold text-xs text-slate-800 focus:outline-none cursor-pointer py-0.5 px-0.5"
          >
            {minutes.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center shrink-0 bg-slate-100 rounded-lg p-0.5 border border-slate-200 ml-1">
          <button
            type="button"
            onClick={() => handlePeriodChange('AM')}
            className={`px-1.5 py-0.5 text-[10px] font-black rounded-md transition cursor-pointer shrink-0 ${parsed.period === 'AM'
                ? 'bg-[#E60012] text-white shadow-2xs'
                : 'text-slate-500 hover:text-slate-800'
              }`}
          >
            AM
          </button>
          <button
            type="button"
            onClick={() => handlePeriodChange('PM')}
            className={`px-1.5 py-0.5 text-[10px] font-black rounded-md transition cursor-pointer shrink-0 ${parsed.period === 'PM'
                ? 'bg-[#E60012] text-white shadow-2xs'
                : 'text-slate-500 hover:text-slate-800'
              }`}
          >
            PM
          </button>
        </div>
      </div>
    </div>
  );
};

export const Vehicles: React.FC<VehiclesProps> = ({ onViewVehicle, onPlanRouteForVehicle }) => {
  const { isAdmin } = useAuth();

  // Fleet View State
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters for Fleet
  const [searchTerm, setSearchTerm] = useState('');
  const [userFilter, setUserFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);

  // Multi-Trip Management States
  const [tripModalVehicle, setTripModalVehicle] = useState<Vehicle | null>(null);
  const [vehicleTrips, setVehicleTrips] = useState<any[]>([]);
  const [savedCorridorsForTrip, setSavedCorridorsForTrip] = useState<any[]>([]);
  const [selectedCorridorForTripId, setSelectedCorridorForTripId] = useState<string>('');

  // Unified single list of all previous corridors and completed trips (no duplicate sections)
  const unifiedCorridorsList = useMemo(() => {
    const list: Array<{ id: string; label: string; raw: any }> = [];
    const seen = new Set<string>();

    // 1. Vehicle trips
    (vehicleTrips || []).forEach((t: any, idx: number) => {
      const name = (t.route_name || `Trip #${t.id || idx}`).replace(/\r?\n/g, ' ').trim();
      const dist = Number(t.total_distance_km || 0);
      const key = `${name.toLowerCase()}__${dist}`;
      if (!seen.has(key)) {
        seen.add(key);
        list.push({
          id: `trip-${t.id}`,
          label: `${name} (${dist} KM${t.trip_date ? ` • ${t.trip_date}` : ''})`,
          raw: t
        });
      }
    });

    // 2. Saved corridors
    (savedCorridorsForTrip || []).forEach((c: any, idx: number) => {
      const name = (c.route_name || `Route #${c.id || idx}`).replace(/\r?\n/g, ' ').trim();
      const dist = Number(c.total_distance_km || c.distance_km || 0);
      const key = `${name.toLowerCase()}__${dist}`;
      if (!seen.has(key)) {
        seen.add(key);
        list.push({
          id: `corridor-${c.id}`,
          label: `${name} (${dist} KM)`,
          raw: c
        });
      }
    });

    return list;
  }, [vehicleTrips, savedCorridorsForTrip]);
  const [selectedOriginalWaypoints, setSelectedOriginalWaypoints] = useState<any[]>([]);
  const [selectedOriginalTolls, setSelectedOriginalTolls] = useState<any[]>([]);
  const [loadingTrips, setLoadingTrips] = useState<boolean>(false);

  // Dedicated Vehicle Trip History States (Admin & User)
  const [historyModalVehicle, setHistoryModalVehicle] = useState<Vehicle | null>(null);
  const [vehicleHistoryTrips, setVehicleHistoryTrips] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);
  const [tripForm, setTripForm] = useState({
    route_name: '',
    trip_date: new Date().toISOString().split('T')[0],
    start_trip_time: '08:00 AM',
    end_trip_time: '06:00 PM',
    start_location_name: '',
    end_location_name: '',
    total_distance_km: '',
    total_toll_fee: '340',
    toll_gates_count: '2',
    stoppages_count: '2'
  });
  const [tripExcelSummary, setTripExcelSummary] = useState<any | null>(null);
  const [tripExcelPoints, setTripExcelPoints] = useState<Array<{ lat: number; lng: number; name: string }>>([]);
  const [savingTrip, setSavingTrip] = useState<boolean>(false);

  // Live Map Modal State
  const [mapModalVehicle, setMapModalVehicle] = useState<Vehicle | null>(null);
  const [mapModalData, setMapModalData] = useState<any>(null);
  const [loadingMapModal, setLoadingMapModal] = useState<boolean>(false);

  // Quick Route Parameters Inline Edit State
  const [quickEditVehicleId, setQuickEditVehicleId] = useState<number | null>(null);
  const [quickEditForm, setQuickEditForm] = useState({
    start_trip_time: '08:00 AM',
    end_trip_time: '06:00 PM',
    total_toll_fee: '340',
    stoppages_count: '2'
  });
  const [savingQuickEdit, setSavingQuickEdit] = useState<boolean>(false);
  const [deletingVehicleId, setDeletingVehicleId] = useState<number | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isAddModalOpen) setIsAddModalOpen(false);
        if (deletingVehicleId !== null) setDeletingVehicleId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAddModalOpen, deletingVehicleId]);

  // Form State without GPS device id and max speed limit, but with axle_type and chassis_number
  const [formData, setFormData] = useState({
    registration_no: '',
    name_model: '',
    vehicle_type: 'Truck',
    axle_type: '2-axle',
    imei_number: '',
    chassis_number: '',
    fuel_type: 'Diesel',
    assigned_user_id: '',
    status: 'active'
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [formSubmitting, setFormSubmitting] = useState(false);

  const fetchVehiclesAndUsers = async () => {
    try {
      setLoading(true);
      const [vehList, userList] = await Promise.all([
        api.getVehicles({
          search: searchTerm,
          userId: userFilter,
          type: typeFilter,
          status: statusFilter
        }),
        isAdmin ? api.getUsers() : Promise.resolve([])
      ]);
      const uniqueVehicles = Array.from(new Map((vehList || []).map((v: Vehicle) => [v.id, v])).values());
      setVehicles(uniqueVehicles);
      setUsers(userList);
    } catch (err) {
      console.error('Failed to load fleet data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVehiclesAndUsers();
  }, [userFilter, typeFilter, statusFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchVehiclesAndUsers();
  };

  // Open Live Map Modal
  // Open Multi-Trip Manager Modal (+)
  const handleOpenAddTripModal = async (v: Vehicle) => {
    setTripModalVehicle(v);
    setTripExcelSummary(null);
    setTripExcelPoints([]);
    setSelectedOriginalWaypoints([]);
    setSelectedOriginalTolls([]);
    setLoadingTrips(true);
    try {
      const [trips, corridors] = await Promise.all([
        api.getVehicleTrips(v.id),
        api.getSavedCorridors().catch(() => [])
      ]);
      setVehicleTrips(trips || []);
      setSavedCorridorsForTrip(corridors || []);
      const tripNum = (trips || []).length + 1;
      setTripForm({
        route_name: `Trip #${tripNum}: ${v.registration_no} Corridor`,
        trip_date: new Date().toISOString().split('T')[0],
        start_trip_time: '08:00 AM',
        end_trip_time: '06:00 PM',
        start_location_name: '',
        end_location_name: '',
        total_distance_km: '',
        total_toll_fee: '0',
        toll_gates_count: '0',
        stoppages_count: '0'
      });

      setSelectedCorridorForTripId('');

      // Pre-populate corridor if vehicle has assigned route or previous corridor exists
      const allSources = [...(trips || []), ...(corridors || [])];
      if (allSources.length > 0) {
        const matching = allSources.find((c: any) =>
          (v.route_name && c.route_name && c.route_name.includes(v.route_name)) ||
          (c.route_name && c.route_name.includes(v.registration_no))
        ) || allSources[0];
        if (matching) {
          handleSelectSavedCorridorForTrip(String(matching.id), allSources);
        }
      }
    } catch (e) {
      setVehicleTrips([]);
      setSavedCorridorsForTrip([]);
    } finally {
      setLoadingTrips(false);
    }
  };

  const handleSelectSavedCorridorForTrip = (val: string, list?: any[]) => {
    if (!val || !tripModalVehicle) return;
    const cleanVal = String(val).trim();
    const sourceList = list && list.length > 0 ? list : [...vehicleTrips, ...savedCorridorsForTrip];

    let found: any = null;
    if (cleanVal.startsWith('trip-')) {
      const targetId = cleanVal.replace('trip-', '');
      found = vehicleTrips.find((t: any) => String(t.id) === targetId);
    } else if (cleanVal.startsWith('corridor-')) {
      const targetId = cleanVal.replace('corridor-', '');
      found = savedCorridorsForTrip.find((c: any) => String(c.id) === targetId);
    }
    if (!found) {
      found = sourceList.find((c: any) =>
        String(c.id) === cleanVal ||
        c.route_name === val ||
        (c.route_name && c.route_name.replace(/\r?\n/g, ' ').trim() === cleanVal.replace(/\r?\n/g, ' ').trim())
      );
    }
    if (!found) return;

    setSelectedCorridorForTripId(cleanVal.startsWith('trip-') || cleanVal.startsWith('corridor-') ? cleanVal : String(found.id));

    let poly: [number, number][] = [];
    if (found.overview_polyline) {
      try {
        const parsed = typeof found.overview_polyline === 'string'
          ? JSON.parse(found.overview_polyline)
          : found.overview_polyline;
        if (Array.isArray(parsed)) {
          poly = parsed.map((pt: any): [number, number] => {
            if (Array.isArray(pt)) return [Number(pt[0]), Number(pt[1])];
            return [Number(pt.lat), Number(pt.lng)];
          }).filter((pt: [number, number]) => !isNaN(pt[0]) && !isNaN(pt[1]));
        }
      } catch (e) {
        poly = [];
      }
    }

    if (poly.length < 2 && found.waypoints_json) {
      try {
        const wps = typeof found.waypoints_json === 'string' ? JSON.parse(found.waypoints_json) : found.waypoints_json;
        if (Array.isArray(wps) && wps.length >= 2) {
          poly = wps.map((w: any): [number, number] => [Number(w.lat), Number(w.lng)]).filter((pt: [number, number]) => !isNaN(pt[0]) && !isNaN(pt[1]));
        }
      } catch (e) { }
    }

    // Fallback if polyline is empty
    if (poly.length < 2 && found.start_lat && found.end_lat) {
      poly = [
        [Number(found.start_lat), Number(found.start_lng)],
        [Number(found.end_lat), Number(found.end_lng)]
      ];
    }

    const cleanRouteName = (found.route_name || '').replace(/\r?\n/g, ' ').trim();

    const points = poly.map((pt, idx) => ({
      lat: pt[0],
      lng: pt[1],
      name: idx === 0
        ? (found.start_location_name || 'Origin')
        : idx === poly.length - 1
          ? (found.end_location_name || 'Destination')
          : `Waypoint #${idx}`
    }));

    if (points.length >= 2) {
      setTripExcelPoints(points);
    }

    setTripExcelSummary({
      vehicleReg: cleanRouteName.split(':')[0] || tripModalVehicle.registration_no,
      distanceKm: Number(found.total_distance_km || found.distance_km || 0),
      avgSpeed: 45,
      runningTime: '03:30',
      haltedTime: '00:30'
    });

    // Parse exact original waypoints / stoppages from selected trip or saved corridor
    let rawWaypoints: any[] = [];
    if (found.waypoints && Array.isArray(found.waypoints) && found.waypoints.length > 0) {
      rawWaypoints = found.waypoints;
    } else if (found.waypoints_json) {
      try {
        const wp = typeof found.waypoints_json === 'string' ? JSON.parse(found.waypoints_json) : found.waypoints_json;
        if (Array.isArray(wp) && wp.length > 0) rawWaypoints = wp;
      } catch (_) {}
    }

    // Parse exact original toll gates from selected trip or saved corridor
    let rawTolls: any[] = [];
    if (found.toll_gates && Array.isArray(found.toll_gates) && found.toll_gates.length > 0) {
      rawTolls = found.toll_gates;
    } else if (found.toll_gates_json) {
      try {
        const tg = typeof found.toll_gates_json === 'string' ? JSON.parse(found.toll_gates_json) : found.toll_gates_json;
        if (Array.isArray(tg) && tg.length > 0) rawTolls = tg;
      } catch (_) {}
    }

    // Deduplicate any accidental duplicate toll entries
    const seenTollKeys = new Set<string>();
    const deduplicatedTolls: any[] = [];
    for (const t of rawTolls) {
      const key = `${t.name || ''}_${Number(t.lat || 0).toFixed(4)}_${Number(t.lng || 0).toFixed(4)}`;
      if (!seenTollKeys.has(key)) {
        seenTollKeys.add(key);
        deduplicatedTolls.push(t);
      }
    }
    rawTolls = deduplicatedTolls;

    setSelectedOriginalWaypoints(rawWaypoints);
    setSelectedOriginalTolls(rawTolls);

    const calculatedTotalToll = rawTolls.reduce((sum: number, t: any) => sum + (Number(t.charges) || 0), 0);
    const finalTollFee = calculatedTotalToll > 0 ? calculatedTotalToll : (Number(found.total_toll_fee) || Number(found.total_tolls_amount) || 0);

    let finalDistKm = Number(found.total_distance_km || found.distance_km || 0);
    if ((!finalDistKm || finalDistKm <= 0) && poly.length >= 2) {
      finalDistKm = calculateCumulativeDistanceKm(poly);
    }

    const tripNum = vehicleTrips.length + 1;
    setTripForm(prev => ({
      ...prev,
      route_name: cleanRouteName || `Trip #${tripNum}: ${found.start_location_name || 'Origin'} to ${found.end_location_name || 'Destination'}`,
      start_location_name: found.start_location_name || '',
      end_location_name: found.end_location_name || '',
      total_distance_km: finalDistKm > 0 ? String(finalDistKm) : '',
      total_toll_fee: String(finalTollFee),
      toll_gates_count: String(rawTolls.length),
      stoppages_count: String(rawWaypoints.length),
      start_trip_time: found.start_trip_time || prev.start_trip_time || '08:00 AM',
      end_trip_time: found.end_trip_time || prev.end_trip_time || '06:00 PM'
    }));
  };

  // Parse Excel for Vehicle Trip (.xlsx, .csv)
  const handleTripExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !tripModalVehicle) return;

    setSelectedOriginalWaypoints([]);
    setSelectedOriginalTolls([]);
    setSelectedCorridorForTripId('');

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });

        // Extract 100% Accurate Telemetry & Coordinates using Universal Parser
        const tele = extractAccurateExcelTelemetry(workbook);
        const validPoints = tele.rawPoints;

        if (!validPoints || validPoints.length < 2) {
          alert('Could not detect coordinates in ' + tele.detailsSheetName);
          return;
        }

        const calculatedDistKm = tele.distanceKm;

        const summaryMeta: any = {
          vehicleReg: tele.vehicleReg,
          startDate: tele.startDate,
          endDate: tele.endDate,
          distanceKm: calculatedDistKm,
          avgSpeed: tele.avgSpeed,
          maxSpeed: tele.maxSpeed,
          runningTime: tele.runningTime,
          haltedTime: tele.haltedTime
        };

        setTripExcelSummary(summaryMeta);
        setTripExcelPoints(validPoints);
        setSelectedCorridorForTripId('');

        // Road curve smoothing for any sparse points so route hugs real road curves
        const rawCoords: [number, number][] = validPoints.map(p => [p.lat, p.lng]);
        enhanceRouteWithRoadGeometry(rawCoords).then(enhanced => {
          if (enhanced && enhanced.length > 0) {
            const finalPoints = enhanced.map((c, idx) => ({
              name: idx === 0 ? validPoints[0].name : idx === enhanced.length - 1 ? validPoints[validPoints.length - 1].name : `Point #${idx + 1}`,
              lat: c[0],
              lng: c[1]
            }));
            setTripExcelPoints(finalPoints);
            // CRITICAL: Only overwrite if NO meter reading was found in Excel
            const accurateDist = calculateCumulativeDistanceKm(enhanced);
            if (accurateDist > 0 && !tele.isAccurateMeterFound) {
              setTripForm(prev => ({ ...prev, total_distance_km: String(accurateDist) }));
            }
          }
        });

        const startLoc = validPoints[0].name.split(',')[0];
        const endLoc = validPoints[validPoints.length - 1].name.split(',')[0];
        const tripNum = vehicleTrips.length + 1;

        setTripForm(prev => ({
          ...prev,
          route_name: `Trip #${tripNum}: ${startLoc} to ${endLoc}`,
          start_location_name: validPoints[0].name,
          end_location_name: validPoints[validPoints.length - 1].name,
          total_distance_km: String(calculatedDistKm),
          stoppages_count: prev.stoppages_count || '2',
          trip_date: summaryMeta.startDate ? summaryMeta.startDate.split(',')[0].trim() : prev.trip_date
        }));
      } catch (err: any) {
        alert('Excel Parse Error: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Map preview calculations for Add Trip Modal with Interactive Draggable Route
  const previewPolyline = React.useMemo<[number, number][]>(() => {
    if (tripExcelPoints.length >= 2) {
      return tripExcelPoints.map(p => [p.lat, p.lng]);
    }
    return [];
  }, [tripExcelPoints]);

  const modalStartPoint = React.useMemo(() => {
    if (tripExcelPoints.length > 0) {
      return {
        lat: tripExcelPoints[0].lat,
        lng: tripExcelPoints[0].lng,
        name: tripExcelPoints[0].name || 'Start Point'
      };
    }
    return null;
  }, [tripExcelPoints]);

  const modalEndPoint = React.useMemo(() => {
    if (tripExcelPoints.length > 1) {
      const end = tripExcelPoints[tripExcelPoints.length - 1];
      return {
        lat: end.lat,
        lng: end.lng,
        name: end.name || 'End Point'
      };
    }
    return null;
  }, [tripExcelPoints]);

  const modalStoppages = React.useMemo(() => {
    const count = Math.max(0, parseInt(tripForm.stoppages_count) || 0);
    if (count <= 0) return [];

    // If exact original waypoints exist from re-used completed trip or corridor and count matches, preserve them 100%!
    if (selectedOriginalWaypoints.length > 0 && selectedOriginalWaypoints.length === count) {
      return selectedOriginalWaypoints.map((w, idx) => ({
        id: w.id || idx + 1,
        sequence_order: w.sequence_order || idx + 1,
        name: w.name || `Transit Halt #${idx + 1}`,
        address: w.address || `Highway Stoppage at ${Number(w.lat).toFixed(4)}, ${Number(w.lng).toFixed(4)}`,
        lat: Number(w.lat),
        lng: Number(w.lng),
        stop_duration_mins: w.stop_duration_mins || w.duration || 20
      }));
    }

    if (tripExcelPoints.length < 2) return [];
    const list = [];
    for (let i = 0; i < count; i++) {
      const ratio = (i + 1) / (count + 1);
      const pIdx = Math.min(tripExcelPoints.length - 1, Math.max(0, Math.floor(tripExcelPoints.length * ratio)));
      const pt = tripExcelPoints[pIdx] || tripExcelPoints[0];
      list.push({
        id: i + 1,
        sequence_order: i + 1,
        name: `Transit Halt #${i + 1}`,
        address: `Highway Stoppage at ${pt.lat.toFixed(4)}, ${pt.lng.toFixed(4)}`,
        lat: pt.lat,
        lng: pt.lng,
        stop_duration_mins: 20
      });
    }
    return list;
  }, [selectedOriginalWaypoints, tripExcelPoints, tripForm.stoppages_count]);

  const modalTolls = React.useMemo(() => {
    const count = Math.max(0, parseInt(tripForm.toll_gates_count) || 0);
    const totalFee = Number(tripForm.total_toll_fee) || 0;
    const feePerToll = count > 0 ? Math.round(totalFee / count) : 0;
    if (count <= 0) return [];

    // If exact original tolls exist from re-used completed trip or corridor and count matches, preserve them 100%!
    if (selectedOriginalTolls.length > 0 && selectedOriginalTolls.length === count) {
      return selectedOriginalTolls.map((t, idx) => ({
        id: t.id || idx + 1,
        name: t.name || `FASTag Toll Plaza #${idx + 1}`,
        lat: Number(t.lat),
        lng: Number(t.lng),
        charges: Number(t.charges) || feePerToll,
        toll_type: t.toll_type || 'FASTag ETC',
        is_manual: t.is_manual ?? true
      }));
    }

    if (tripExcelPoints.length < 2) return [];
    const list = [];
    for (let i = 0; i < count; i++) {
      const ratio = (i + 1) / (count + 1);
      const pIdx = Math.min(tripExcelPoints.length - 1, Math.max(0, Math.floor(tripExcelPoints.length * ratio)));
      const pt = tripExcelPoints[pIdx] || tripExcelPoints[0];
      list.push({
        id: i + 1,
        name: `FASTag Toll Plaza #${i + 1}`,
        lat: pt.lat,
        lng: pt.lng,
        charges: feePerToll,
        toll_type: 'FASTag ETC',
        is_manual: false
      });
    }
    return list;
  }, [selectedOriginalTolls, tripExcelPoints, tripForm.toll_gates_count, tripForm.total_toll_fee]);

  const previewRoutes = React.useMemo(() => {
    if (previewPolyline.length < 2) return [];
    return [{
      id: 'preview-trip-route',
      name: tripForm.route_name || 'Active Trip Route',
      distanceKm: Number(tripForm.total_distance_km) || 0,
      timeMinutes: 180,
      coordinates: previewPolyline,
      color: '#1A73E8',
      isPrimary: true,
      summary: 'Trip Corridor',
      tollGatesCount: modalTolls.length,
      stopsCount: modalStoppages.length
    }];
  }, [previewPolyline, tripForm.route_name, tripForm.total_distance_km, modalTolls.length, modalStoppages.length]);

  const handleModalRouteDrag = (updated: { coordinates: [number, number][]; distanceKm: number; timeMinutes: number }) => {
    if (updated.coordinates && updated.coordinates.length > 0) {
      const newPoints = updated.coordinates.map((c, idx) => ({
        name: idx === 0 ? 'Start Location' : idx === updated.coordinates.length - 1 ? 'End Location' : `Waypoint #${idx}`,
        lat: c[0],
        lng: c[1]
      }));
      setTripExcelPoints(newPoints);
    }
    if (updated.distanceKm) {
      setTripForm(prev => ({
        ...prev,
        total_distance_km: updated.distanceKm.toFixed(1)
      }));
    }
  };

  // Open Dedicated Vehicle Trip History Modal (Admin & User)
  const handleOpenHistoryModal = async (v: Vehicle) => {
    setHistoryModalVehicle(v);
    setLoadingHistory(true);
    try {
      const trips = await api.getVehicleTrips(v.id);
      setVehicleHistoryTrips(trips || []);
    } catch (e) {
      setVehicleHistoryTrips([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  // Group trips date-wise for History Modal
  const historyTripsByDate = React.useMemo(() => {
    const groups: { [date: string]: any[] } = {};
    vehicleHistoryTrips.forEach(t => {
      const rawDate = t.trip_date || (t.created_at ? t.created_at.split('T')[0] : 'Recent');
      if (!groups[rawDate]) groups[rawDate] = [];
      groups[rawDate].push(t);
    });
    return groups;
  }, [vehicleHistoryTrips]);

  const handleActivateHistoricalTrip = async (routeId: number) => {
    if (!historyModalVehicle) return;
    try {
      await api.activateVehicleTrip(routeId);
      const updatedTrips = await api.getVehicleTrips(historyModalVehicle.id);
      setVehicleHistoryTrips(updatedTrips || []);
      fetchVehiclesAndUsers();
    } catch (err: any) {
      alert('Failed to activate trip: ' + err.message);
    }
  };

  const [updatingTripStatusId, setUpdatingTripStatusId] = useState<number | null>(null);

  const handleUpdateTripOperationalStatus = async (routeId: number, status: string) => {
    if (!historyModalVehicle) return;
    setUpdatingTripStatusId(routeId);
    try {
      await api.updateRouteOperationalStatus(routeId, status);
      const updatedTrips = await api.getVehicleTrips(historyModalVehicle.id);
      setVehicleHistoryTrips(updatedTrips || []);
      setHistoryModalVehicle(prev => prev ? { ...prev, status: status as any } : prev);
      fetchVehiclesAndUsers();
    } catch (err: any) {
      alert('Failed to update operational status: ' + (err.message || 'Error'));
    } finally {
      setUpdatingTripStatusId(null);
    }
  };

  const handleViewHistoricalTripOnMap = async (trip: any) => {
    if (!historyModalVehicle) return;
    try {
      if (!trip.is_active) {
        await api.activateVehicleTrip(trip.id);
      }
      const vehicleId = historyModalVehicle.id;
      setHistoryModalVehicle(null);
      onViewVehicle(vehicleId, trip, 'trip-history');
    } catch (err: any) {
      const vehicleId = historyModalVehicle.id;
      setHistoryModalVehicle(null);
      onViewVehicle(vehicleId, trip, 'trip-history');
    }
  };

  // Save new trip for this vehicle
  const handleSaveVehicleTrip = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tripModalVehicle) return;

    try {
      setSavingTrip(true);
      const tripNum = vehicleTrips.length + 1;

      const startCoord = tripExcelPoints[0] || { lat: 21.2580, lng: 81.5645, name: 'Origin' };
      const endCoord = tripExcelPoints[tripExcelPoints.length - 1] || { lat: 22.0620, lng: 82.1150, name: 'Destination' };

      const startLocName = startCoord.name || tripForm.start_location_name || 'Origin';
      const endLocName = endCoord.name || tripForm.end_location_name || 'Destination';
      const routeName = tripForm.route_name.trim() || `Trip #${tripNum}: ${startLocName} to ${endLocName}`;

      const polyline = tripExcelPoints.length >= 2
        ? tripExcelPoints.map(p => [p.lat, p.lng])
        : [[startCoord.lat, startCoord.lng], [endCoord.lat, endCoord.lng]];

      // Use exact configured stoppages and toll plazas (preserves 100% of previous trip or generated points)
      const waypoints = modalStoppages.map((s, idx) => ({
        sequence_order: s.sequence_order || idx + 1,
        name: s.name || `Transit Halt #${idx + 1}`,
        address: s.address || `Highway Stoppage at ${Number(s.lat).toFixed(4)}, ${Number(s.lng).toFixed(4)}`,
        lat: Number(s.lat),
        lng: Number(s.lng),
        duration: s.stop_duration_mins || 20
      }));

      const tollsCount = Math.max(0, parseInt(tripForm.toll_gates_count) || 0);
      const totalFee = Number(tripForm.total_toll_fee) || 0;
      const feePerToll = tollsCount > 0 ? Math.round(totalFee / tollsCount) : 0;

      const generatedTolls = modalTolls.map((t, idx) => ({
        name: t.name || `FASTag Toll Plaza #${idx + 1}`,
        lat: Number(t.lat),
        lng: Number(t.lng),
        charges: Number(t.charges) || feePerToll,
        is_manual: t.is_manual ?? true,
        toll_type: t.toll_type || 'FASTag ETC'
      }));

      await api.addVehicleTrip(tripModalVehicle.id, {
        route_name: routeName,
        start_location_name: startLocName,
        start_address: startLocName,
        start_lat: startCoord.lat,
        start_lng: startCoord.lng,
        end_location_name: endLocName,
        end_address: endLocName,
        end_lat: endCoord.lat,
        end_lng: endCoord.lng,
        total_distance_km: Number(tripForm.total_distance_km) || 120,
        estimated_travel_time_min: 180,
        overview_polyline: polyline,
        waypoints: waypoints,
        toll_gates: generatedTolls,
        trip_date: tripForm.trip_date,
        start_trip_time: tripForm.start_trip_time,
        end_trip_time: tripForm.end_trip_time
      });

      // Refresh vehicles & close modal
      fetchVehiclesAndUsers();
      setTripModalVehicle(null);
      alert(`${routeName} successfully recorded and allocated to ${tripModalVehicle.registration_no}!`);
    } catch (err: any) {
      alert('Failed to save trip: ' + err.message);
    } finally {
      setSavingTrip(false);
    }
  };

  // Activate trip
  const handleActivateTrip = async (routeId: number) => {
    if (!tripModalVehicle) return;
    try {
      await api.activateVehicleTrip(routeId);
      const updatedTrips = await api.getVehicleTrips(tripModalVehicle.id);
      setVehicleTrips(updatedTrips || []);
      fetchVehiclesAndUsers();
    } catch (err: any) {
      alert('Failed to activate trip: ' + err.message);
    }
  };

  const handleOpenMapModal = async (v: Vehicle) => {
    setMapModalVehicle(v);
    setLoadingMapModal(true);
    try {
      const data = await api.getVehicle(v.id);
      setMapModalData(data);
    } catch (e) {
      setMapModalData(null);
    } finally {
      setLoadingMapModal(false);
    }
  };

  // Open Quick Route Edit
  const handleOpenQuickEdit = (v: Vehicle) => {
    if (quickEditVehicleId === v.id) {
      setQuickEditVehicleId(null);
      return;
    }
    setQuickEditVehicleId(v.id);
    setQuickEditForm({
      start_trip_time: (v as any).start_trip_time || '08:00',
      end_trip_time: (v as any).end_trip_time || '18:00',
      total_toll_fee: String((v as any).total_toll_fee || (v as any).toll_fee || 340),
      stoppages_count: String((v as any).stoppages_count || (v as any).stops || 2)
    });
  };

  // Save Quick Route Edit
  const handleSaveQuickRoute = async (vId: number) => {
    try {
      setSavingQuickEdit(true);
      await api.updateQuickRoute(vId, {
        start_trip_time: quickEditForm.start_trip_time,
        end_trip_time: quickEditForm.end_trip_time,
        total_toll_fee: Number(quickEditForm.total_toll_fee) || 0,
        stoppages_count: Number(quickEditForm.stoppages_count) || 0
      });
      setQuickEditVehicleId(null);
      fetchVehiclesAndUsers();
    } catch (err: any) {
      alert('Failed to update route parameters: ' + err.message);
    } finally {
      setSavingQuickEdit(false);
    }
  };

  const openAddModal = () => {
    setEditingVehicle(null);
    setFormData({
      registration_no: '',
      name_model: '',
      vehicle_type: 'Truck',
      axle_type: '2-axle',
      imei_number: `86420904${Math.floor(1000000 + Math.random() * 9000000)}`,
      chassis_number: `MB1T${Math.floor(100000 + Math.random() * 900000)}`,
      fuel_type: 'Diesel',
      assigned_user_id: '',
      status: 'active'
    });
    setFormError(null);
    setIsAddModalOpen(true);
  };

  const openEditModal = (vehicle: Vehicle) => {
    setEditingVehicle(vehicle);
    setFormData({
      registration_no: vehicle.registration_no,
      name_model: vehicle.name_model,
      vehicle_type: vehicle.vehicle_type,
      axle_type: (vehicle as any).axle_type || '2-axle',
      imei_number: vehicle.imei_number || '',
      chassis_number: vehicle.chassis_number || '',
      fuel_type: vehicle.fuel_type || 'Diesel',
      assigned_user_id: vehicle.assigned_user_id ? String(vehicle.assigned_user_id) : '',
      status: vehicle.status || 'active'
    });
    setFormError(null);
    setIsAddModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanReg = formData.registration_no.trim().toUpperCase();
    if (!cleanReg || !formData.name_model.trim()) {
      setFormError('Please fill in Registration Number and Vehicle Name/Model.');
      return;
    }

    // Validate standard Indian vehicle registration format
    if (!INDIAN_VEHICLE_REGEX.test(cleanReg.replace(/\s+/g, ''))) {
      setFormError('Invalid Vehicle Number. Please enter a valid Indian registration format (e.g., MH12RN4589, DL01AB1024, CG04A1234).');
      return;
    }

    try {
      setFormSubmitting(true);
      setFormError(null);

      // Auto-generate device id in background if new
      const deviceId = editingVehicle?.device_id || `GPS-${cleanReg.replace(/[^A-Z0-9]/g, '')}`;

      const payload = {
        ...formData,
        registration_no: cleanReg,
        device_id: deviceId,
        assigned_user_id: formData.assigned_user_id ? parseInt(formData.assigned_user_id) : null,
        max_speed_limit: 80
      };

      if (editingVehicle) {
        await api.updateVehicle(editingVehicle.id, payload);
      } else {
        await api.createVehicle(payload);
      }

      setIsAddModalOpen(false);
      fetchVehiclesAndUsers();
    } catch (err: any) {
      setFormError(err.message || 'Operation failed');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleDeleteVehicle = async (id: number) => {
    try {
      await api.deleteVehicle(id);
      setDeletingVehicleId(null);
      fetchVehiclesAndUsers();
    } catch (err: any) {
      alert('Delete failed: ' + err.message);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-7 space-y-4 max-w-7xl mx-auto font-sans">
      {/* ONE LARGE UNIFIED MAIN CONTAINER (ALL-IN-ONE ENTERPRISE LAYOUT) */}
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-xs overflow-hidden">
        {/* Section 1: Top Header */}
        <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2.5">
              <Truck className="w-6 h-6 text-[#0F172A]" />
              <span>Commercial Fleet & Vehicle Units</span>
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Manage commercial vehicles, allocate users, configure highway corridors, and track FASTag toll debits.
            </p>
          </div>

          {isAdmin && (
            <button
              type="button"
              onClick={openAddModal}
              className="flex items-center gap-2 px-4 py-2 bg-[#0F172A] hover:bg-[#1E293B] text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer self-start sm:self-auto"
            >
              <Plus className="w-3.5 h-3.5 text-emerald-200" />
              <span>Add Vehicle</span>
            </button>
          )}
        </div>

        {/* Thin divider with light red 10% opacity */}
        <div className="border-t border-[#E60012]/10" />

        {/* Section 2: Filter and Search Bar */}
        <div className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50/40">
          <form onSubmit={handleSearchSubmit} className="flex-1 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search vehicle no, model, user, chassis..."
              className="w-full pl-9 pr-4 py-1.5 rounded-xl border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-slate-400 bg-white transition"
            />
          </form>

          <div className="flex flex-wrap items-center gap-2">
            {isAdmin && (
              <select
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs text-slate-700 bg-white focus:outline-none focus:border-slate-400"
              >
                <option value="all">All Users</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            )}

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs text-slate-700 bg-white focus:outline-none focus:border-slate-400"
            >
              <option value="all">All Vehicle Types</option>
              <option value="Truck">Truck</option>
              <option value="Heavy Truck">Heavy Truck</option>
              <option value="Mini Truck">Mini Truck</option>
              <option value="Pickup">Pickup</option>
              <option value="Cargo">Cargo</option>
              <option value="Trailer">Trailer</option>
              <option value="Van">Van</option>
              <option value="Car">Car</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs text-slate-700 bg-white focus:outline-none focus:border-slate-400"
            >
              <option value="all">All Status</option>
              <option value="moving">Moving</option>
              <option value="stop">Stop</option>
              <option value="parking">Parking</option>
              <option value="active">Active (Online)</option>
              <option value="inactive">Inactive</option>
            </select>

            <button
              type="button"
              onClick={fetchVehiclesAndUsers}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 text-slate-700 text-xs font-bold rounded-xl transition flex items-center gap-1.5 border border-slate-200 cursor-pointer"
              title="Apply Filter"
            >
              <Filter className="w-3.5 h-3.5" />
              <span>Filter</span>
            </button>
          </div>
        </div>

        {/* Thin divider with light red 10% opacity */}
        <div className="border-t border-[#E60012]/10" />

        {/* Section 3: Vehicles Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#F8FAFC] border-b border-slate-100 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-3.5 px-4">Registration</th>
                <th className="py-3.5 px-4">Assigned User</th>
                <th className="py-3.5 px-4">Vehicle Type</th>
                <th className="py-3.5 px-4">Speed</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vehicles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400 text-xs">
                    {loading ? 'Loading fleet vehicles...' : 'No vehicles found matching current criteria.'}
                  </td>
                </tr>
              ) : (
                vehicles.map((v) => {
                  return (
                    <tr key={v.id} className="hover:bg-slate-50/70 transition">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-[#F1F5F9] text-[#0F172A] flex items-center justify-center font-bold">
                            <Truck className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="font-extrabold text-slate-900 font-mono text-sm tracking-tight">
                              {v.registration_no}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        {v.owner_name ? (
                          <div>
                            <p className="font-bold text-slate-800">{v.owner_name}</p>
                            <p className="text-[10px] text-slate-500">{v.owner_email}</p>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic text-[11px]">Unassigned</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <p className="font-bold text-slate-800 text-xs">{v.name_model}</p>
                        <span className="inline-block text-[10px] px-2 py-0.5 mt-0.5 rounded-md bg-slate-100 text-slate-600 font-medium">
                          {v.vehicle_type}
                        </span>
                      </td>

                      <td className="py-3.5 px-4">
                        <span className="font-mono font-bold text-slate-900 text-sm">
                          {v.status === 'moving' ? (v.current_speed || 48) : 0}
                        </span>
                        <span className="text-[10px] text-slate-400 ml-1">km/h</span>
                      </td>

                      <td className="py-3.5 px-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold ${
                          v.status === 'moving'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : (v.status === 'stop' || v.status === 'stopped')
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : v.status === 'parking'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : v.status === 'active'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'bg-slate-100 text-slate-600 border border-slate-200'
                        }`}>
                          {v.status === 'moving' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>}
                          {v.status === 'stop' && <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>}
                          {v.status === 'parking' && <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>}
                          {v.status?.toUpperCase()}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => onViewVehicle(v.id, null, 'assigned-vehicle')}
                            className="px-3 py-1.5 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] text-white font-bold text-xs flex items-center gap-1.5 transition shadow-2xs cursor-pointer"
                            title="Open Live User View & Route Telemetry"
                          >
                            <MapPin className="w-3.5 h-3.5 text-emerald-200" />
                            <span>Map View</span>
                          </button>

                          {/* Dedicated Vehicle History Button (Visible for both Admin and User) */}
                          <button
                            type="button"
                            onClick={() => handleOpenHistoryModal(v)}
                            className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center gap-1.5 transition shadow-2xs cursor-pointer border border-slate-200"
                            title="View Trip History & Recorded Logs"
                          >
                            <History className="w-3.5 h-3.5 text-slate-600" />
                            <span>History</span>
                          </button>

                          {isAdmin && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditModal(v)}
                                className="p-1.5 rounded-lg text-slate-600 hover:text-blue-600 hover:bg-blue-50 transition"
                                title="Edit Vehicle"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>

                              {/* Plus Button (+) to Add 2nd, 3rd, 4th Trip with Route Planner */}
                              <button
                                type="button"
                                onClick={() => handleOpenAddTripModal(v)}
                                className="p-1.5 rounded-lg text-white bg-[#E60012] hover:bg-[#CC0010] shadow-2xs transition flex items-center justify-center cursor-pointer"
                                title="Add Trip (Trip 2, 3, 4...) with Route Planner details"
                              >
                                <Plus className="w-4 h-4 text-white" />
                              </button>

                              <button
                                type="button"
                                onClick={() => setDeletingVehicleId(v.id)}
                                className="p-1.5 rounded-lg text-slate-600 hover:text-red-600 hover:bg-red-50 transition"
                                title="Delete Vehicle"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Vehicle Modal */}
      {isAddModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setIsAddModalOpen(false)}
        >
          <div
            className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  {editingVehicle ? 'Edit Vehicle Information' : 'Register New Fleet Vehicle'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Enter registration number, axle type, chassis, and user allocation.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-700 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleFormSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Registration Number * <span className="text-[10px] text-slate-400 font-normal">(e.g. MH12RN4589, DL01AB1024, CG04A1234)</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.registration_no}
                  onChange={(e) => setFormData({ ...formData, registration_no: e.target.value.toUpperCase() })}
                  placeholder="MH12RN4589"
                  className="w-full px-3 py-2 rounded-xl border border-[#E2E8F0] text-slate-900 font-mono font-bold focus:outline-none focus:border-[#0F172A] uppercase"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Vehicle Name / Model *</label>
                  <input
                    type="text"
                    required
                    value={formData.name_model}
                    onChange={(e) => setFormData({ ...formData, name_model: e.target.value })}
                    placeholder="Tata Signa 4825.TK"
                    className="w-full px-3 py-2 rounded-xl border border-[#E2E8F0] text-slate-900 focus:outline-none focus:border-[#0F172A]"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Vehicle Type</label>
                  <select
                    value={formData.vehicle_type}
                    onChange={(e) => setFormData({ ...formData, vehicle_type: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#E2E8F0] text-slate-800 bg-white font-medium focus:outline-none focus:border-[#0F172A]"
                  >
                    <option value="Truck">Truck</option>
                    <option value="Heavy Truck">Heavy Truck</option>
                    <option value="Mini Truck">Mini Truck</option>
                    <option value="Pickup">Pickup</option>
                    <option value="Cargo">Cargo</option>
                    <option value="Trailer">Trailer</option>
                    <option value="Van">Van</option>
                    <option value="Car">Car</option>
                  </select>
                </div>
              </div>

              {/* Axle Type Selector (Moved here from Route Planner as requested) */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Axle Type (Commercial Classification) *
                </label>
                <select
                  value={formData.axle_type}
                  onChange={(e) => setFormData({ ...formData, axle_type: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-[#E2E8F0] text-slate-800 bg-white font-medium focus:outline-none focus:border-[#0F172A]"
                >
                  <option value="2-axle">2-Axle (LCV / Bus / Light Truck)</option>
                  <option value="3-axle">3-Axle Commercial Truck</option>
                  <option value="4-axle">4-Axle Heavy Commercial Vehicle</option>
                  <option value="5-axle">5-Axle Heavy Goods Vehicle</option>
                  <option value="6-axle">6-Axle Multi-Axle Truck</option>
                  <option value="7-axle+">7+ Axle Oversized Commercial</option>
                </select>
                <p className="text-[10px] text-slate-400 mt-1">
                  Axle classification is used to calculate exact NHAI FASTag toll rates across national highways.
                </p>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Assign to User
                </label>
                <select
                  value={formData.assigned_user_id}
                  onChange={(e) => setFormData({ ...formData, assigned_user_id: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-[#E2E8F0] text-slate-800 bg-white font-medium focus:outline-none focus:border-[#0F172A]"
                >
                  <option value="">-- No User Assigned (Unallocated) --</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.email})
                    </option>
                  ))}
                </select>
              </div>

              {/* Only Chassis Number (VIN removed) & IMEI Number */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Chassis Number</label>
                  <input
                    type="text"
                    value={formData.chassis_number}
                    onChange={(e) => setFormData({ ...formData, chassis_number: e.target.value.toUpperCase() })}
                    placeholder="MAT612034N3P12891"
                    className="w-full px-3 py-2 rounded-xl border border-[#E2E8F0] text-slate-900 font-mono uppercase focus:outline-none focus:border-[#0F172A]"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">IMEI Number</label>
                  <input
                    type="text"
                    value={formData.imei_number}
                    onChange={(e) => setFormData({ ...formData, imei_number: e.target.value })}
                    placeholder="864209041234567"
                    className="w-full px-3 py-2 rounded-xl border border-[#E2E8F0] text-slate-900 font-mono focus:outline-none focus:border-[#0F172A]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Fuel Type</label>
                  <select
                    value={formData.fuel_type}
                    onChange={(e) => setFormData({ ...formData, fuel_type: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#E2E8F0] text-slate-800 bg-white font-medium focus:outline-none focus:border-[#0F172A]"
                  >
                    <option value="Diesel">Diesel</option>
                    <option value="Petrol">Petrol</option>
                    <option value="CNG">CNG</option>
                    <option value="Electric">Electric</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Operational Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#E2E8F0] text-slate-800 bg-white font-medium focus:outline-none focus:border-[#0F172A]"
                  >
                    <option value="moving">Moving</option>
                    <option value="stop">Stop</option>
                    <option value="parking">Parking</option>
                    <option value="active">Active (Online)</option>
                    <option value="inactive">Inactive / Standby</option>
                  </select>
                </div>
              </div>

              <div className="pt-4 border-t border-[#E2E8F0] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-[#E2E8F0] text-slate-600 font-bold hover:bg-[#F8FAFC] transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-5 py-2 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] text-white font-bold transition shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {formSubmitting ? 'Saving...' : editingVehicle ? 'Update Vehicle' : 'Register Vehicle'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingVehicleId !== null && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setDeletingVehicleId(null)}
        >
          <div
            className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-sm w-full p-6 text-center cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-base font-extrabold text-slate-900">Delete Fleet Vehicle?</h3>
            <p className="text-xs text-slate-500 mt-2">
              This action cannot be undone. All active routes, telematics, and allocations for this vehicle will be removed.
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setDeletingVehicleId(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDeleteVehicle(deletingVehicleId)}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition shadow-xs"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vehicle Trips & Multi-Route Allocation Modal (+) with Right-Side Interactive Map */}
      {tripModalVehicle && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-5 cursor-pointer"
          onClick={() => setTripModalVehicle(null)}
        >
          <div
            className="bg-white rounded-3xl max-w-6xl w-full p-4 sm:p-6 shadow-2xl border border-slate-200 relative animate-in fade-in zoom-in-95 duration-200 max-h-[92vh] flex flex-col cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3.5 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#E60012] text-white flex items-center justify-center font-bold shadow-xs shrink-0">
                  <Navigation className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-mono font-black text-slate-900 text-base">
                      {tripModalVehicle.registration_no}
                    </h3>
                    <span className="text-[10px] font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                      {tripModalVehicle.vehicle_type}
                    </span>
                    <span className="text-[10px] font-mono font-bold text-slate-500 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-200">
                      {vehicleTrips.length} Total Trips Recorded
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">
                    Record New Vehicle Trip • Auto-detect from GPS Excel or select saved route with Live Map
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setTripModalVehicle(null)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Body: 2-Column Responsive Layout (Left: Form Controls, Right: Embedded Interactive Map) */}
            <div className="flex-1 overflow-y-auto py-3">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">

                {/* Left Column: Form Controls (lg:col-span-5) */}
                <div className="lg:col-span-5 space-y-3.5">
                  <form onSubmit={handleSaveVehicleTrip} className="space-y-3.5 text-xs">

                    {/* Compact Excel Import Button + Saved Corridor Dropdown Row */}
                    <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col gap-2">
                      <label className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-[#E60012] font-bold text-xs cursor-pointer shadow-2xs transition">
                        <FileSpreadsheet className="w-4 h-4 text-[#E60012]" />
                        <span>Import GPS Excel (.xlsx, .csv)</span>
                        <input
                          type="file"
                          accept=".xlsx, .xls, .csv"
                          onChange={handleTripExcelUpload}
                          className="hidden"
                        />
                      </label>

                      <div className="flex items-center gap-2 text-slate-400 text-[10px] font-black uppercase tracking-wider justify-center">
                        <span>OR SELECT PREVIOUS CORRIDOR</span>
                      </div>

                      <select
                        value={selectedCorridorForTripId}
                        onChange={(e) => handleSelectSavedCorridorForTrip(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-semibold text-xs focus:outline-none focus:border-red-500 text-slate-700 truncate cursor-pointer shadow-2xs"
                      >
                        <option value="">-- Choose Completed Trip or Saved Route --</option>
                        {unifiedCorridorsList.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Excel Summary Telemetry Badge if Parsed */}
                    {tripExcelSummary && (
                      <div className="p-3 rounded-xl bg-slate-900 text-white space-y-1.5 text-xs shadow-sm">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                          <span className="text-[10px] font-mono font-bold uppercase text-red-400">
                            Excel Telemetry Detected
                          </span>
                          {tripExcelSummary.vehicleReg && (
                            <span className="font-mono font-black text-xs text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-800">
                              {tripExcelSummary.vehicleReg}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] pt-1">
                          <div>
                            <span className="text-slate-400 block text-[9px] uppercase font-bold">Distance</span>
                            <span className="font-mono font-black text-white">{tripExcelSummary.distanceKm} KM</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[9px] uppercase font-bold">Avg Speed</span>
                            <span className="font-mono font-black text-white">{tripExcelSummary.avgSpeed} km/h</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[9px] uppercase font-bold">Running</span>
                            <span className="font-mono text-slate-200">{tripExcelSummary.runningTime || 'N/A'}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[9px] uppercase font-bold">Waypoints</span>
                            <span className="font-mono font-black text-emerald-400">{tripExcelPoints.length} Pts</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Trip Details Form Fields (Start Location & End Location removed!) */}
                    <div className="space-y-3">
                      <div>
                        <label className="block text-slate-600 font-bold mb-1">
                          Trip / Route Name *
                        </label>
                        <input
                          type="text"
                          value={tripForm.route_name}
                          onChange={(e) => setTripForm({ ...tripForm, route_name: e.target.value })}
                          placeholder="e.g. Trip #2: Tatibandh to Bilaspur Bypass"
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 font-medium text-xs focus:outline-none focus:border-red-500"
                          required
                        />
                      </div>

                      {/* Trip Date */}
                      {/* Trip Date (Strict DD/MM/YYYY Format) */}
                      <div>
                        <label className="block text-slate-600 font-bold mb-1">
                          Trip Date
                        </label>
                        <DMYDateInput
                          value={tripForm.trip_date}
                          onChange={(iso) => setTripForm({ ...tripForm, trip_date: iso })}
                          className="w-full justify-between px-3 py-2 rounded-xl border border-slate-200 bg-white font-medium text-xs focus-within:border-red-500 shadow-2xs"
                        />
                      </div>

                      {/* Start Time & End Time in 2-Column Grid (Zero Overflow for AM/PM buttons) */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <AmPmTimeInput
                          label="Start Time"
                          value={tripForm.start_trip_time}
                          onChange={(val) => setTripForm({ ...tripForm, start_trip_time: val })}
                        />
                        <AmPmTimeInput
                          label="End Time"
                          value={tripForm.end_trip_time}
                          onChange={(val) => setTripForm({ ...tripForm, end_trip_time: val })}
                        />
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        <div>
                          <label className="block text-slate-600 font-bold mb-1">
                            Distance (KM) *
                          </label>
                          <input
                            type="number"
                            step="0.1"
                            value={tripForm.total_distance_km}
                            onChange={(e) => setTripForm({ ...tripForm, total_distance_km: e.target.value })}
                            placeholder="e.g. 145"
                            className="w-full px-3 py-2 rounded-xl border border-slate-200 font-medium text-xs focus:outline-none focus:border-red-500"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-slate-600 font-bold mb-1">
                            Total Toll (₹)
                          </label>
                          <input
                            type="number"
                            value={tripForm.total_toll_fee}
                            onChange={(e) => setTripForm({ ...tripForm, total_toll_fee: e.target.value })}
                            placeholder="e.g. 340"
                            className="w-full px-3 py-2 rounded-xl border border-slate-200 font-medium text-xs focus:outline-none focus:border-red-500"
                          />
                        </div>
                        <div>
                          <label className="block text-slate-600 font-bold mb-1">
                            No. of Tolls
                          </label>
                          <input
                            type="number"
                            min="0"
                            value={tripForm.toll_gates_count}
                            onChange={(e) => setTripForm({ ...tripForm, toll_gates_count: e.target.value })}
                            placeholder="e.g. 2"
                            className="w-full px-3 py-2 rounded-xl border border-slate-200 font-medium text-xs focus:outline-none focus:border-red-500"
                          />
                        </div>
                        <div>
                          <label className="block text-slate-600 font-bold mb-1">
                            Stoppages
                          </label>
                          <input
                            type="number"
                            min="0"
                            value={tripForm.stoppages_count}
                            onChange={(e) => setTripForm({ ...tripForm, stoppages_count: e.target.value })}
                            placeholder="e.g. 2"
                            className="w-full px-3 py-2 rounded-xl border border-slate-200 font-medium text-xs focus:outline-none focus:border-red-500"
                          />
                        </div>
                      </div>

                      {/* Configured Route Stoppages & Toll Plazas Preview Cards */}
                      {(modalStoppages.length > 0 || modalTolls.length > 0) && (
                        <div className="space-y-2 pt-1">
                          {modalStoppages.length > 0 && (
                            <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-700">
                                  Route Stoppages
                                </span>
                                <span className="text-[9px] font-bold px-2 py-0.5 bg-white text-slate-600 rounded-full border border-slate-200 shadow-2xs">
                                  {modalStoppages.length} Halts
                                </span>
                              </div>
                              <div className="space-y-1 max-h-32 overflow-y-auto pr-0.5">
                                {modalStoppages.map((s, idx) => (
                                  <div key={idx} className="p-1.5 bg-white rounded-lg border border-slate-100 flex items-center justify-between text-[11px] shadow-2xs">
                                    <div className="flex items-center gap-1.5 truncate">
                                      <span className="w-4 h-4 rounded-full bg-slate-900 text-white font-black text-[9px] flex items-center justify-center shrink-0">
                                        {idx + 1}
                                      </span>
                                      <span className="font-bold text-slate-800 truncate">{s.name}</span>
                                    </div>
                                    <span className="text-[10px] font-bold text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100 shrink-0">
                                      {s.stop_duration_mins || 20}m Halt
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {modalTolls.length > 0 && (
                            <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-700">
                                  Toll Plazas & Charges
                                </span>
                                <span className="text-[9px] font-bold px-2 py-0.5 bg-white text-slate-600 rounded-full border border-slate-200 shadow-2xs">
                                  {modalTolls.length} Plazas
                                </span>
                              </div>
                              <div className="space-y-1 max-h-32 overflow-y-auto pr-0.5">
                                {modalTolls.map((t, idx) => (
                                  <div key={idx} className="p-1.5 bg-white rounded-lg border border-slate-100 flex items-center justify-between text-[11px] shadow-2xs">
                                    <span className="font-bold text-slate-800 truncate">{t.name}</span>
                                    <span className="text-[11px] font-black text-slate-900 font-mono bg-slate-50 px-2 py-0.5 rounded border border-slate-100 shrink-0">
                                      ₹{t.charges}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => setTripModalVehicle(null)}
                        className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={savingTrip}
                        className="px-5 py-2 rounded-xl bg-[#E60012] hover:bg-[#CC0010] text-white font-bold transition shadow-xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
                      >
                        {savingTrip ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Saving Trip...</span>
                          </>
                        ) : (
                          <span>Save & Add Trip #{vehicleTrips.length + 1}</span>
                        )}
                      </button>
                    </div>
                  </form>
                </div>

                {/* Right Column: Embedded Interactive Map with Live Route & Dragging (lg:col-span-7) */}
                <div className="lg:col-span-7 flex flex-col h-full bg-slate-50/70 rounded-2xl border border-slate-200 overflow-hidden relative min-h-[460px] lg:min-h-[540px]">
                  {/* Top Route Preview Bar */}
                  <div className="p-3 bg-white border-b border-slate-200/80 flex items-center justify-between gap-2 z-10 shrink-0">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="font-bold text-xs text-slate-800">Route Map Preview</span>
                      <span className="text-[10px] text-slate-400 hidden sm:inline">• Draggable Polyline</span>
                    </div>

                    {previewPolyline.length >= 2 && (
                      <div className="flex items-center gap-1.5 text-[10px] font-mono">
                        <span className="bg-red-50 text-[#E60012] font-black px-2 py-0.5 rounded-md border border-red-200">
                          {tripForm.total_distance_km || 0} KM
                        </span>
                        <span className="bg-slate-100 text-slate-700 font-bold px-2 py-0.5 rounded-md">
                          {modalTolls.length} Tolls
                        </span>
                        <span className="bg-orange-50 text-orange-700 font-bold px-2 py-0.5 rounded-md">
                          {modalStoppages.length} Stops
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Map Canvas - Installed Map exactly like Route Planning */}
                  <div className="relative rounded-2xl overflow-hidden min-h-[520px] w-full bg-slate-100 flex-1">
                    <InteractiveMap
                      height="540px"
                      center={modalStartPoint ? [modalStartPoint.lat, modalStartPoint.lng] : [21.8974, 82.8000]}
                      zoom={modalStartPoint ? 9 : 7}
                      routes={previewRoutes}
                      selectedRouteId="preview-trip-route"
                      startPoint={modalStartPoint}
                      endPoint={modalEndPoint}
                      stoppages={modalStoppages}
                      tollGates={modalTolls}
                      isDraggableRoute={false}
                      hideEditTools={true}
                      onRouteChange={handleModalRouteDrag}
                    />

                    {previewPolyline.length < 2 && (
                      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-white/95 backdrop-blur-xs px-3.5 py-1.5 rounded-xl shadow-md border border-slate-200 text-xs font-bold text-slate-700 flex items-center gap-2 pointer-events-none">
                        <MapPin className="w-3.5 h-3.5 text-[#E60012] animate-bounce" />
                        <span>Select a saved route or upload Excel on the left to draw corridor</span>
                      </div>
                    )}
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dedicated Vehicle Trip History Modal (Admin & Regular User) */}
      {historyModalVehicle && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-5 cursor-pointer"
          onClick={() => setHistoryModalVehicle(null)}
        >
          <div
            className="bg-white rounded-3xl max-w-3xl w-full p-5 sm:p-6 shadow-2xl border border-slate-200 relative animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold shadow-xs">
                  <History className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-mono font-black text-slate-900 text-base">
                      {historyModalVehicle.registration_no}
                    </h3>
                    <span className="text-[10px] font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                      {historyModalVehicle.vehicle_type}
                    </span>
                    <span className="text-[10px] font-bold text-red-700 bg-red-50 px-2.5 py-0.5 rounded-full border border-red-200 font-mono">
                      {vehicleHistoryTrips.length} Total Trips Recorded
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">
                    Vehicle Journey Logs • View route history, distance, tolls and activate trip
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setHistoryModalVehicle(null)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto py-4 space-y-3">
              {loadingHistory ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2">
                  <RefreshCw className="w-6 h-6 text-slate-400 animate-spin" />
                  <p className="text-xs text-slate-500 font-medium">Loading vehicle trip records...</p>
                </div>
              ) : vehicleHistoryTrips.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-center">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mb-2 text-slate-400">
                    <History className="w-6 h-6" />
                  </div>
                  <h4 className="font-bold text-slate-800 text-sm">No Recorded Trips Yet</h4>
                  <p className="text-xs text-slate-500 max-w-sm mt-1">
                    This vehicle does not have any recorded trips yet. Use the Add Trip (+) button to record a new route.
                  </p>
                </div>
              ) : (
                Object.entries(historyTripsByDate).map(([dateStr, dateTrips]: [string, any[]]) => (
                  <div key={dateStr} className="space-y-2 mb-4">
                    {/* Date Header Badge */}
                    <div className="flex items-center gap-2 pt-1 pb-1">
                      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-slate-800 text-[11px] font-extrabold border border-slate-200 shadow-2xs">
                        <Calendar className="w-3.5 h-3.5 text-[#E60012]" />
                        <span>{dateStr}</span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-500 font-bold bg-slate-50 px-2 py-0.5 rounded-md border border-slate-200">
                        {dateTrips.length} {dateTrips.length === 1 ? 'Trip' : 'Trips'} Recorded
                      </span>
                      <div className="h-px bg-slate-100 flex-1" />
                    </div>

                    {/* Compact Trip Cards for this Date */}
                    {dateTrips.map((trip: any, idx: number) => {
                      const isActive = trip.is_active === 1 || trip.is_active === true;
                      const opStatus = trip.operational_status || (isActive ? (historyModalVehicle?.status || 'moving') : 'stop');
                      return (
                        <div
                          key={trip.id || idx}
                          className={`p-3 rounded-2xl border transition-all ${isActive
                              ? 'bg-emerald-50/40 border-emerald-300 shadow-2xs'
                              : 'bg-white border-slate-200/90 hover:border-slate-300'
                            }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-bold text-xs text-slate-900">
                                {trip.route_name || `Trip #${trip.id}`}
                              </span>
                              {isActive ? (
                                <span className="inline-flex items-center gap-1 text-[9px] font-black bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-300">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                                  Active Trip
                                </span>
                              ) : (
                                <span className="text-[9px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full border border-slate-200">
                                  Completed
                                </span>
                              )}

                              {/* Operational Status Selector directly on Trip Card (Admin Only) */}
                              {isAdmin ? (
                                <div className="flex items-center gap-1 bg-slate-50 px-2 py-0.5 rounded-lg border border-slate-200">
                                  <span className="text-[9px] font-bold text-slate-400 uppercase">Status:</span>
                                  <select
                                    value={opStatus}
                                    disabled={updatingTripStatusId === trip.id}
                                    onChange={(e) => handleUpdateTripOperationalStatus(trip.id, e.target.value)}
                                    className={`text-[10px] font-bold bg-transparent cursor-pointer focus:outline-none ${
                                      opStatus === 'moving'
                                        ? 'text-emerald-700 font-black'
                                        : opStatus === 'stop'
                                        ? 'text-rose-700 font-black'
                                        : opStatus === 'parking'
                                        ? 'text-amber-700 font-black'
                                        : 'text-slate-700'
                                    }`}
                                  >
                                    <option value="moving">Moving</option>
                                    <option value="stop">Stop</option>
                                    <option value="parking">Parking</option>
                                  </select>
                                </div>
                              ) : (
                                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-md border ${
                                  opStatus === 'moving'
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : opStatus === 'stop'
                                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                                    : 'bg-amber-50 text-amber-700 border-amber-200'
                                }`}>
                                  {opStatus}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5">
                              {/* Set as Active */}
                              {!isActive && (
                                <button
                                  type="button"
                                  onClick={() => handleActivateHistoricalTrip(trip.id)}
                                  className="px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] transition cursor-pointer border border-slate-200"
                                >
                                  Set Active
                                </button>
                              )}

                              {/* View on Map */}
                              <button
                                type="button"
                                onClick={() => handleViewHistoricalTripOnMap(trip)}
                                className="px-3 py-1 rounded-xl bg-[#E60012] hover:bg-[#CC0010] text-white font-extrabold text-[11px] flex items-center gap-1.5 transition shadow-2xs cursor-pointer"
                                title="Inspect this trip on Live User View"
                              >
                                <MapPin className="w-3 h-3" />
                                <span>View Map</span>
                              </button>
                            </div>
                          </div>

                          {/* Corridor leg & inline compact metrics */}
                          <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                            <p className="text-[11px] text-slate-600 truncate">
                              <span className="font-bold text-slate-800">
                                {trip.start_location_name || 'Origin'} → {trip.end_location_name || 'Destination'}
                              </span>
                              <span className="text-slate-300 mx-1.5">•</span>
                              <span className="font-mono text-slate-500">
                                {trip.trip_date || dateStr} ({trip.start_trip_time || '08:00 AM'} - {trip.end_trip_time || '06:00 PM'})
                              </span>
                            </p>

                            <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold text-slate-600 shrink-0">
                              <span className="bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100">
                                {trip.total_distance_km || 0} KM
                              </span>
                              <span className="bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100">
                                ~{Math.floor((trip.estimated_travel_time_min || 180) / 60)}h {(trip.estimated_travel_time_min || 180) % 60}m
                              </span>
                              <span className="bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100">
                                {trip.total_tolls_amount ? `₹${trip.total_tolls_amount}` : 'Toll Incl.'}
                              </span>
                              <span className="bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100">
                                {(() => {
                                  if (trip.stoppages_count && Number(trip.stoppages_count) > 0) return trip.stoppages_count;
                                  if (trip.waypoints_json) {
                                    try {
                                      const wp = typeof trip.waypoints_json === 'string' ? JSON.parse(trip.waypoints_json) : trip.waypoints_json;
                                      if (Array.isArray(wp) && wp.length > 0) return wp.length;
                                    } catch (_) {}
                                  }
                                  return 0;
                                })()} Stops
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
