import React, { useEffect, useRef, useState } from 'react';
import { AlternativeRoute, Stoppage, TollGate } from '../types';
import { Layers, Maximize2, Minimize2 } from 'lucide-react';

declare const google: any;

interface ParkingPoint {
  id?: number;
  name: string;
  lat: number;
  lng: number;
  address?: string;
}

interface GoogleMapsViewProps {
  center?: { lat: number; lng: number };
  zoom?: number;
  routes?: AlternativeRoute[];
  selectedRouteId?: string;
  onSelectRoute?: (routeId: string) => void;
  startPoint?: { lat: number; lng: number; name?: string; address?: string } | null;
  endPoint?: { lat: number; lng: number; name?: string; address?: string } | null;
  stoppages?: Stoppage[];
  parkingPoints?: ParkingPoint[];
  tollGates?: TollGate[];
  vehiclePosition?: { lat: number; lng: number; speed?: number; status?: string; plate?: string } | null;
  onMapClick?: (lat: number, lng: number, address?: string, mode?: string) => void;
  clickMode?: 'start' | 'end' | 'stop' | 'parking' | 'toll' | 'manual-route' | 'none';
  customWaypoints?: Array<{ lat: number; lng: number; name?: string }>;
  isManualDrawing?: boolean;
  isDraggableRoute?: boolean;
  onRouteChange?: (updated: { coordinates: [number, number][]; distanceKm: number; timeMinutes: number; summary?: string }) => void;
  height?: string;
}

const EMPTY_ROUTES: AlternativeRoute[] = [];
const EMPTY_STOPPAGES: Stoppage[] = [];
const EMPTY_PARKING: any[] = [];
const EMPTY_TOLLS: TollGate[] = [];
const EMPTY_WAYPOINTS: any[] = [];

