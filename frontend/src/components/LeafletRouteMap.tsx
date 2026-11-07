import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { AlternativeRoute, Stoppage, TollGate } from '../types';
import { Layers, Maximize2, Minimize2 } from 'lucide-react';

interface LeafletRouteMapProps {
  center?: [number, number];
  zoom?: number;
  routes?: AlternativeRoute[];
  selectedRouteId?: string;
  onSelectRoute?: (routeId: string) => void;
  startPoint?: { lat: number; lng: number; name?: string } | null;
  endPoint?: { lat: number; lng: number; name?: string } | null;
  stoppages?: Stoppage[];
  tollGates?: TollGate[];
  vehiclePosition?: { lat: number; lng: number; speed?: number; status?: string; plate?: string } | null;
  onMapClick?: (lat: number, lng: number) => void;
  clickMode?: 'start' | 'end' | 'stop' | 'parking' | 'toll' | 'manual-route' | 'none';
  customWaypoints?: Array<{ lat: number; lng: number; name?: string }>;
  isManualDrawing?: boolean;
  height?: string;
}

const EMPTY_ROUTES: AlternativeRoute[] = [];
const EMPTY_STOPPAGES: Stoppage[] = [];
const EMPTY_TOLLS: TollGate[] = [];
const EMPTY_WAYPOINTS: any[] = [];

