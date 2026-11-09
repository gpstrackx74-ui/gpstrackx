import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { DashboardStats, Vehicle, AlternativeRoute } from '../types';
import { InteractiveMap } from '../components/InteractiveMap';
import { ErrorBoundary } from '../components/ErrorBoundary';
import {
  Truck,
  Activity,
  CheckCircle,
  XCircle,
  Search,
  MapPin,
  Compass,
  History,
  Calendar,
  X,
  RefreshCw
} from 'lucide-react';

interface DashboardProps {
  onNavigateTab: (tab: string) => void;
  onViewVehicle: (vehicleId: number) => void;
  initialUserTab?: 'vehicle' | 'history';
}

export const Dashboard: React.FC<DashboardProps> = ({
  onNavigateTab,
  onViewVehicle,
  initialUserTab = 'vehicle'
}) => {
  const { isAdmin } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [userActiveTab, setUserActiveTab] = useState<'vehicle' | 'history'>(initialUserTab);

  useEffect(() => {
    if (initialUserTab) {
      setUserActiveTab(initialUserTab);
    }
  }, [initialUserTab]);

  // Vehicle Trip History States (Date-Wise)
  const [historyModalVehicle, setHistoryModalVehicle] = useState<Vehicle | null>(null);
  const [vehicleHistoryTrips, setVehicleHistoryTrips] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);
  const [userVehicleTrips, setUserVehicleTrips] = useState<any[]>([]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [statsData, vehList] = await Promise.all([
        api.getStats(),
        api.getVehicles()
      ]);
      setStats(statsData.stats);
      const uniqueVehList = Array.from(new Map((vehList || []).map((v: Vehicle) => [v.id, v])).values());
      setVehicles(uniqueVehList);

      // If user has allocated vehicles, fetch trips for date-wise history showcase
      if (!isAdmin && vehList && vehList.length > 0) {
        api.getVehicleTrips(vehList[0].id)
          .then(trips => setUserVehicleTrips(trips || []))
          .catch(() => { });
      }
    } catch (err) {
      console.error('Failed to load fleet dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [isAdmin]);

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

  const handleActivateHistoricalTrip = async (routeId: number) => {
    try {
      await api.activateVehicleTrip(routeId);
      if (historyModalVehicle) {
        const updated = await api.getVehicleTrips(historyModalVehicle.id);
        setVehicleHistoryTrips(updated || []);
      }
      fetchData();
    } catch (err: any) {
      alert('Failed to activate trip: ' + err.message);
    }
  };

  const handleViewHistoricalTripOnMap = async (trip: any, targetVehicleId: number) => {
    try {
      if (!trip.is_active) {
        await api.activateVehicleTrip(trip.id);
      }
      setHistoryModalVehicle(null);
      onViewVehicle(targetVehicleId);
    } catch (err: any) {
      setHistoryModalVehicle(null);
      onViewVehicle(targetVehicleId);
    }
  };

  // Group trips date-wise for user dashboard view
  const userTripsByDate = useMemo(() => {
    const groups: { [date: string]: any[] } = {};
    userVehicleTrips.forEach(t => {
      const rawDate = t.trip_date || (t.created_at ? t.created_at.split('T')[0] : 'Today');
      if (!groups[rawDate]) groups[rawDate] = [];
      groups[rawDate].push(t);
    });
    return groups;
  }, [userVehicleTrips]);

  // Group modal trips date-wise
  const modalTripsByDate = useMemo(() => {
    const groups: { [date: string]: any[] } = {};
    vehicleHistoryTrips.forEach(t => {
      const rawDate = t.trip_date || (t.created_at ? t.created_at.split('T')[0] : 'Today');
      if (!groups[rawDate]) groups[rawDate] = [];
      groups[rawDate].push(t);
    });
    return groups;
  }, [vehicleHistoryTrips]);

  const total = stats?.totalVehicles ?? vehicles.length;
  const moving = stats?.movingVehicles ?? vehicles.filter(v => v.status === 'moving').length;
  const active = stats?.activeVehicles ?? vehicles.filter(v => v.status === 'active').length;
  const inactive = stats?.inactiveVehicles ?? vehicles.filter(v => v.status === 'inactive').length;

  const filteredVehicles = vehicles.filter(v => {
    const matchesSearch = searchTerm === '' ||
      v.registration_no.toLowerCase().includes(searchTerm.toLowerCase()) ||
      v.name_model.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (v.owner_name && v.owner_name.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesStatus = statusFilter === 'all' || v.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Memoize routes for dashboard live map preview
  const dashboardRoutes: AlternativeRoute[] = useMemo(() => {
    return vehicles
      .filter(v => (v as any).overview_polyline)
      .map(v => {
        let coords: [number, number][] = [];
        const raw = (v as any).overview_polyline;
        try {
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (Array.isArray(parsed)) {
            coords = parsed.map((p: any): [number, number] => Array.isArray(p) ? [Number(p[0]), Number(p[1])] : [Number(p.lat), Number(p.lng)])
              .filter((c: [number, number]): boolean => !isNaN(c[0]) && !isNaN(c[1]));
          }
        } catch (e) {
          coords = [];
        }
        if (coords.length < 2 && (v as any).start_lat && (v as any).end_lat) {
          coords = [
            [Number((v as any).start_lat), Number((v as any).start_lng)],
            [Number((v as any).end_lat), Number((v as any).end_lng)]
          ];
        }
        return {
          id: `route-${v.id}`,
          name: (v.route_name || `${v.registration_no} Corridor`).replace(/\r?\n/g, ' '),
          distanceKm: Number((v as any).total_distance_km || 0),
          timeMinutes: Number((v as any).estimated_travel_time_min || 0),
          tollGatesCount: 0,
          stopsCount: 0,
          summary: v.route_name || 'Active Highway Corridor',
          color: (v as any).route_color || '#E60012',
          coordinates: coords
        };
      })
      .filter(r => r.coordinates.length >= 2);
  }, [vehicles]);

  const [animIndex, setAnimIndex] = useState(0);

  // Animate moving vehicles smoothly along route coordinates
  useEffect(() => {
    const hasMoving = vehicles.some(v => v.status === 'moving');
    if (!hasMoving) return;

    const interval = setInterval(() => {
      setAnimIndex(prev => prev + 1);
    }, 1500);

    return () => clearInterval(interval);
  }, [vehicles]);

  const userVehiclePosition = useMemo(() => {
    if (vehicles.length === 0) return null;
    const v = vehicles[0];
    const coords = dashboardRoutes[0]?.coordinates || [];

    if (coords.length > 0) {
      if (v.status === 'moving') {
        const pt = coords[animIndex % coords.length];
        return {
          lat: pt[0],
          lng: pt[1],
          speed: v.current_speed && v.current_speed > 0 ? v.current_speed : 48,
          status: 'moving',
          plate: v.registration_no
        };
      } else {
        // Vehicle is NOT moving: position truck at the END POINT of the route
        const endPt = coords[coords.length - 1];
        return {
          lat: endPt[0],
          lng: endPt[1],
          speed: 0,
          status: v.status || 'stopped',
          plate: v.registration_no
        };
      }
    }

    if (!v.current_lat || !v.current_lng) return null;
    return {
      lat: Number(v.current_lat),
      lng: Number(v.current_lng),
      speed: v.current_speed || 0,
      status: v.status || 'active',
      plate: v.registration_no
    };
  }, [vehicles, dashboardRoutes, animIndex]);

  const userStartPoint = useMemo(() => {
    if (vehicles.length === 0 || !(vehicles[0] as any).start_lat) return null;
    return {
      lat: Number((vehicles[0] as any).start_lat),
      lng: Number((vehicles[0] as any).start_lng),
      name: ((vehicles[0] as any).start_location_name || 'Start Point').replace(/\r?\n/g, ' ')
    };
  }, [vehicles]);

  const userEndPoint = useMemo(() => {
    if (vehicles.length === 0 || !(vehicles[0] as any).end_lat) return null;
    return {
      lat: Number((vehicles[0] as any).end_lat),
      lng: Number((vehicles[0] as any).end_lng),
      name: ((vehicles[0] as any).end_location_name || 'Destination').replace(/\r?\n/g, ' ')
    };
  }, [vehicles]);

  const mapCenter: [number, number] = useMemo(() => {
    if (vehicles.length > 0 && vehicles[0].current_lat && Number(vehicles[0].current_lat) !== 0) {
      return [Number(vehicles[0].current_lat), Number(vehicles[0].current_lng)];
    }
    if (dashboardRoutes.length > 0 && dashboardRoutes[0].coordinates.length > 0) {
      return dashboardRoutes[0].coordinates[0];
    }
    return [21.8974, 82.8000];
  }, [vehicles, dashboardRoutes]);

  return (
    <div className="p-4 sm:p-6 lg:p-7 max-w-7xl mx-auto space-y-5 sm:space-y-6">
      {/* ONE LARGE UNIFIED MAIN CONTAINER (ALL-IN-ONE ENTERPRISE LAYOUT) */}
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-xs overflow-hidden">
        {/* Section 1: Fleet Operational Overview (4 Metrics inside unified container) */}
        <div className="p-5 sm:p-6 grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {/* Total Fleet */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50/70 border border-slate-100">
            <div>
              <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Fleet</span>
              <div className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight mt-0.5 font-mono">{total}</div>
              <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5 font-medium">Registered units</p>
            </div>
            <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
              <Truck className="w-4 h-4" />
            </div>
          </div>

          {/* In Transit */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50/70 border border-slate-100">
            <div>
              <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-400">In Transit</span>
              <div className="text-xl sm:text-2xl font-black text-emerald-600 tracking-tight mt-0.5 font-mono">{moving}</div>
              <p className="text-[10px] sm:text-[11px] text-emerald-600/80 mt-0.5 font-medium">Moving on active routes</p>
            </div>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <Activity className="w-4 h-4" />
            </div>
          </div>

          {/* Ready / Available */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50/70 border border-slate-100">
            <div>
              <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-400">Available / Idle</span>
              <div className="text-xl sm:text-2xl font-black text-blue-600 tracking-tight mt-0.5 font-mono">{active}</div>
              <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5 font-medium">Ready for allocation</p>
            </div>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <CheckCircle className="w-4 h-4" />
            </div>
          </div>

          {/* Under Maintenance */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50/70 border border-slate-100">
            <div>
              <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-400">Under Service</span>
              <div className="text-xl sm:text-2xl font-black text-slate-700 tracking-tight mt-0.5 font-mono">{inactive}</div>
              <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5 font-medium">Standby / Maintenance</p>
            </div>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <XCircle className="w-4 h-4" />
            </div>
          </div>
        </div>

        {/* Thin divider with light red 10% opacity */}
        <div className="border-t border-[#E60012]/10" />

        {/* User Dashboard Tab Switcher: [ Assigned Vehicle ] and [ Trip History ] */}
        {!isAdmin && (
          <div className="px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-white">
            <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-2xl border border-slate-200/80">
              <button
                type="button"
                onClick={() => setUserActiveTab('vehicle')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer ${userActiveTab === 'vehicle'
                    ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                    : 'text-slate-500 hover:text-slate-800'
                  }`}
              >
                <Truck className={`w-3.5 h-3.5 ${userActiveTab === 'vehicle' ? 'text-[#E60012]' : 'text-slate-400'}`} />
                <span>Assigned Vehicle</span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-600 font-bold">
                  {vehicles.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setUserActiveTab('history')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer ${userActiveTab === 'history'
                    ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                    : 'text-slate-500 hover:text-slate-800'
                  }`}
              >
                <History className={`w-3.5 h-3.5 ${userActiveTab === 'history' ? 'text-[#E60012]' : 'text-slate-400'}`} />
                <span>Trip History</span>
                {userVehicleTrips.length > 0 && (
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-[#E60012] text-white font-bold">
                    {userVehicleTrips.length}
                  </span>
                )}
              </button>
            </div>

            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-semibold text-slate-600">
                {userActiveTab === 'vehicle' ? 'Live Telemetry Active' : 'Date-Wise Recorded Journeys'}
              </span>
            </div>
          </div>
        )}

        {/* Section 2: Fleet Vehicles Section (Visible for Admin OR when user is on 'vehicle' tab) */}
        {(isAdmin || userActiveTab === 'vehicle') && (
          <>
            {/* Section Controls Bar */}
            <div className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50/40">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-extrabold text-slate-900 tracking-tight">
                  {isAdmin ? 'Vehicle Fleet & Allocations' : 'My Assigned Vehicle'}
                </h2>
                <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full font-bold">
                  {filteredVehicles.length} Units
                </span>
              </div>

              {/* Search & Status Filters */}
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative flex items-center min-w-[200px]">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 pointer-events-none" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search vehicle or user..."
                    className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-slate-400"
                  />
                </div>

                <div className="flex items-center gap-1 bg-slate-50 p-0.5 rounded-xl border border-slate-200 text-xs">
                  <button
                    type="button"
                    onClick={() => setStatusFilter('all')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition text-[11px] ${statusFilter === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                      }`}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter('moving')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition text-[11px] ${statusFilter === 'moving' ? 'bg-[#E60012] text-white shadow-xs' : 'text-slate-500 hover:text-slate-900'
                      }`}
                  >
                    Moving
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter('active')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition text-[11px] ${statusFilter === 'active' ? 'bg-[#E60012] text-white shadow-xs' : 'text-slate-500 hover:text-slate-900'
                      }`}
                  >
                    Idle
                  </button>
                </div>
              </div>
            </div>

            {/* Thin divider with light red 10% opacity */}
            <div className="border-t border-[#E60012]/10" />

            {/* Vehicles Table / Cards */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50/70 border-b border-slate-200/80 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">Vehicle</th>
                    <th className="py-3 px-4">Allotted User</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Speed</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Assigned Route</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredVehicles.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400 text-xs">
                        No vehicles found matching "{searchTerm}".
                      </td>
                    </tr>
                  ) : (
                    filteredVehicles.map((v) => {
                      const isMoving = v.status === 'moving';
                      return (
                        <tr key={v.id} className="hover:bg-slate-50/70 transition">
                          {/* Vehicle Number & Model */}
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-xs shrink-0">
                                <Truck className="w-4 h-4 text-slate-600" />
                              </div>
                              <div>
                                <p className="font-extrabold text-slate-900 font-mono text-xs">{v.registration_no}</p>
                                <p className="text-[11px] text-slate-400">{v.name_model}</p>
                              </div>
                            </div>
                          </td>

                          {/* Driver / User */}
                          <td className="py-3.5 px-4">
                            <p className="font-bold text-slate-800 text-xs">{v.owner_name || 'Unassigned'}</p>
                            <p className="text-[10px] text-slate-400 font-mono">{v.device_id}</p>
                          </td>

                          {/* Type */}
                          <td className="py-3.5 px-4 font-medium text-slate-600 text-xs">
                            {v.vehicle_type}
                          </td>

                          {/* Speed */}
                          <td className="py-3.5 px-4 font-mono font-bold text-xs">
                            {isMoving ? (
                              <span className="text-emerald-600">{v.current_speed} KM/H</span>
                            ) : (
                              <span className="text-slate-400">0 KM/H</span>
                            )}
                          </td>

                          {/* Status Pill (Ref: Image 2) */}
                          <td className="py-3.5 px-4">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${isMoving
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : v.status === 'active'
                                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                  : 'bg-slate-100 text-slate-600 border border-slate-200'
                              }`}>
                              {isMoving && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                              {isMoving ? 'On Tracking' : v.status === 'active' ? 'Ready' : 'Under Service'}
                            </span>
                          </td>

                          {/* Assigned Route */}
                          <td className="py-3.5 px-4">
                            {v.route_name ? (
                              <button
                                type="button"
                                onClick={() => onViewVehicle(v.id)}
                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 font-bold text-[11px] border border-red-200 transition cursor-pointer max-w-[210px] text-left"
                                title="Click to view live route on map"
                              >
                                <MapPin className="w-3.5 h-3.5 text-red-600 shrink-0" />
                                <span className="truncate">{v.route_name}</span>
                              </button>
                            ) : (
                              <span className="text-[11px] text-slate-400 italic">No route assigned</span>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => onViewVehicle(v.id)}
                                className="px-2.5 py-1.5 rounded-xl bg-[#E60012] hover:bg-[#CC0010] text-white font-bold text-xs transition border border-transparent flex items-center gap-1.5 cursor-pointer shadow-2xs"
                                title="View Live Map & Route Details"
                              >
                                <MapPin className="w-3.5 h-3.5 text-red-200" />
                                <span>Map View</span>
                              </button>

                              {/* Date-wise History Button (Admin & User) */}
                              <button
                                type="button"
                                onClick={() => {
                                  if (!isAdmin) {
                                    setUserActiveTab('history');
                                  } else {
                                    handleOpenHistoryModal(v);
                                  }
                                }}
                                className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center gap-1.5 transition shadow-2xs cursor-pointer border border-slate-200"
                                title="View Date-wise Trip History & Recorded Logs"
                              >
                                <History className="w-3.5 h-3.5 text-slate-600" />
                                <span>History</span>
                              </button>

                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => onNavigateTab('routes')}
                                  className="px-2.5 py-1.5 rounded-xl text-slate-700 hover:text-slate-900 hover:bg-slate-100 font-bold text-xs transition border border-slate-200 flex items-center gap-1 cursor-pointer"
                                  title="Plan Route"
                                >
                                  <Compass className="w-3.5 h-3.5 text-slate-500" />
                                  <span>Plan</span>
                                </button>
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
          </>
        )}

        {/* Date-Wise Vehicle Journey Logs & Trip History Section (For Regular User View - visible ONLY when on 'history' tab) */}
        {!isAdmin && userActiveTab === 'history' && vehicles.length > 0 && (
          <div>
            <div className="p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold">
                    <History className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-sm text-slate-900">
                      Vehicle Journey Logs & Date-Wise Trip History
                    </h3>
                    <p className="text-xs text-slate-400 font-medium">
                      {vehicles[0].registration_no} • {userVehicleTrips.length} Total Trips Recorded
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setUserActiveTab('vehicle')}
                    className="px-3 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                    title="Switch to My Assigned Vehicle"
                  >
                    <Truck className="w-3.5 h-3.5 text-slate-500" />
                    <span>View Assigned Vehicle</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenHistoryModal(vehicles[0])}
                    className="px-3 py-1 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Calendar className="w-3.5 h-3.5 text-slate-300" />
                    <span>Full Modal</span>
                  </button>
                </div>
              </div>

              {userVehicleTrips.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-xs">
                  No recorded trips found for {vehicles[0].registration_no} yet.
                </div>
              ) : (
                <div className="space-y-4">
                  {Object.entries(userTripsByDate).map(([dateStr, dateTrips]) => (
                    <div key={dateStr} className="space-y-2">
                      <div className="flex items-center gap-2 text-xs font-black text-slate-700 px-1">
                        <Calendar className="w-3.5 h-3.5 text-[#E60012]" />
                        <span>{dateStr}</span>
                        <span className="text-[10px] font-mono text-slate-400 font-bold bg-slate-100 px-2 py-0.5 rounded-full">
                          {dateTrips.length} {dateTrips.length === 1 ? 'Trip' : 'Trips'}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {dateTrips.map((trip: any, idx: number) => {
                          const isActive = trip.is_active === 1 || trip.is_active === true;
                          return (
                            <div
                              key={trip.id || idx}
                              className={`p-3.5 rounded-2xl border transition-all ${isActive
                                  ? 'bg-emerald-50/40 border-emerald-300 shadow-xs'
                                  : 'bg-white border-slate-200 hover:border-slate-300'
                                }`}
                            >
                              <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-slate-100">
                                <span className="font-bold text-xs text-slate-900 truncate">
                                  {trip.route_name || `Trip #${idx + 1}`}
                                </span>
                                {isActive ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-black bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-300 shrink-0">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                                    Active Trip
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full border border-slate-200 shrink-0">
                                    Completed
                                  </span>
                                )}
                              </div>

                              <p className="text-xs text-slate-600 mb-2 truncate">
                                <span className="font-bold text-slate-800">
                                  {trip.start_location_name || 'Origin'} → {trip.end_location_name || 'Destination'}
                                </span>
                              </p>

                              <div className="grid grid-cols-4 gap-1.5 text-[11px] mb-3">
                                <div className="bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                                  <span className="text-[9px] text-slate-400 block uppercase font-bold">Distance</span>
                                  <span className="font-mono font-black text-slate-900">{trip.total_distance_km || 0} KM</span>
                                </div>
                                <div className="bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                                  <span className="text-[9px] text-slate-400 block uppercase font-bold">Duration</span>
                                  <span className="font-mono font-black text-slate-900">
                                    ~{Math.floor((trip.estimated_travel_time_min || 180) / 60)}h {(trip.estimated_travel_time_min || 180) % 60}m
                                  </span>
                                </div>
                                <div className="bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                                  <span className="text-[9px] text-slate-400 block uppercase font-bold">Tolls</span>
                                  <span className="font-mono font-black text-slate-900">
                                    {trip.total_tolls_amount ? `₹${trip.total_tolls_amount}` : 'Included'}
                                  </span>
                                </div>
                                <div className="bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                                  <span className="text-[9px] text-slate-400 block uppercase font-bold">Stops</span>
                                  <span className="font-mono font-black text-slate-900">{trip.stoppages_count || 0}</span>
                                </div>
                              </div>

                              <div className="flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleViewHistoricalTripOnMap(trip, vehicles[0].id)}
                                  className="px-3 py-1 rounded-xl bg-[#E60012] hover:bg-[#CC0010] text-white font-extrabold text-xs flex items-center gap-1.5 transition shadow-2xs cursor-pointer"
                                >
                                  <MapPin className="w-3.5 h-3.5" />
                                  <span>View on Map</span>
                                </button>
                                {!isActive && (
                                  <button
                                    type="button"
                                    onClick={() => handleActivateHistoricalTrip(trip.id)}
                                    className="px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer border border-slate-200"
                                  >
                                    Set Active
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Date-Wise Vehicle Trip History Modal (Admin & Regular User) */}
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
                    Chronological Date-Wise Journey Logs • View route history, distance, tolls and activate trip
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setHistoryModalVehicle(null)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto py-4 space-y-4">
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
                    This vehicle does not have any recorded trips yet.
                  </p>
                </div>
              ) : (
                Object.entries(modalTripsByDate).map(([dateStr, dateTrips]) => (
                  <div key={dateStr} className="space-y-2.5">
                    {/* Date Header Pill */}
                    <div className="flex items-center gap-2 text-xs font-black text-slate-800 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
                      <Calendar className="w-3.5 h-3.5 text-[#E60012]" />
                      <span>{dateStr}</span>
                      <span className="text-[10px] font-mono text-slate-500 font-bold bg-white px-2 py-0.5 rounded-md border border-slate-200 ml-auto">
                        {dateTrips.length} {dateTrips.length === 1 ? 'Trip' : 'Trips'}
                      </span>
                    </div>

                    {dateTrips.map((trip: any, idx: number) => {
                      const isActive = trip.is_active === 1 || trip.is_active === true;
                      return (
                        <div
                          key={trip.id || idx}
                          className={`p-4 rounded-2xl border transition-all ${isActive
                              ? 'bg-emerald-50/40 border-emerald-300 shadow-xs'
                              : 'bg-white border-slate-200 hover:border-slate-300'
                            }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-100">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-xs text-slate-900">
                                {trip.route_name || `Trip #${vehicleHistoryTrips.length - idx}`}
                              </span>
                              {isActive ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-black bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-300">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                                  Active Trip
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full border border-slate-200">
                                  Completed / Past Trip
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleViewHistoricalTripOnMap(trip, historyModalVehicle.id)}
                                className="px-3 py-1 rounded-xl bg-[#E60012] hover:bg-[#CC0010] text-white font-extrabold text-xs flex items-center gap-1.5 transition shadow-2xs cursor-pointer"
                                title="Inspect this trip on Live User View"
                              >
                                <MapPin className="w-3.5 h-3.5" />
                                <span>View on Map</span>
                              </button>

                              {!isActive && (
                                <button
                                  type="button"
                                  onClick={() => handleActivateHistoricalTrip(trip.id)}
                                  className="px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer border border-slate-200"
                                >
                                  Set Active
                                </button>
                              )}
                            </div>
                          </div>

                          <p className="text-xs text-slate-600 font-medium mb-3">
                            <span className="font-bold text-slate-800">
                              {trip.start_location_name || 'Origin'} → {trip.end_location_name || 'Destination'}
                            </span>
                            <span className="text-slate-300 mx-2">•</span>
                            <span className="font-mono text-slate-500">
                              Timing: {trip.start_trip_time || '08:00 AM'} - {trip.end_trip_time || '06:00 PM'}
                            </span>
                          </p>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                            <div className="bg-slate-50 p-2 rounded-xl border border-slate-100">
                              <span className="text-[9px] text-slate-400 block uppercase font-bold">Total Distance</span>
                              <span className="font-mono font-black text-slate-900">{trip.total_distance_km || 0} KM</span>
                            </div>
                            <div className="bg-slate-50 p-2 rounded-xl border border-slate-100">
                              <span className="text-[9px] text-slate-400 block uppercase font-bold">Est. Duration</span>
                              <span className="font-mono font-black text-slate-900">
                                ~{Math.floor((trip.estimated_travel_time_min || 180) / 60)}h {(trip.estimated_travel_time_min || 180) % 60}m
                              </span>
                            </div>
                            <div className="bg-slate-50 p-2 rounded-xl border border-slate-100">
                              <span className="text-[9px] text-slate-400 block uppercase font-bold">FASTag Tolls</span>
                              <span className="font-mono font-black text-slate-900">
                                {trip.total_tolls_amount ? `₹${trip.total_tolls_amount}` : 'Tolls Included'}
                              </span>
                            </div>
                            <div className="bg-slate-50 p-2 rounded-xl border border-slate-100">
                              <span className="text-[9px] text-slate-400 block uppercase font-bold">Stoppages</span>
                              <span className="font-mono font-black text-slate-900">{trip.stoppages_count || 0} Stops</span>
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