export const GoogleMapsView: React.FC<GoogleMapsViewProps> = ({
  center = { lat: 21.8974, lng: 82.8000 }, // Regional view of Chhattisgarh & Central India
  zoom = 7, // Comfortable overview, not over-zoomed
  routes = EMPTY_ROUTES,
  selectedRouteId,
  onSelectRoute,
  startPoint,
  endPoint,
  stoppages = EMPTY_STOPPAGES,
  parkingPoints = EMPTY_PARKING,
  tollGates = EMPTY_TOLLS,
  vehiclePosition,
  onMapClick,
  clickMode = 'none',
  customWaypoints = EMPTY_WAYPOINTS,
  isManualDrawing = false,
  isDraggableRoute = false,
  onRouteChange,
  height = '520px'
}) => {
  const directionsRendererRef = useRef<any>(null);
  const directionsServiceRef = useRef<any>(null);
  const onRouteChangeRef = useRef(onRouteChange);
  useEffect(() => { onRouteChangeRef.current = onRouteChange; }, [onRouteChange]);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const polylinesRef = useRef<any[]>([]);
  const markersRef = useRef<any[]>([]);
  const vehicleMarkerRef = useRef<any>(null);
  const geocoderRef = useRef<any>(null);
  const activeInfoWindowRef = useRef<any>(null);
  const lastFittedKeyRef = useRef<string>('');

  // Memoized stable key for static route geometry, stoppages, and toll gates
  // During live vehicle playback, only vehiclePosition updates so overlayKey stays constant.
  // This guarantees renderOverlays() and clearOverlays() NEVER execute during playback, eliminating all polyline/toll vibration!
  const overlayKey = React.useMemo(() => {
    const rIds = (routes || []).map(r => r ? `${r.id}_${r.coordinates?.length || 0}` : '').join('|');
    const sKey = startPoint && startPoint.lat ? `${Number(startPoint.lat).toFixed(4)},${Number(startPoint.lng).toFixed(4)}` : 'none';
    const eKey = endPoint && endPoint.lat ? `${Number(endPoint.lat).toFixed(4)},${Number(endPoint.lng).toFixed(4)}` : 'none';
    const stopKey = (stoppages || []).map(s => s && s.lat ? `${s.id || s.name || ''}_${Number(s.lat).toFixed(4)}_${Number(s.lng).toFixed(4)}` : '').join('|');
    const tollKey = (tollGates || []).map(t => t && t.lat ? `${t.id || t.name || ''}_${Number(t.lat).toFixed(4)}_${Number(t.lng).toFixed(4)}_${t.charges || ''}` : '').join('|');
    const parkKey = (parkingPoints || []).map(p => p && p.lat ? `${p.id || p.name || ''}_${Number(p.lat).toFixed(4)}_${Number(p.lng).toFixed(4)}` : '').join('|');
    const wayKey = (customWaypoints || []).map(w => w && w.lat ? `${Number(w.lat).toFixed(4)}_${Number(w.lng).toFixed(4)}` : '').join('|');
    return `${selectedRouteId || ''}::${rIds}::${sKey}::${eKey}::${stopKey}::${tollKey}::${parkKey}::${wayKey}::${isManualDrawing}`;
  }, [routes, selectedRouteId, startPoint, endPoint, stoppages, tollGates, parkingPoints, customWaypoints, isManualDrawing]);

  // Keep center synchronized whenever target vehicle center coordinates change
  useEffect(() => {
    if (mapInstanceRef.current && center && center.lat && center.lng) {
      mapInstanceRef.current.panTo(center);
    }
  }, [center?.lat, center?.lng]);

  // Keep live refs to avoid React stale closure bugs on map clicks!
  const onMapClickRef = useRef(onMapClick);
  useEffect(() => { onMapClickRef.current = onMapClick; }, [onMapClick]);

  const clickModeRef = useRef(clickMode);
  useEffect(() => {
    clickModeRef.current = clickMode;
    if (mapInstanceRef.current) {
      if (clickMode !== 'none') {
        mapInstanceRef.current.setOptions({ draggableCursor: 'crosshair' });
      } else {
        mapInstanceRef.current.setOptions({ draggableCursor: null });
      }
    }
  }, [clickMode]);

  const [mapType, setMapType] = useState<'roadmap' | 'satellite'>('roadmap');
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Initialize Map
  useEffect(() => {
    if (!containerRef.current) return;
    if (mapInstanceRef.current) return;
    if (typeof (window as any).google?.maps === 'undefined') return;

    try {
      geocoderRef.current = new google.maps.Geocoder();
    } catch (e) {
      // Geocoder init
    }

    const map = new google.maps.Map(containerRef.current, {
      center,
      zoom,
      mapTypeId: mapType,
      disableDefaultUI: false,
      zoomControl: true,
      streetViewControl: false,
      fullscreenControl: false,
      mapTypeControl: false,
      styles: [
        { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'simplified' }] }
      ]
    });

    const triggerClick = (lat: number, lng: number) => {
      const currentMode = clickModeRef.current;
      if (currentMode === 'none') return;

      // INSTANT callback: do not wait for geocoder or network!
      const defaultName = `Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
      if (onMapClickRef.current) {
        onMapClickRef.current(lat, lng, defaultName, currentMode);
      }

      // Reverse geocode asynchronously in background to enrich address
      if (geocoderRef.current) {
        geocoderRef.current.geocode({ location: { lat, lng } }, (results: any, status: any) => {
          if (status === 'OK' && results && results[0] && results[0].formatted_address) {
            if (onMapClickRef.current) {
              onMapClickRef.current(lat, lng, results[0].formatted_address, currentMode);
            }
          }
        });
      }
    };

    map.addListener('click', (e: any) => {
      // Close any open popups / info windows when clicking on map
      if (activeInfoWindowRef.current) {
        activeInfoWindowRef.current.close();
        activeInfoWindowRef.current = null;
      }
      if (!e.latLng) return;
      const lat = parseFloat(e.latLng.lat().toFixed(6));
      const lng = parseFloat(e.latLng.lng().toFixed(6));
      triggerClick(lat, lng);
    });

    mapInstanceRef.current = map;
    renderOverlays();

    setTimeout(() => {
      if (mapInstanceRef.current && (window as any).google?.maps) {
        google.maps.event.trigger(mapInstanceRef.current, 'resize');
      }
    }, 150);
  }, []);

  const openPopup = (info: any, m: any) => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (activeInfoWindowRef.current) {
      activeInfoWindowRef.current.close();
    }
    info.open(map, m);
    activeInfoWindowRef.current = info;
  };

  const clearOverlays = () => {
    polylinesRef.current.forEach(p => p.setMap(null));
    polylinesRef.current = [];
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];
  };


  // Native Draggable Route Effect using Google Maps DirectionsRenderer
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !(window as any).google?.maps) return;

    if (!isDraggableRoute || !startPoint || !endPoint || (routes && routes.length > 0)) {
      if (directionsRendererRef.current) {
        directionsRendererRef.current.setMap(null);
        directionsRendererRef.current = null;
      }
      return;
    }

    if (!directionsServiceRef.current) {
      directionsServiceRef.current = new google.maps.DirectionsService();
    }

    if (!directionsRendererRef.current) {
      directionsRendererRef.current = new google.maps.DirectionsRenderer({
        draggable: true,
        map: map,
        suppressMarkers: false,
        polylineOptions: {
          strokeColor: '#E60012',
          strokeWeight: 6,
          strokeOpacity: 0.95
        }
      });

      directionsRendererRef.current.addListener('directions_changed', () => {
        const result = directionsRendererRef.current.getDirections();
        if (result && result.routes && result.routes[0]) {
          const r = result.routes[0];
          const coords: [number, number][] = (r.overview_path || []).map((p: any) => [
            parseFloat(p.lat().toFixed(6)),
            parseFloat(p.lng().toFixed(6))
          ]);
          let totalMeters = 0;
          let totalSeconds = 0;
          (r.legs || []).forEach((leg: any) => {
            totalMeters += leg.distance?.value || 0;
            totalSeconds += leg.duration?.value || 0;
          });
          const distKm = parseFloat((totalMeters / 1000).toFixed(1));
          const timeMins = Math.max(1, Math.round(totalSeconds / 60));
          if (onRouteChangeRef.current) {
            onRouteChangeRef.current({
              coordinates: coords,
              distanceKm: distKm,
              timeMinutes: timeMins,
              summary: r.summary || 'Custom Dragged Route'
            });
          }
        }
      });
    }

    const waypointsList = (stoppages || []).map(s => ({
      location: new google.maps.LatLng(s.lat, s.lng),
      stopover: true
    }));

    directionsServiceRef.current.route({
      origin: new google.maps.LatLng(startPoint.lat, startPoint.lng),
      destination: new google.maps.LatLng(endPoint.lat, endPoint.lng),
      waypoints: waypointsList,
      travelMode: google.maps.TravelMode.DRIVING
    }, (res: any, status: any) => {
      if (status === 'OK' && res && directionsRendererRef.current) {
        directionsRendererRef.current.setDirections(res);
      }
    });

    return () => {
      if (directionsRendererRef.current) {
        directionsRendererRef.current.setMap(null);
        directionsRendererRef.current = null;
      }
    };
  }, [isDraggableRoute, startPoint?.lat, startPoint?.lng, endPoint?.lat, endPoint?.lng, stoppages.length]);

  const renderOverlays = () => {
    const map = mapInstanceRef.current;
    if (!map || !(window as any).google?.maps) return;

    clearOverlays();
    const bounds = new google.maps.LatLngBounds();
    let hasPoints = false;

    // 1. Draw All Alternative Routes (All clearly visible with distinct theme colors)
    routes.forEach((route, idx) => {
      if (!route.coordinates || route.coordinates.length < 2) return;
      const validCoords = (route.coordinates || [])
        .map(c => Array.isArray(c) ? [Number(c[0]), Number(c[1])] : (c && typeof c === 'object' ? [Number((c as any).lat), Number((c as any).lng)] : null))
        .filter((c): c is [number, number] => c !== null && !isNaN(c[0]) && !isNaN(c[1]));
      if (validCoords.length < 2) return;

      const isSelected = route.id === selectedRouteId;
      const path = validCoords.map(([lat, lng]) => new google.maps.LatLng(lat, lng));

      // Extend bounds for ALL routes so all ways from A to B are visible in map viewport
      for (let i = 0; i < path.length; i += 8) {
        bounds.extend(path[i]);
        hasPoints = true;
      }
      bounds.extend(path[path.length - 1]);

      if (isSelected) {
        // Glow behind selected preferred route
        const glow = new google.maps.Polyline({
          path,
          strokeColor: '#FEE2E2',
          strokeOpacity: 0.9,
          strokeWeight: 11,
          map,
          zIndex: 10
        });
        polylinesRef.current.push(glow);
      }

      const polyline = new google.maps.Polyline({
        path,
        strokeColor: route.color || (isSelected ? '#E60012' : '#3B82F6'),
        strokeOpacity: isSelected ? 1.0 : 0.85,
        strokeWeight: isSelected ? 7 : 5,
        map,
        zIndex: isSelected ? 30 : 15,
        editable: Boolean(isSelected && isDraggableRoute),
        draggable: false
      });

      if (isSelected && isDraggableRoute) {
        const mvcPath = polyline.getPath();
        const onPathChange = () => {
          const updatedCoords: [number, number][] = [];
          let distM = 0;
          const count = mvcPath.getLength();
          for (let i = 0; i < count; i++) {
            const pt = mvcPath.getAt(i);
            const lat = parseFloat(pt.lat().toFixed(6));
            const lng = parseFloat(pt.lng().toFixed(6));
            updatedCoords.push([lat, lng]);
            if (i > 0) {
              const prev = updatedCoords[i - 1];
              const R = 6371;
              const dLat = (lat - prev[0]) * Math.PI / 180;
              const dLon = (lng - prev[1]) * Math.PI / 180;
              const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(prev[0] * Math.PI / 180) * Math.cos(lat * Math.PI / 180) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
              const cc = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
              distM += R * cc;
            }
          }
          const updatedDistKm = parseFloat(distM.toFixed(1));
          const updatedTimeMins = Math.max(1, Math.round((updatedDistKm / 45) * 60));
          if (onRouteChangeRef.current) {
            onRouteChangeRef.current({
              coordinates: updatedCoords,
              distanceKm: updatedDistKm,
              timeMinutes: updatedTimeMins,
              summary: 'Route Modified via Map Drag'
            });
          }
        };

        mvcPath.addListener('set_at', onPathChange);
        mvcPath.addListener('insert_at', onPathChange);
        mvcPath.addListener('remove_at', onPathChange);
      }

      polyline.addListener('click', (e: any) => {
        // If in pin mode, pass click to map pin placer!
        if (clickModeRef.current !== 'none' && e.latLng) {
          const lat = parseFloat(e.latLng.lat().toFixed(6));
          const lng = parseFloat(e.latLng.lng().toFixed(6));
          const currentMode = clickModeRef.current;
          if (onMapClickRef.current) {
            onMapClickRef.current(lat, lng, `Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`, currentMode);
          }
        } else {
          if (onSelectRoute) onSelectRoute(route.id);
        }
      });

      polylinesRef.current.push(polyline);
    });

    // Authentic Start (Green Flag) & Destination (Red Flag) SVGs
    const greenFlagSvg = `data:image/svg+xml;utf-8,${encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="38" height="44" viewBox="0 0 38 44">
        <defs>
          <filter id="startFlagShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#0F172A" flood-opacity="0.35"/>
          </filter>
        </defs>
        <!-- Flagpole -->
        <line x1="7" y1="3" x2="7" y2="42" stroke="#0F172A" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="7" cy="3" r="2.5" fill="#10B981" stroke="#059669" stroke-width="1"/>
        <circle cx="7" cy="42" r="3" fill="#0F172A"/>
        <!-- Green Start Flag Pennant -->
        <path d="M8 5 H30 C35 10, 28 14.5, 33 19 H8 Z" fill="#10B981" stroke="#047857" stroke-width="1.5" filter="url(#startFlagShadow)"/>
        <!-- Star Icon -->
        <circle cx="17" cy="12" r="2.5" fill="#FFFFFF"/>
      </svg>
    `)}`;

    const redFlagSvg = `data:image/svg+xml;utf-8,${encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="38" height="44" viewBox="0 0 38 44">
        <defs>
          <filter id="destFlagShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#0F172A" flood-opacity="0.35"/>
          </filter>
        </defs>
        <!-- Flagpole -->
        <line x1="7" y1="3" x2="7" y2="42" stroke="#0F172A" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="7" cy="3" r="2.5" fill="#EF4444" stroke="#DC2626" stroke-width="1"/>
        <circle cx="7" cy="42" r="3" fill="#0F172A"/>
        <!-- Red Destination Flag Pennant -->
        <path d="M8 5 H30 C35 10, 28 14.5, 33 19 H8 Z" fill="#EF4444" stroke="#B91C1C" stroke-width="1.5" filter="url(#destFlagShadow)"/>
        <!-- Finish Star Icon -->
        <circle cx="17" cy="12" r="2.5" fill="#FFFFFF"/>
      </svg>
    `)}`;

    // 2. Start Marker (Green Flag)
    if (startPoint?.lat && startPoint?.lng) {
      const pos = new google.maps.LatLng(startPoint.lat, startPoint.lng);
      bounds.extend(pos);
      hasPoints = true;

      const marker = new google.maps.Marker({
        position: pos,
        map,
        title: `Start: ${startPoint.name || 'Start Point'}`,
        icon: {
          url: greenFlagSvg,
          scaledSize: new google.maps.Size(36, 42),
          anchor: new google.maps.Point(7, 42)
        },
        zIndex: 50
      });

      const infoWindow = new google.maps.InfoWindow({
        content: `
          <div style="padding: 4px; font-family: 'Plus Jakarta Sans', sans-serif;">
            <div style="font-size: 10px; font-weight: bold; color: #10B981; text-transform: uppercase;">🟢 Start Location (Origin)</div>
            <div style="font-size: 13px; font-weight: 800; color: #0F172A; margin-top: 2px;">${startPoint.name || 'Starting Point'}</div>
            ${startPoint.address ? `<div style="font-size: 11px; color: #64748B; margin-top: 2px;">${startPoint.address}</div>` : ''}
            <div style="font-size: 10px; font-family: monospace; color: #94A3B8; margin-top: 2px;">${Number(startPoint.lat || 0).toFixed(4)}, ${Number(startPoint.lng || 0).toFixed(4)}</div>
          </div>
        `
      });

      marker.addListener('click', () => openPopup(infoWindow, marker));
      markersRef.current.push(marker);
    }

    // 3. Destination Marker (Red Flag)
    if (endPoint?.lat && endPoint?.lng) {
      const pos = new google.maps.LatLng(endPoint.lat, endPoint.lng);
      bounds.extend(pos);
      hasPoints = true;

      const marker = new google.maps.Marker({
        position: pos,
        map,
        title: `Destination: ${endPoint.name || 'Destination'}`,
        icon: {
          url: redFlagSvg,
          scaledSize: new google.maps.Size(36, 42),
          anchor: new google.maps.Point(7, 42)
        },
        zIndex: 50
      });

      const infoWindow = new google.maps.InfoWindow({
        content: `
          <div style="padding: 4px; font-family: 'Plus Jakarta Sans', sans-serif;">
            <div style="font-size: 10px; font-weight: bold; color: #EF4444; text-transform: uppercase;">🔴 Destination (End Point)</div>
            <div style="font-size: 13px; font-weight: 800; color: #0F172A; margin-top: 2px;">${endPoint.name || 'Destination'}</div>
            ${endPoint.address ? `<div style="font-size: 11px; color: #64748B; margin-top: 2px;">${endPoint.address}</div>` : ''}
            <div style="font-size: 10px; font-family: monospace; color: #94A3B8; margin-top: 2px;">${Number(endPoint.lat || 0).toFixed(4)}, ${Number(endPoint.lng || 0).toFixed(4)}</div>
          </div>
        `
      });

      marker.addListener('click', () => openPopup(infoWindow, marker));
      markersRef.current.push(marker);
    }

    // 4. Stoppage Markers (Orange numbered pins)
    stoppages.forEach((stop, idx) => {
      if (!stop.lat || !stop.lng) return;
      const pos = new google.maps.LatLng(stop.lat, stop.lng);
      bounds.extend(pos);
      hasPoints = true;

      const marker = new google.maps.Marker({
        position: pos,
        map,
        title: `Stop #${idx + 1}: ${stop.name}`,
        label: { text: `${idx + 1}`, color: '#FFFFFF', fontWeight: 'bold', fontSize: '11px' },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 12,
          fillColor: '#F97316',
          fillOpacity: 1,
          strokeColor: '#FFFFFF',
          strokeWeight: 2.5
        },
        zIndex: 40
      });

      const durationMins = stop.stop_duration_mins || stop.duration || 20;
      const baseHour = 8 + Math.floor((idx * 45 + 30) / 60);
      const baseMins = (idx * 45 + 30) % 60;
      const displayHour = (baseHour % 12) || 12;
      const ampm = baseHour >= 12 ? 'PM' : 'AM';
      const scheduledTimeStr = `${String(displayHour).padStart(2, '0')}:${String(baseMins).padStart(2, '0')} ${ampm}`;

      const info = new google.maps.InfoWindow({
        content: `
          <div style="min-width: 230px; padding: 6px; font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;">
            <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #F1F5F9; padding-bottom: 5px; margin-bottom: 6px;">
              <span style="font-size: 10px; font-weight: 800; color: #EA580C; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 4px;">
                <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#EA580C;"></span>
                Stoppage #${idx + 1}
              </span>
              <span style="font-size: 9px; font-weight: 800; background: #FFF7ED; color: #C2410C; padding: 2px 7px; border-radius: 9999px; border: 1px solid #FFEDD5;">
                ${durationMins} Mins Halt
              </span>
            </div>
            <div style="font-size: 13px; font-weight: 800; color: #0F172A; line-height: 1.3;">${stop.name}</div>
            ${stop.address ? `<div style="font-size: 11px; color: #64748B; margin-top: 3px;">${stop.address}</div>` : ''}
            <div style="margin-top: 7px; font-size: 10px; color: #334155; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 6px 8px;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                <span style="color: #94A3B8;">Halt Duration:</span>
                <span style="font-weight: 800; color: #EA580C;">${durationMins} Minutes</span>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                <span style="color: #94A3B8;">Scheduled Time:</span>
                <span style="font-weight: 700; color: #0F172A;">${scheduledTimeStr}</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: #94A3B8;">Coordinates:</span>
                <span style="font-family: monospace; font-weight: 600; color: #64748B;">${Number(stop.lat).toFixed(4)}, ${Number(stop.lng).toFixed(4)}</span>
              </div>
            </div>
          </div>
        `
      });
      marker.addListener('mouseover', () => openPopup(info, marker));
      marker.addListener('mouseout', () => {
        if (activeInfoWindowRef.current === info) {
          info.close();
          activeInfoWindowRef.current = null;
        }
      });
      marker.addListener('click', () => openPopup(info, marker));
      markersRef.current.push(marker);
    });

    // 5. Parking Points (Blue "P" Pins)
    parkingPoints.forEach((pPoint) => {
      if (!pPoint.lat || !pPoint.lng) return;
      const pos = new google.maps.LatLng(pPoint.lat, pPoint.lng);
      bounds.extend(pos);
      hasPoints = true;

      const marker = new google.maps.Marker({
        position: pos,
        map,
        title: `Parking: ${pPoint.name}`,
        label: { text: 'P', color: '#FFFFFF', fontWeight: 'bold', fontSize: '11px' },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 12,
          fillColor: '#3B82F6',
          fillOpacity: 1,
          strokeColor: '#FFFFFF',
          strokeWeight: 2.5
        },
        zIndex: 40
      });

      const info = new google.maps.InfoWindow({
        content: `
          <div style="padding: 4px; font-family: 'Plus Jakarta Sans', sans-serif;">
            <div style="font-size: 10px; font-weight: bold; color: #3B82F6; text-transform: uppercase;">Vehicle Parking Point</div>
            <div style="font-size: 12px; font-weight: bold; color: #0F172A;">${pPoint.name}</div>
          </div>
        `
      });
      marker.addListener('mouseover', () => openPopup(info, marker));
      marker.addListener('mouseout', () => {
        if (activeInfoWindowRef.current === info) {
          info.close();
          activeInfoWindowRef.current = null;
        }
      });
      marker.addListener('click', () => openPopup(info, marker));
      markersRef.current.push(marker);
    });

    // 6. Toll Gate Markers (Authentic Toll Barrier Plaza SVG with Hover FastTag Telemetry)
    const tollPlazaSvg = `data:image/svg+xml;utf-8,${encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
        <defs>
          <filter id="tollShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#0f172a" flood-opacity="0.35"/>
          </filter>
        </defs>
        <circle cx="18" cy="18" r="15" fill="#1E293B" stroke="#FFFFFF" stroke-width="2.5" filter="url(#tollShadow)"/>
        <circle cx="18" cy="18" r="12" fill="#0F172A"/>
        <!-- Toll Canopy -->
        <path d="M10 13L18 9L26 13H10Z" fill="#38BDF8"/>
        <!-- Toll Booth Pillars -->
        <rect x="11.5" y="13.5" width="2" height="9.5" fill="#FFFFFF"/>
        <rect x="22.5" y="13.5" width="2" height="9.5" fill="#FFFFFF"/>
        <!-- Striped Barrier Arm -->
        <line x1="12" y1="16.5" x2="24" y2="16.5" stroke="#F59E0B" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="15" y1="16.5" x2="17.5" y2="16.5" stroke="#EF4444" stroke-width="2.5"/>
        <line x1="20" y1="16.5" x2="22.5" y2="16.5" stroke="#EF4444" stroke-width="2.5"/>
        <!-- Base -->
        <rect x="9" y="23" width="18" height="2" rx="0.5" fill="#64748B"/>
        <!-- FASTag Green Indicator Dot -->
        <circle cx="25" cy="10" r="3" fill="#10B981" stroke="#FFFFFF" stroke-width="1"/>
      </svg>
    `)}`;

    tollGates.forEach(toll => {
      if (!toll.lat || !toll.lng) return;
      const pos = new google.maps.LatLng(toll.lat, toll.lng);
      bounds.extend(pos);
      hasPoints = true;

      const marker = new google.maps.Marker({
        position: pos,
        map,
        title: `${toll.name} (FASTag Toll Plaza)`,
        icon: {
          url: tollPlazaSvg,
          scaledSize: new google.maps.Size(34, 34),
          anchor: new google.maps.Point(17, 17)
        },
        zIndex: 45
      });

      const pseudoTxnId = 'FTX' + Math.abs(Math.sin((toll.lat + toll.lng) * 12345)).toString().slice(2, 12);
      const hours = (Math.floor(Math.abs(toll.lat * 100)) % 12) + 1;
      const mins = Math.floor(Math.abs(toll.lng * 100)) % 60;
      const ampm = Math.floor(toll.lat) % 2 === 0 ? 'AM' : 'PM';
      const timeStr = `${hours}:${mins < 10 ? '0' : ''}${mins} ${ampm}`;
      const fee = toll.charges || 135;

      const info = new google.maps.InfoWindow({
        content: `
          <div style="min-width: 220px; padding: 6px; font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; border-bottom: 1px solid #F1F5F9; padding-bottom: 6px; margin-bottom: 6px;">
              <span style="font-size: 10px; font-weight: 800; color: #D97706; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 5px;">
                <span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:#10B981;"></span>
                FASTag Toll Plaza
              </span>
              <span style="font-size: 9px; font-weight: 700; background: #ECFDF5; color: #047857; padding: 2px 6px; border-radius: 9999px;">Auto-Debited</span>
            </div>
            <div style="font-size: 13px; font-weight: 800; color: #0F172A; line-height: 1.3;">${toll.name}</div>
            <div style="margin-top: 6px; display: flex; align-items: baseline; gap: 6px;">
              <span style="font-size: 11px; font-weight: 600; color: #64748B;">Toll Amount:</span>
              <span style="font-size: 17px; font-weight: 900; color: #0F172A; font-family: monospace;">₹${fee}</span>
            </div>
            <div style="margin-top: 6px; font-size: 10px; color: #475569; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 6px 8px;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                <span style="color: #94A3B8;">Txn ID:</span>
                <span style="font-family: monospace; font-weight: 700; color: #0F172A;">${pseudoTxnId}</span>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                <span style="color: #94A3B8;">Time:</span>
                <span style="font-weight: 600; color: #334155;">${timeStr} (Today)</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: #94A3B8;">Lane / ETC:</span>
                <span style="font-weight: 600; color: #334155;">Lane 03 • FastTag Valid</span>
              </div>
            </div>
          </div>
        `
      });

      marker.addListener('mouseover', () => openPopup(info, marker));
      marker.addListener('mouseout', () => {
        if (activeInfoWindowRef.current === info) {
          info.close();
          activeInfoWindowRef.current = null;
        }
      });
      marker.addListener('click', () => openPopup(info, marker));
      markersRef.current.push(marker);
    });

    // 6. Custom Manual Route Drawing (Waypoints & Connected Preview Polyline)
    if (customWaypoints && customWaypoints.length > 0) {
      customWaypoints.forEach((wp, idx) => {
        const pos = new google.maps.LatLng(wp.lat, wp.lng);
        bounds.extend(pos);
        hasPoints = true;

        const marker = new google.maps.Marker({
          position: pos,
          map,
          title: `Custom Point #${idx + 1} (${Number(wp.lat || 0).toFixed(4)}, ${Number(wp.lng || 0).toFixed(4)})`,
          label: {
            text: `${idx + 1}`,
            color: '#FFFFFF',
            fontWeight: 'bold',
            fontSize: '11px'
          },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 12,
            fillColor: '#EF4444',
            fillOpacity: 1,
            strokeColor: '#FFFFFF',
            strokeWeight: 2.5
          },
          zIndex: 60
        });

        markersRef.current.push(marker);
      });

      // Draw live connected preview polyline
      const previewPoints: any[] = [];
      if (startPoint?.lat && startPoint?.lng) {
        previewPoints.push(new google.maps.LatLng(startPoint.lat, startPoint.lng));
      }
      customWaypoints.forEach(wp => {
        previewPoints.push(new google.maps.LatLng(wp.lat, wp.lng));
      });
      if (endPoint?.lat && endPoint?.lng) {
        previewPoints.push(new google.maps.LatLng(endPoint.lat, endPoint.lng));
      }

      if (previewPoints.length >= 2) {
        const previewPolyline = new google.maps.Polyline({
          path: previewPoints,
          strokeColor: '#EF4444',
          strokeOpacity: 0.9,
          strokeWeight: 5,
          map,
          zIndex: 35
        });
        polylinesRef.current.push(previewPolyline);
      }
    }

    // Auto-fit bounds ONLY when origin, destination, or route selection changes!
    // Never reset or force zoom out when the user zooms in or explores streets.
    const fitKey = `${Number(startPoint?.lat || 0).toFixed(3)}_${Number(startPoint?.lng || 0).toFixed(3)}_${Number(endPoint?.lat || 0).toFixed(3)}_${Number(endPoint?.lng || 0).toFixed(3)}_${selectedRouteId || ''}_${routes.length}_${customWaypoints.length}`;
    if (hasPoints && fitKey !== lastFittedKeyRef.current) {
      lastFittedKeyRef.current = fitKey;
      map.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });
    }
  };

  // Static Overlays Effect: Only re-renders when route path, endpoints, or points change!
  // Uses stable overlayKey so vehicle movement ticks never trigger polyline/marker clearing!
  useEffect(() => {
    renderOverlays();
  }, [overlayKey]);

  // Dedicated Vehicle Marker Effect: Updates vehicle position smoothly WITHOUT recreating polylines or static markers!
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !(window as any).google?.maps) return;

    if (!vehiclePosition?.lat || !vehiclePosition?.lng) {
      if (vehicleMarkerRef.current) {
        vehicleMarkerRef.current.setMap(null);
        vehicleMarkerRef.current = null;
      }
      return;
    }

    const pos = new google.maps.LatLng(vehiclePosition.lat, vehiclePosition.lng);

    if (vehicleMarkerRef.current) {
      // Direct smooth position update - polyline is completely untouched!
      vehicleMarkerRef.current.setPosition(pos);
      vehicleMarkerRef.current.setTitle(`${vehiclePosition.plate || 'Vehicle'} • ${vehiclePosition.speed || 0} km/h`);
    } else {
      const truckSvg = `data:image/svg+xml;utf-8,${encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
          <defs>
            <filter id="truckShadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#0f172a" flood-opacity="0.35"/>
            </filter>
          </defs>
          <circle cx="24" cy="24" r="17" fill="#0F172A" stroke="#FFFFFF" stroke-width="2.5" filter="url(#truckShadow)"/>
          <path d="M14 26V18C14 17.45 14.45 17 15 17H27V26H14Z" fill="#FFFFFF"/>
          <path d="M27 20H32C32.3 20 32.6 20.15 32.8 20.4L35.2 23.6C35.4 23.85 35.5 24.15 35.5 24.5V26H27V20Z" fill="#EF4444"/>
          <circle cx="18" cy="27" r="2.5" fill="#0F172A" stroke="#FFFFFF" stroke-width="1.5"/>
          <circle cx="31" cy="27" r="2.5" fill="#0F172A" stroke="#FFFFFF" stroke-width="1.5"/>
        </svg>
      `)}`;

      const vMarker = new google.maps.Marker({
        position: pos,
        map,
        title: `${vehiclePosition.plate || 'Vehicle'} • ${vehiclePosition.speed || 0} km/h`,
        icon: {
          url: truckSvg,
          scaledSize: new google.maps.Size(46, 46),
          anchor: new google.maps.Point(23, 23)
        },
        zIndex: 100
      });

      const info = new google.maps.InfoWindow({
        content: `
          <div style="padding: 6px; font-family: 'Plus Jakarta Sans', sans-serif;">
            <div style="font-size: 10px; font-weight: 800; color: #EF4444; text-transform: uppercase;">● Vehicle Telemetry</div>
            <div style="font-size: 13px; font-weight: 800; color: #0F172A; font-family: monospace;">${vehiclePosition.plate || 'Vehicle'}</div>
            <div style="font-size: 11px; color: #64748B; margin-top: 3px;">Status: <strong>${vehiclePosition.status?.toUpperCase() || 'LIVE'}</strong> • Speed: <strong>${vehiclePosition.speed || 0} km/h</strong></div>
            <div style="font-size: 10px; font-family: monospace; color: #94A3B8; margin-top: 2px;">${Number(vehiclePosition.lat || 0).toFixed(4)}, ${Number(vehiclePosition.lng || 0).toFixed(4)}</div>
          </div>
        `
      });

      vMarker.addListener('click', () => openPopup(info, vMarker));
      vehicleMarkerRef.current = vMarker;
    }
  }, [vehiclePosition]);

  return (
    <div className={`relative w-full rounded-2xl overflow-hidden border border-slate-200/90 shadow-xs bg-white ${isFullscreen ? 'fixed inset-4 z-50 h-auto' : ''}`}>
      {/* Top Map Action Bar */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 bg-white/95 backdrop-blur-md p-1.5 rounded-xl border border-slate-200 shadow-sm">
        <button
          type="button"
          onClick={() => {
            const next = mapType === 'roadmap' ? 'satellite' : 'roadmap';
            setMapType(next);
            if (mapInstanceRef.current) mapInstanceRef.current.setMapTypeId(next);
          }}
          className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
            mapType === 'satellite' ? 'bg-red-50 text-red-600 border border-red-200' : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>{mapType === 'satellite' ? 'Satellite' : 'Roadmap'}</span>
        </button>

        <button
          type="button"
          onClick={() => setIsFullscreen(!isFullscreen)}
          className="p-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition"
        >
          {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Mode Indicator Overlay */}
      {clickMode !== 'none' && clickMode !== 'manual-route' && (
        <div className="absolute top-3 left-3 z-10 bg-white/95 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-200 shadow-md flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-600" />
          <span className="text-xs font-bold text-slate-900">
            {clickMode === 'start' && '👉 Click on Google Map to place Start Location (Green Flag)'}
            {clickMode === 'end' && '👉 Click on Google Map to place Destination (Red Flag)'}
            {clickMode === 'stop' && '👉 Click on Map to place Stoppage'}
            {clickMode === 'parking' && '👉 Click on Map to place Vehicle Parking Point'}
            {clickMode === 'toll' && '👉 Click on Map along Route to place Manual Toll Gate'}
          </span>
        </div>
      )}

      {/* Google Maps Container */}
      <div ref={containerRef} style={{ height: isFullscreen ? '100%' : height, width: '100%' }} />
    </div>
  );
};