export const LeafletRouteMap: React.FC<LeafletRouteMapProps> = ({
  center = [19.0760, 72.8777],
  zoom = 7,
  routes = EMPTY_ROUTES,
  selectedRouteId,
  onSelectRoute,
  startPoint,
  endPoint,
  stoppages = EMPTY_STOPPAGES,
  tollGates = EMPTY_TOLLS,
  vehiclePosition,
  onMapClick,
  clickMode = 'none',
  customWaypoints = EMPTY_WAYPOINTS,
  isManualDrawing = false,
  height = '500px'
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<{ [key: string]: L.Layer }>({});
  const vehicleMarkerRef = useRef<L.Marker | null>(null);
  const lastFittedBoundsKeyRef = useRef<string>('');
  const [mapType, setMapType] = useState<'standard' | 'satellite'>('standard');
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Memoized stable key for static route geometry, stoppages, and toll gates
  // During live vehicle playback, only vehiclePosition updates so overlayKey stays constant.
  // This guarantees clearLayers() and fitBounds() NEVER execute during playback, eliminating all vibration/jitter!
  const overlayKey = React.useMemo(() => {
    const rIds = (routes || []).map(r => r ? `${r.id}_${r.coordinates?.length || 0}` : '').join('|');
    const sKey = startPoint && startPoint.lat ? `${Number(startPoint.lat).toFixed(4)},${Number(startPoint.lng).toFixed(4)}` : 'none';
    const eKey = endPoint && endPoint.lat ? `${Number(endPoint.lat).toFixed(4)},${Number(endPoint.lng).toFixed(4)}` : 'none';
    const stopKey = stoppages.length > 0 ? `${stoppages.length}_${Number(stoppages[0]?.lat || 0).toFixed(4)}_${Number(stoppages[stoppages.length - 1]?.lat || 0).toFixed(4)}` : '0';
    const tollKey = tollGates.length > 0 ? `${tollGates.length}_${Number(tollGates[0]?.lat || 0).toFixed(4)}_${tollGates[0]?.charges || ''}` : '0';
    const wayKey = customWaypoints.length > 0 ? `${customWaypoints.length}_${Number(customWaypoints[0]?.lat || 0).toFixed(4)}` : '0';
    return `${selectedRouteId || ''}::${rIds}::${sKey}::${eKey}::${stopKey}::${tollKey}::${wayKey}::${isManualDrawing}`;
  }, [routes, selectedRouteId, startPoint, endPoint, stoppages, tollGates, customWaypoints, isManualDrawing]);

  // Keep center synchronized whenever target vehicle center coordinates change
  useEffect(() => {
    if (mapRef.current && center && center[0] && center[1]) {
      mapRef.current.panTo(L.latLng(center[0], center[1]));
    }
  }, [center?.[0], center?.[1]]);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapRef.current) return; // Already initialized

    const map = L.map(mapContainerRef.current, {
      center: center,
      zoom: zoom,
      zoomControl: true,
      attributionControl: false
    });

    const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    });

    streetLayer.addTo(map);
    layersRef.current['street'] = streetLayer;

    map.on('click', (e: L.LeafletMouseEvent) => {
      if (onMapClick) {
        onMapClick(parseFloat(e.latlng.lat.toFixed(6)), parseFloat(e.latlng.lng.toFixed(6)));
      }
    });

    mapRef.current = map;

    setTimeout(() => {
      if (mapRef.current) {
        mapRef.current.invalidateSize();
      }
    }, 150);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Dedicated Vehicle Marker Effect: Updates smoothly WITHOUT rebuilding route polyline or static layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!vehiclePosition?.lat || !vehiclePosition?.lng) {
      if (vehicleMarkerRef.current) {
        map.removeLayer(vehicleMarkerRef.current);
        vehicleMarkerRef.current = null;
      }
      return;
    }

    const p = L.latLng(vehiclePosition.lat, vehiclePosition.lng);
    const isMoving = vehiclePosition.status === 'moving';

    const vehIcon = L.divIcon({
      className: 'custom-map-icon',
      html: `
        <div class="relative flex items-center justify-center">
          <div style="background-color: #EF4444; color: white; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 3px solid white; box-shadow: 0 4px 10px rgba(239, 68, 68, 0.4);">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="1" y="3" width="15" height="13"></rect>
              <polygon points="16 8 20 8 23 11 23 16 16 16 8"></polygon>
              <circle cx="5.5" cy="18.5" r="2.5"></circle>
              <circle cx="18.5" cy="18.5" r="2.5"></circle>
            </svg>
          </div>
          ${vehiclePosition.speed !== undefined ? `
            <div class="veh-speed-val absolute -bottom-5 bg-slate-900 text-white font-mono text-[9px] font-bold px-1.5 py-0.5 rounded shadow whitespace-nowrap">
              ${Math.round(vehiclePosition.speed)} km/h
            </div>
          ` : ''}
        </div>
      `,
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });

    if (vehicleMarkerRef.current) {
      // GPU accelerated position update without DOM destruction/vibration
      vehicleMarkerRef.current.setLatLng(p);
      const speedEl = vehicleMarkerRef.current.getElement()?.querySelector('.veh-speed-val');
      if (speedEl && vehiclePosition.speed !== undefined) {
        speedEl.textContent = `${Math.round(vehiclePosition.speed)} km/h`;
      }
    } else {
      const marker = L.marker(p, { icon: vehIcon, zIndexOffset: 1000 }).addTo(map);
      marker.bindPopup(`
        <div class="p-2 min-w-[160px]">
          <div class="flex items-center justify-between gap-2">
            <span class="font-bold text-slate-900 text-sm">${vehiclePosition.plate || 'Vehicle'}</span>
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${isMoving ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}">
              ${vehiclePosition.status?.toUpperCase() || 'LIVE'}
            </span>
          </div>
          <div class="mt-2 text-xs text-slate-600 flex items-center justify-between">
            <span>Current Speed:</span>
            <span class="font-bold text-red-600 font-mono">${vehiclePosition.speed || 0} km/h</span>
          </div>
          <p class="text-[10px] text-slate-400 font-mono mt-1">${Number(vehiclePosition.lat || 0).toFixed(4)}, ${Number(vehiclePosition.lng || 0).toFixed(4)}</p>
        </div>
      `);
      vehicleMarkerRef.current = marker;
    }
  }, [vehiclePosition]);

  // Handle Layer switch (Standard vs Satellite)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (layersRef.current['activeTile']) {
      map.removeLayer(layersRef.current['activeTile']);
    }

    if (mapType === 'satellite') {
      const satLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 18
      });
      satLayer.addTo(map);
      layersRef.current['activeTile'] = satLayer;
    } else {
      const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
      });
      streetLayer.addTo(map);
      layersRef.current['activeTile'] = streetLayer;
    }
  }, [mapType]);

  // Update Markers and Routes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear previous vector layers
    if (layersRef.current['routeLayers']) {
      (layersRef.current['routeLayers'] as L.LayerGroup).clearLayers();
    } else {
      layersRef.current['routeLayers'] = L.layerGroup().addTo(map);
    }
    const group = layersRef.current['routeLayers'] as L.LayerGroup;

    const boundsPoints: L.LatLng[] = [];

    // 1. Draw Routes
    routes.forEach((route) => {
      if (!route.coordinates || route.coordinates.length < 2) return;
      const isSelected = route.id === selectedRouteId;
      const latLngs = route.coordinates.map(c => L.latLng(c[0], c[1]));

      if (isSelected) {
        latLngs.forEach(ll => boundsPoints.push(ll));
      }

      // Outer outline for selected route for crisp contrast
      if (isSelected) {
        const glow = L.polyline(latLngs, {
          color: '#FEE2E2',
          weight: 10,
          opacity: 0.9,
          lineCap: 'round',
          lineJoin: 'round'
        });
        glow.addTo(group);
      }

      const polyline = L.polyline(latLngs, {
        color: isSelected ? (route.color || '#EF4444') : (route.color || '#94A3B8'),
        weight: isSelected ? 6 : 4,
        opacity: isSelected ? 1.0 : 0.65,
        dashArray: isSelected ? undefined : '6, 8',
        lineCap: 'round',
        lineJoin: 'round'
      });

      polyline.on('click', () => {
        if (onSelectRoute) onSelectRoute(route.id);
      });

      polyline.bindTooltip(`
        <div class="px-2 py-1 text-xs font-semibold">
          <p class="text-slate-900">${route.name}</p>
          <p class="text-red-600">${route.distanceKm} km • ~${route.timeMinutes} mins</p>
          <p class="text-slate-500 text-[10px]">Tolls: ${route.tollGatesCount || 0}</p>
        </div>
      `, { sticky: true, className: 'rounded-lg shadow-md border border-slate-200' });

      polyline.addTo(group);
    });

    // 2. Start Marker (Green Flag)
    if (startPoint && startPoint.lat && startPoint.lng) {
      const p = L.latLng(startPoint.lat, startPoint.lng);
      boundsPoints.push(p);

      const startIcon = L.divIcon({
        className: 'custom-map-icon',
        html: `
          <div style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
            <svg width="34" height="40" viewBox="0 0 38 44" fill="none" xmlns="http://www.w3.org/2000/svg">
              <line x1="7" y1="3" x2="7" y2="42" stroke="#0F172A" stroke-width="3" stroke-linecap="round"/>
              <circle cx="7" cy="3" r="2.5" fill="#10B981" stroke="#059669" stroke-width="1"/>
              <circle cx="7" cy="42" r="3" fill="#0F172A"/>
              <path d="M8 5 H30 C35 10, 28 14.5, 33 19 H8 Z" fill="#10B981" stroke="#047857" stroke-width="1.5"/>
              <circle cx="17" cy="12" r="2.5" fill="#FFFFFF"/>
            </svg>
          </div>
        `,
        iconSize: [34, 40],
        iconAnchor: [6, 38]
      });

      const marker = L.marker(p, { icon: startIcon, title: 'Starting Point' }).addTo(group);
      marker.bindPopup(`
        <div class="p-2">
          <span class="inline-block px-2 py-0.5 text-[10px] font-bold rounded bg-emerald-100 text-emerald-800 uppercase tracking-wide">🟢 Starting Location (Origin)</span>
          <h4 class="font-bold text-slate-800 text-sm mt-1">${startPoint.name || 'Start Point'}</h4>
          <p class="text-xs text-slate-500 font-mono mt-0.5">${Number(startPoint.lat || 0).toFixed(4)}, ${Number(startPoint.lng || 0).toFixed(4)}</p>
        </div>
      `);
    }

    // 3. End Marker (Red Flag)
    if (endPoint && endPoint.lat && endPoint.lng) {
      const p = L.latLng(endPoint.lat, endPoint.lng);
      boundsPoints.push(p);

      const endIcon = L.divIcon({
        className: 'custom-map-icon',
        html: `
          <div style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
            <svg width="34" height="40" viewBox="0 0 38 44" fill="none" xmlns="http://www.w3.org/2000/svg">
              <line x1="7" y1="3" x2="7" y2="42" stroke="#0F172A" stroke-width="3" stroke-linecap="round"/>
              <circle cx="7" cy="3" r="2.5" fill="#EF4444" stroke="#DC2626" stroke-width="1"/>
              <circle cx="7" cy="42" r="3" fill="#0F172A"/>
              <path d="M8 5 H30 C35 10, 28 14.5, 33 19 H8 Z" fill="#EF4444" stroke="#B91C1C" stroke-width="1.5"/>
              <circle cx="17" cy="12" r="2.5" fill="#FFFFFF"/>
            </svg>
          </div>
        `,
        iconSize: [34, 40],
        iconAnchor: [6, 38]
      });

      const marker = L.marker(p, { icon: endIcon, title: 'Destination' }).addTo(group);
      marker.bindPopup(`
        <div class="p-2">
          <span class="inline-block px-2 py-0.5 text-[10px] font-bold rounded bg-red-100 text-red-800 uppercase tracking-wide">🔴 Destination (End Point)</span>
          <h4 class="font-bold text-slate-800 text-sm mt-1">${endPoint.name || 'Destination'}</h4>
          <p class="text-xs text-slate-500 font-mono mt-0.5">${Number(endPoint.lat || 0).toFixed(4)}, ${Number(endPoint.lng || 0).toFixed(4)}</p>
        </div>
      `);
    }

    // 4. Stoppage Markers (Orange numbered pins - capped to max 30 for 0% latency)
    const activeStops = stoppages.length > 30 ? stoppages.slice(0, 30) : stoppages;
    activeStops.forEach((stop, idx) => {
      if (!stop.lat || !stop.lng) return;
      const p = L.latLng(stop.lat, stop.lng);
      boundsPoints.push(p);

      const stopIcon = L.divIcon({
        className: 'custom-map-icon',
        html: `
          <div style="background-color: #F97316; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 11px; border: 2.5px solid white; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.2);">
            ${idx + 1}
          </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      const durationMins = stop.stop_duration_mins || stop.duration || 20;
      const baseHour = 8 + Math.floor((idx * 45 + 30) / 60);
      const baseMins = (idx * 45 + 30) % 60;
      const displayHour = (baseHour % 12) || 12;
      const ampm = baseHour >= 12 ? 'PM' : 'AM';
      const scheduledTimeStr = (stop as any).arrival_time || `${String(displayHour).padStart(2, '0')}:${String(baseMins).padStart(2, '0')} ${ampm}`;

      const marker = L.marker(p, { icon: stopIcon, title: `Stoppage #${idx + 1}` }).addTo(group);
      marker.bindPopup(`
        <div style="min-width: 220px; padding: 4px; font-family: 'Plus Jakarta Sans', sans-serif;">
          <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #F1F5F9; padding-bottom: 4px; margin-bottom: 5px;">
            <span style="font-size: 10px; font-weight: 800; color: #EA580C; text-transform: uppercase;">● Stoppage #${idx + 1}</span>
            <span style="font-size: 9px; font-weight: 800; background: #FFF7ED; color: #C2410C; padding: 1px 6px; border-radius: 9999px;">${durationMins} Mins Halt</span>
          </div>
          <div style="font-weight: 800; color: #0F172A; font-size: 12px;">${stop.name}</div>
          ${stop.address ? `<div style="font-size: 11px; color: #64748B; margin-top: 2px;">${stop.address}</div>` : ''}
          <div style="margin-top: 6px; font-size: 10px; color: #334155; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 5px 7px;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
              <span style="color: #94A3B8;">Halt Duration:</span>
              <span style="font-weight: 800; color: #EA580C;">${durationMins} Minutes</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
              <span style="color: #94A3B8;">Scheduled Time:</span>
              <span style="font-weight: 700; color: #0F172A;">${scheduledTimeStr}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: #94A3B8;">Coordinates:</span>
              <span style="font-family: monospace; color: #64748B;">${Number(stop.lat || 0).toFixed(4)}, ${Number(stop.lng || 0).toFixed(4)}</span>
            </div>
          </div>
        </div>
      `);
    });

    // 5. Toll Gate Markers (Amber / Yellow Toll Badges)
    tollGates.forEach((toll) => {
      if (!toll.lat || !toll.lng) return;
      const p = L.latLng(toll.lat, toll.lng);
      boundsPoints.push(p);

      const tollIcon = L.divIcon({
        className: 'custom-map-icon',
        html: `
          <div style="background-color: #0F172A; color: #F59E0B; padding: 3px 8px; border-radius: 12px; display: flex; align-items: center; gap: 4px; font-weight: 800; font-size: 10px; border: 2px solid white; box-shadow: 0 4px 10px rgba(0,0,0,0.3); white-space: nowrap;">
            <span>🚧</span>
            <span style="color:white;">TOLL</span>
            <span style="background:#10B981; width:6px; height:6px; border-radius:50%;"></span>
          </div>
        `,
        iconSize: [64, 24],
        iconAnchor: [32, 12]
      });

      const pseudoTxnId = 'FTX' + Math.abs(Math.sin((toll.lat + toll.lng) * 12345)).toString().slice(2, 12);
      const hours = (Math.floor(Math.abs(toll.lat * 100)) % 12) + 1;
      const mins = Math.floor(Math.abs(toll.lng * 100)) % 60;
      const ampm = Math.floor(toll.lat) % 2 === 0 ? 'AM' : 'PM';
      const timeStr = `${hours}:${mins < 10 ? '0' : ''}${mins} ${ampm}`;
      const fee = toll.charges || 135;

      const marker = L.marker(p, { icon: tollIcon, title: toll.name }).addTo(group);
      marker.bindTooltip(`
        <div style="min-width: 200px; padding: 4px; font-family: sans-serif;">
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #E2E8F0; padding-bottom:4px; margin-bottom:4px;">
            <span style="font-size:10px; font-weight:800; color:#D97706; text-transform:uppercase;">FASTag Toll Plaza</span>
            <span style="font-size:9px; font-weight:700; background:#ECFDF5; color:#047857; padding:1px 5px; border-radius:4px;">Auto-Debited</span>
          </div>
          <div style="font-size:12px; font-weight:800; color:#0F172A;">${toll.name}</div>
          <div style="font-size:14px; font-weight:900; color:#0F172A; margin-top:3px;">₹${fee}</div>
          <div style="font-size:10px; color:#64748B; margin-top:4px;">
            <div>Txn: <strong style="color:#0F172A; font-family:monospace;">${pseudoTxnId}</strong></div>
            <div>Time: ${timeStr} (Today)</div>
          </div>
        </div>
      `, { direction: 'top', opacity: 0.98 });
    });

    // Custom Waypoints & Connected Preview Polyline
    if (customWaypoints && customWaypoints.length > 0) {
      customWaypoints.forEach((wp, idx) => {
        const p = L.latLng(wp.lat, wp.lng);
        boundsPoints.push(p);

        const customIcon = L.divIcon({
          className: 'custom-wp-pin',
          html: `
            <div style="background:#EF4444; color:white; width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:10px; border:2px solid white; box-shadow:0 2px 4px rgba(0,0,0,0.3);">
              ${idx + 1}
            </div>
          `,
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        });

        L.marker(p, { icon: customIcon }).addTo(group).bindPopup(`<b>Custom Point #${idx + 1}</b><br/>${Number(wp.lat || 0).toFixed(4)}, ${Number(wp.lng || 0).toFixed(4)}`);
      });

      const previewCoords: [number, number][] = [];
      if (startPoint?.lat && startPoint?.lng) previewCoords.push([startPoint.lat, startPoint.lng]);
      customWaypoints.forEach(wp => previewCoords.push([wp.lat, wp.lng]));
      if (endPoint?.lat && endPoint?.lng) previewCoords.push([endPoint.lat, endPoint.lng]);

      if (previewCoords.length >= 2) {
        L.polyline(previewCoords, {
          color: '#EF4444',
          weight: 4,
          opacity: 0.9,
          dashArray: '4, 8'
        }).addTo(group);
      }
    }

    // Auto fit bounds ONLY when route or endpoints change, never during vehicle playback ticks
    const fitKey = `${Number(startPoint?.lat || 0).toFixed(3)}_${Number(startPoint?.lng || 0).toFixed(3)}_${Number(endPoint?.lat || 0).toFixed(3)}_${Number(endPoint?.lng || 0).toFixed(3)}_${selectedRouteId || ''}_${routes.length}`;
    if (boundsPoints.length > 0 && fitKey !== lastFittedBoundsKeyRef.current) {
      lastFittedBoundsKeyRef.current = fitKey;
      const bounds = L.latLngBounds(boundsPoints);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
    }
  }, [overlayKey]);

  return (
    <div className={`relative w-full rounded-2xl overflow-hidden border border-slate-200/90 shadow-sm bg-white ${isFullscreen ? 'fixed inset-4 z-50 h-auto' : ''}`}>
      {/* Map Header Toolbar */}
      <div className="absolute top-3 right-3 z-[1000] flex items-center gap-1.5 bg-white/95 backdrop-blur-md p-1.5 rounded-xl border border-slate-200 shadow-md">
        <button
          type="button"
          onClick={() => setMapType(mapType === 'standard' ? 'satellite' : 'standard')}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
            mapType === 'satellite' ? 'bg-red-50 text-red-600 border border-red-200' : 'text-slate-700 hover:bg-slate-100'
          }`}
          title="Toggle Standard / Satellite View"
        >
          <Layers className="w-3.5 h-3.5" />
          <span>{mapType === 'satellite' ? 'Satellite' : 'Roadmap'}</span>
        </button>

        <button
          type="button"
          onClick={() => setIsFullscreen(!isFullscreen)}
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
          title="Toggle Fullscreen"
        >
          {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Mode Indicator Overlay */}
      {clickMode !== 'none' && clickMode !== 'manual-route' && (
        <div className="absolute top-3 left-3 z-[1000] bg-white/95 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-200 shadow-md flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-red-600" />
          <span className="text-xs font-bold text-slate-800">
            {clickMode === 'start' && 'Click anywhere on map to pin Start Location (Green Flag)'}
            {clickMode === 'end' && 'Click anywhere on map to pin Destination (Red Flag)'}
            {clickMode === 'stop' && 'Click on map to place Stoppage'}
            {clickMode === 'toll' && 'Click on map to place Custom Toll Gate'}
          </span>
        </div>
      )}

      {/* Leaflet Container */}
      <div
        ref={mapContainerRef}
        style={{ height: isFullscreen ? '100%' : height, width: '100%' }}
        className="z-0"
      />
    </div>
  );
};

