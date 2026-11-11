import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { AlternativeRoute, Stoppage, TollGate } from '../types';
import {
  Layers,
  Maximize2,
  Minimize2,
  Plus,
  Minus,
  Scissors,
  Undo2,
  Check,
  CircleDot,
  Trash2,
  Map as MapIcon,
  Globe,
  Mountain,
  X,
  ExternalLink
} from 'lucide-react';
import {
  deleteSinglePoint,
  deletePointRange,
  calculateCumulativeDistanceKm,
  calculateDurationMinutes,
  calculateBearing
} from '../utils/routePolylineUtils';

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
  vehiclePosition?: { lat: number; lng: number; speed?: number; status?: string; plate?: string; heading?: number } | null;
  onMapClick?: (lat: number, lng: number) => void;
  clickMode?: 'start' | 'end' | 'stop' | 'parking' | 'toll' | 'manual-route' | 'none';
  customWaypoints?: Array<{ lat: number; lng: number; name?: string }>;
  isManualDrawing?: boolean;
  hideEditTools?: boolean;
  hideBreadcrumbs?: boolean;
  onRouteChange?: (updated: { coordinates: [number, number][]; distanceKm: number; timeMinutes: number; summary?: string }) => void;
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
  hideEditTools = false,
  hideBreadcrumbs = false,
  onRouteChange,
  height = '500px'
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<{ [key: string]: L.Layer }>({});
  const vehicleMarkerRef = useRef<L.Marker | null>(null);
  const prevVehiclePosRef = useRef<{ lat: number; lng: number } | null>(null);
  const currentHeadingRef = useRef<number>(150);
  const lastFittedBoundsKeyRef = useRef<string>('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const onRouteChangeRef = useRef(onRouteChange);
  useEffect(() => { onRouteChangeRef.current = onRouteChange; }, [onRouteChange]);

  // UI state
  const [mapType, setMapType] = useState<'standard' | 'satellite' | 'terrain'>('standard');
  const [isMapStyleOpen, setIsMapStyleOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showBreadcrumbs, setShowBreadcrumbs] = useState(true);

  // Trim state
  const [isTrimMode, setIsTrimMode] = useState(false);
  const [trimSubMode, setTrimSubMode] = useState<'single' | 'range'>('single');
  const [cutStartIndex, setCutStartIndex] = useState<number | null>(null);
  const [cutEndIndex, setCutEndIndex] = useState<number | null>(null);
  const [undoHistory, setUndoHistory] = useState<Array<{ coordinates: [number, number][]; distanceKm: number; timeMinutes: number }>>([]);

  // Street View States
  const [streetViewCoord, setStreetViewCoord] = useState<{ lat: number; lng: number } | null>(null);
  const [isDraggingPegman, setIsDraggingPegman] = useState<boolean>(false);

  const activeRoute = React.useMemo(() => {
    return routes.find(r => r.id === selectedRouteId) || routes[0];
  }, [routes, selectedRouteId]);

  const activeCoords: [number, number][] = React.useMemo(() => {
    if (!activeRoute?.coordinates) return [];
    return (activeRoute.coordinates || [])
      .map(c => Array.isArray(c) ? [Number(c[0]), Number(c[1])] : (c && typeof c === 'object' ? [Number((c as any).lat), Number((c as any).lng)] : null))
      .filter((c): c is [number, number] => c !== null && !isNaN(c[0]) && !isNaN(c[1]));
  }, [activeRoute?.coordinates]);

  const handleZoomIn = () => {
    if (mapRef.current) {
      mapRef.current.zoomIn();
    }
  };

  const handleZoomOut = () => {
    if (mapRef.current) {
      mapRef.current.zoomOut();
    }
  };

  const handleToggleFullscreen = () => {
    const nextState = !isFullscreen;
    setIsFullscreen(nextState);

    try {
      if (nextState) {
        const el = wrapperRef.current;
        if (el && el.requestFullscreen && !document.fullscreenElement) {
          el.requestFullscreen().catch(() => {});
        }
      } else {
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
      }
    } catch (e) {}
  };

  useEffect(() => {
    const onFsChange = () => {
      const isDocFs = !!document.fullscreenElement;
      if (!isDocFs && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [isFullscreen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFullscreen]);

  // Leaflet resize handler when entering or exiting fullscreen
  useEffect(() => {
    const t1 = setTimeout(() => {
      if (mapRef.current) {
        mapRef.current.invalidateSize();
      }
    }, 100);

    const t2 = setTimeout(() => {
      if (mapRef.current) {
        mapRef.current.invalidateSize();
      }
    }, 350);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isFullscreen]);

  // Polyline deletion / trim methods
  const handleDeleteSinglePoint = (index: number) => {
    if (activeCoords.length <= 2) {
      alert('Route requires at least 2 points (Start and Destination).');
      return;
    }

    setUndoHistory(prev => [
      ...prev,
      {
        coordinates: activeCoords,
        distanceKm: activeRoute?.distanceKm || calculateCumulativeDistanceKm(activeCoords),
        timeMinutes: activeRoute?.timeMinutes || calculateDurationMinutes(calculateCumulativeDistanceKm(activeCoords))
      }
    ]);

    const res = deleteSinglePoint(activeCoords, index);
    if (onRouteChangeRef.current) {
      onRouteChangeRef.current({
        coordinates: res.coordinates,
        distanceKm: res.distanceKm,
        timeMinutes: res.timeMinutes,
        summary: `Point #${index + 1} deleted from route`
      });
    }
  };

  const handleConfirmRangeDelete = () => {
    if (cutStartIndex === null || cutEndIndex === null) {
      alert('Please click both Start and End points of the wrong route line.');
      return;
    }
    if (activeCoords.length <= 2) return;

    setUndoHistory(prev => [
      ...prev,
      {
        coordinates: activeCoords,
        distanceKm: activeRoute?.distanceKm || calculateCumulativeDistanceKm(activeCoords),
        timeMinutes: activeRoute?.timeMinutes || calculateDurationMinutes(calculateCumulativeDistanceKm(activeCoords))
      }
    ]);

    const res = deletePointRange(activeCoords, cutStartIndex, cutEndIndex);
    const countDeleted = Math.abs(cutEndIndex - cutStartIndex) + 1;
    setCutStartIndex(null);
    setCutEndIndex(null);

    if (onRouteChangeRef.current) {
      onRouteChangeRef.current({
        coordinates: res.coordinates,
        distanceKm: res.distanceKm,
        timeMinutes: res.timeMinutes,
        summary: `Deleted ${countDeleted} points along wrong route line`
      });
    }
  };

  const handleUndo = () => {
    if (undoHistory.length === 0) return;
    const last = undoHistory[undoHistory.length - 1];
    setUndoHistory(prev => prev.slice(0, prev.length - 1));
    setCutStartIndex(null);
    setCutEndIndex(null);

    if (onRouteChangeRef.current) {
      onRouteChangeRef.current({
        coordinates: last.coordinates,
        distanceKm: last.distanceKm,
        timeMinutes: last.timeMinutes,
        summary: 'Restored previous route line'
      });
    }
  };

  const handleVertexMarkerClick = (index: number) => {
    if (trimSubMode === 'single') {
      handleDeleteSinglePoint(index);
    } else {
      if (cutStartIndex === null) {
        setCutStartIndex(index);
      } else if (cutEndIndex === null) {
        if (index === cutStartIndex) {
          setCutStartIndex(null);
        } else {
          setCutEndIndex(index);
        }
      } else {
        setCutStartIndex(index);
        setCutEndIndex(null);
      }
    }
  };

  const handlePegmanClick = () => {
    let targetLat = 0;
    let targetLng = 0;

    if (vehiclePosition?.lat && vehiclePosition?.lng) {
      targetLat = Number(vehiclePosition.lat);
      targetLng = Number(vehiclePosition.lng);
    } else if (startPoint?.lat && startPoint?.lng) {
      targetLat = Number(startPoint.lat);
      targetLng = Number(startPoint.lng);
    } else if (mapRef.current) {
      const c = mapRef.current.getCenter();
      if (c) {
        targetLat = c.lat;
        targetLng = c.lng;
      }
    }

    if (targetLat && targetLng) {
      setStreetViewCoord({ lat: targetLat, lng: targetLng });
    }
  };

  const handleDropOnLeaflet = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingPegman(false);
    const map = mapRef.current;
    if (!map || !mapContainerRef.current) return;

    const rect = mapContainerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    try {
      const latLng = map.containerPointToLatLng(L.point(x, y));
      if (latLng && latLng.lat && latLng.lng) {
        setStreetViewCoord({ lat: latLng.lat, lng: latLng.lng });
      }
    } catch (err) {}
  };

  const overlayKey = React.useMemo(() => {
    const rIds = (routes || []).map(r => r ? `${r.id}_${r.coordinates?.length || 0}` : '').join('|');
    const sKey = startPoint && startPoint.lat ? `${Number(startPoint.lat).toFixed(4)},${Number(startPoint.lng).toFixed(4)}` : 'none';
    const eKey = endPoint && endPoint.lat ? `${Number(endPoint.lat).toFixed(4)},${Number(endPoint.lng).toFixed(4)}` : 'none';
    const stopKey = (stoppages || []).map(s => s && s.lat ? `${s.id || s.name || ''}_${Number(s.lat).toFixed(4)}_${Number(s.lng).toFixed(4)}` : '').join('|');
    const tollKey = (tollGates || []).map(t => t && t.lat ? `${t.id || t.name || ''}_${Number(t.lat).toFixed(4)}_${Number(t.lng).toFixed(4)}_${t.charges || ''}` : '').join('|');
    const wayKey = (customWaypoints || []).map(w => w && w.lat ? `${Number(w.lat).toFixed(4)}_${Number(w.lng).toFixed(4)}` : '').join('|');
    return `${selectedRouteId || ''}::${rIds}::${sKey}::${eKey}::${stopKey}::${tollKey}::${wayKey}::${isManualDrawing}::${isTrimMode}::${showBreadcrumbs}::${cutStartIndex}::${cutEndIndex}::${trimSubMode}`;
  }, [routes, selectedRouteId, startPoint, endPoint, stoppages, tollGates, customWaypoints, isManualDrawing, isTrimMode, showBreadcrumbs, cutStartIndex, cutEndIndex, trimSubMode]);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: center,
      zoom: zoom,
      zoomControl: false // Custom controls
    });

    // Default roadmap
    const defaultLayer = L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
      maxZoom: 20,
      subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
      attribution: '© Google Maps'
    });
    defaultLayer.addTo(map);
    layersRef.current['activeTile'] = defaultLayer;

    map.on('click', (e) => {
      if (onMapClick) {
        onMapClick(e.latlng.lat, e.latlng.lng);
      }
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Center update
  useEffect(() => {
    if (mapRef.current && center) {
      mapRef.current.setView(center, mapRef.current.getZoom());
    }
  }, [center?.[0], center?.[1]]);

  // Live Vehicle Marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!vehiclePosition || !vehiclePosition.lat || !vehiclePosition.lng) {
      if (vehicleMarkerRef.current) {
        map.removeLayer(vehicleMarkerRef.current);
        vehicleMarkerRef.current = null;
      }
      prevVehiclePosRef.current = null;
      return;
    }

    const pos = L.latLng(vehiclePosition.lat, vehiclePosition.lng);

    // Calculate heading / road angle
    let heading = 150;
    if (typeof vehiclePosition.heading === 'number' && !isNaN(vehiclePosition.heading)) {
      heading = vehiclePosition.heading;
    } else if (prevVehiclePosRef.current && (prevVehiclePosRef.current.lat !== vehiclePosition.lat || prevVehiclePosRef.current.lng !== vehiclePosition.lng)) {
      heading = calculateBearing(prevVehiclePosRef.current.lat, prevVehiclePosRef.current.lng, vehiclePosition.lat, vehiclePosition.lng);
    } else {
      heading = currentHeadingRef.current;
    }
    prevVehiclePosRef.current = { lat: vehiclePosition.lat, lng: vehiclePosition.lng };
    currentHeadingRef.current = heading;

    // Natural orientation of the 3D truck is ~150 degrees (pointing South-East)
    const rotationAngle = Math.round(((heading - 150) % 360 + 360) % 360);

    const truckIcon = L.divIcon({
      className: 'custom-vehicle-3d-marker',
      html: `
        <div style="width: 44px; height: 44px; position: relative; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.35));">
          <div style="width: 100%; height: 100%; transform: rotate(${rotationAngle}deg); transform-origin: 50% 50%; transition: transform 0.4s ease-out;">
            <img src="/images/truck-3d.png" alt="3D Vehicle" style="width: 100%; height: 100%; object-fit: contain; display: block;" />
          </div>
          ${vehiclePosition.status === 'moving' ? '<span style="position: absolute; bottom: 0px; right: 0px; width: 10px; height: 10px; background-color: #10B981; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 6px #10B981;"></span>' : ''}
        </div>
      `,
      iconSize: [44, 44],
      iconAnchor: [22, 22]
    });

    if (vehicleMarkerRef.current) {
      vehicleMarkerRef.current.setLatLng(pos);
      vehicleMarkerRef.current.setIcon(truckIcon);
    } else {
      const marker = L.marker(pos, { icon: truckIcon, zIndexOffset: 1000 }).addTo(map);
      marker.bindPopup(`
        <div class="p-2">
          <span class="inline-block px-2 py-0.5 text-[10px] font-bold rounded bg-emerald-100 text-emerald-800 uppercase tracking-wide">Vehicle Telemetry</span>
          <h4 class="font-black text-slate-900 text-sm mt-1 font-mono">${vehiclePosition.plate || 'Vehicle'}</h4>
          <div class="flex items-center gap-2 mt-1 text-xs text-slate-600">
            <span>Status: <strong class="text-slate-900">${vehiclePosition.status?.toUpperCase() || 'LIVE'}</strong></span>
            <span>•</span>
            <span>Speed: <strong class="text-slate-900">${vehiclePosition.speed || 0} km/h</strong></span>
          </div>
        </div>
      `);
      vehicleMarkerRef.current = marker;
    }
  }, [vehiclePosition]);

  // Handle Layer switch (Standard vs Satellite vs Terrain)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (layersRef.current['activeTile']) {
      try {
        map.removeLayer(layersRef.current['activeTile']);
      } catch (e) {}
    }

    let tileUrl = 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}';
    if (mapType === 'satellite') {
      tileUrl = 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'; // Google Hybrid
    } else if (mapType === 'terrain') {
      tileUrl = 'https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}'; // Google Terrain
    }

    const newLayer = L.tileLayer(tileUrl, {
      maxZoom: 20,
      subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
      attribution: '© Google Maps'
    });
    newLayer.addTo(map);
    layersRef.current['activeTile'] = newLayer;
  }, [mapType]);

  // Update Markers and Routes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (layersRef.current['routeLayers']) {
      (layersRef.current['routeLayers'] as L.LayerGroup).clearLayers();
    } else {
      layersRef.current['routeLayers'] = L.layerGroup().addTo(map);
    }
    const group = layersRef.current['routeLayers'] as L.LayerGroup;
    const boundsPoints: L.LatLng[] = [];

    // 1. Draw Routes - ONLY render the selected/primary route (Alternative routes are strictly hidden from map)
    const activeRouteToDraw = routes.find(r => r.id === selectedRouteId) || routes[0];
    const routesToRender = activeRouteToDraw ? [activeRouteToDraw] : [];

    routesToRender.forEach((route) => {
      if (!route.coordinates || route.coordinates.length < 2) return;
      const isSelected = route.id === selectedRouteId || routes.length === 1;
      const validCoords = (route.coordinates || [])
        .map(c => Array.isArray(c) ? [Number(c[0]), Number(c[1])] : (c && typeof c === 'object' ? [Number((c as any).lat), Number((c as any).lng)] : null))
        .filter((c): c is [number, number] => c !== null && !isNaN(c[0]) && !isNaN(c[1]));
      if (validCoords.length < 2) return;

      const latLngs = validCoords.map(c => L.latLng(c[0], c[1]));

      if (isSelected) {
        latLngs.forEach(ll => boundsPoints.push(ll));
      }

      if (isSelected) {
        const isBlue = route.color === '#1A73E8' || route.color === '#2563EB' || route.color === '#3B82F6' || !route.color;
        const glowColor = isBlue ? '#93C5FD' : '#FEE2E2';
        const glow = L.polyline(latLngs, {
          color: glowColor,
          weight: 9,
          opacity: 0.6,
          lineCap: 'round',
          lineJoin: 'round'
        });
        glow.addTo(group);
      }

      const polyline = L.polyline(latLngs, {
        color: isSelected ? (route.color || '#1A73E8') : (route.color || '#94A3B8'),
        weight: isSelected ? 6 : 4,
        opacity: isSelected ? 1.0 : 0.65,
        lineCap: 'round',
        lineJoin: 'round'
      });

      polyline.on('click', () => {
        if (onSelectRoute) onSelectRoute(route.id);
      });

      polyline.addTo(group);

      // Telematic Breadcrumb Dots
      if (!hideBreadcrumbs && showBreadcrumbs && isSelected && !isTrimMode && validCoords.length > 0) {
        const step = validCoords.length > 400 ? Math.ceil(validCoords.length / 300) : 1;
        for (let i = 0; i < validCoords.length; i += step) {
          const ll = L.latLng(validCoords[i][0], validCoords[i][1]);
          const dot = L.circleMarker(ll, {
            radius: 3,
            fillColor: '#FFFFFF',
            fillOpacity: 1,
            color: '#EF4444',
            weight: 1.5
          });
          dot.addTo(group);
        }
      }

      // Trim Mode Clickable Markers
      if (!hideEditTools && isTrimMode && isSelected && validCoords.length > 0) {
        const step = validCoords.length > 350 ? Math.ceil(validCoords.length / 250) : 1;
        for (let i = 0; i < validCoords.length; i += step) {
          const coordIdx = i;
          const [tLat, tLng] = validCoords[i];
          const isStart = cutStartIndex === coordIdx;
          const isEnd = cutEndIndex === coordIdx;
          const isInRange = cutStartIndex !== null && cutEndIndex !== null &&
            coordIdx >= Math.min(cutStartIndex, cutEndIndex) && coordIdx <= Math.max(cutStartIndex, cutEndIndex);

          const markerColor = isStart ? '#10B981' : (isEnd ? '#EF4444' : (isInRange ? '#DC2626' : '#2563EB'));
          const radius = isStart || isEnd ? 7 : (isInRange ? 5.5 : 4);

          const dot = L.circleMarker([tLat, tLng], {
            radius,
            fillColor: markerColor,
            fillOpacity: 1,
            color: '#FFFFFF',
            weight: isStart || isEnd ? 2.5 : 1.5
          });

          dot.on('click', () => {
            handleVertexMarkerClick(coordIdx);
          });
          dot.addTo(group);
        }
      }
    });

    // Start Marker
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

      L.marker(p, { icon: startIcon, title: 'Starting Point' }).addTo(group);
    }

    // Destination Marker
    if (endPoint && endPoint.lat && endPoint.lng) {
      const p = L.latLng(endPoint.lat, endPoint.lng);
      boundsPoints.push(p);

      const destIcon = L.divIcon({
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

      L.marker(p, { icon: destIcon, title: 'Destination' }).addTo(group);
    }

    // Stoppages
    stoppages.forEach((stop, idx) => {
      if (!stop.lat || !stop.lng) return;
      const p = L.latLng(stop.lat, stop.lng);
      boundsPoints.push(p);

      const stopIcon = L.divIcon({
        className: 'custom-map-icon',
        html: `
          <div style="background: #F97316; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 11px; border: 2.5px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">
            ${idx + 1}
          </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      L.marker(p, { icon: stopIcon, title: stop.name }).addTo(group);
    });

    // Auto-fit bounds
    const boundsKey = `${startPoint?.lat || ''}_${endPoint?.lat || ''}_${routes.length}`;
    if (boundsPoints.length > 0 && lastFittedBoundsKeyRef.current !== boundsKey && !isTrimMode) {
      lastFittedBoundsKeyRef.current = boundsKey;
      map.fitBounds(L.latLngBounds(boundsPoints), { padding: [40, 40], maxZoom: 14 });
    }
  }, [overlayKey]);

  return (
    <div
      ref={wrapperRef}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={handleDropOnLeaflet}
      className={
        isFullscreen
          ? 'fixed inset-0 z-[99999] w-screen h-screen rounded-none border-none bg-slate-900 flex flex-col overflow-hidden shadow-2xl'
          : 'relative w-full rounded-2xl overflow-hidden border border-slate-200/90 shadow-sm bg-white'
      }
    >
      {/* Map Header Toolbar */}
      <div className="absolute top-3 right-3 z-30 flex items-center gap-1.5 bg-white/95 backdrop-blur-md p-1.5 rounded-xl border border-slate-200 shadow-md">
        {/* Trim Polyline Button */}
        {!hideEditTools && activeCoords.length > 2 && (
          <button
            type="button"
            onClick={() => {
              setIsTrimMode(!isTrimMode);
              setCutStartIndex(null);
              setCutEndIndex(null);
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              isTrimMode
                ? 'bg-amber-500 text-white shadow-xs ring-2 ring-amber-300'
                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
            }`}
            title="Modify Route: Delete wrong lines, detours, or individual points"
          >
            <Scissors className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{isTrimMode ? 'Done Editing' : 'Trim Route Line'}</span>
          </button>
        )}

        {/* Telematic Breadcrumbs Dots Toggle */}
        {!hideEditTools && !hideBreadcrumbs && (
          <button
            type="button"
            onClick={() => setShowBreadcrumbs(!showBreadcrumbs)}
            className={`flex items-center gap-1 px-2 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              showBreadcrumbs
                ? 'bg-red-50 text-[#E60012] border border-red-200'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
            title={showBreadcrumbs ? 'Breadcrumb dots: Visible' : 'Breadcrumb dots: Hidden'}
          >
            <CircleDot className="w-3.5 h-3.5" />
            <span className="hidden md:inline text-[11px]">Dots</span>
          </button>
        )}

        {!hideEditTools && !hideBreadcrumbs && <div className="h-4 w-px bg-slate-200 mx-0.5" />}

        {/* Working Zoom In (+) */}
        <button
          type="button"
          onClick={handleZoomIn}
          className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition active:scale-95 cursor-pointer"
          title="Zoom In (+)"
        >
          <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
        </button>

        {/* Working Zoom Out (-) */}
        <button
          type="button"
          onClick={handleZoomOut}
          className="p-1.5 text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition active:scale-95 cursor-pointer"
          title="Zoom Out (-)"
        >
          <Minus className="w-3.5 h-3.5 stroke-[2.5]" />
        </button>

        <div className="h-4 w-px bg-slate-200 mx-0.5" />

        {/* Map Type Switcher Dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsMapStyleOpen(!isMapStyleOpen)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition cursor-pointer"
            title="Switch Map UI Style"
          >
            <Layers className="w-3.5 h-3.5 text-slate-600" />
            <span className="capitalize hidden sm:inline">{mapType}</span>
          </button>

          {isMapStyleOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-36 bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-50 text-xs">
              <button
                type="button"
                onClick={() => { setMapType('standard'); setIsMapStyleOpen(false); }}
                className={`w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-slate-50 transition cursor-pointer ${
                  mapType === 'standard' ? 'font-bold text-[#E60012] bg-red-50/50' : 'text-slate-700'
                }`}
              >
                <MapIcon className="w-3.5 h-3.5" />
                <span>Roadmap</span>
              </button>
              <button
                type="button"
                onClick={() => { setMapType('satellite'); setIsMapStyleOpen(false); }}
                className={`w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-slate-50 transition cursor-pointer ${
                  mapType === 'satellite' ? 'font-bold text-[#E60012] bg-red-50/50' : 'text-slate-700'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                <span>Satellite</span>
              </button>
              <button
                type="button"
                onClick={() => { setMapType('terrain'); setIsMapStyleOpen(false); }}
                className={`w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-slate-50 transition cursor-pointer ${
                  mapType === 'terrain' ? 'font-bold text-[#E60012] bg-red-50/50' : 'text-slate-700'
                }`}
              >
                <Mountain className="w-3.5 h-3.5" />
                <span>Terrain</span>
              </button>
            </div>
          )}
        </div>

        <div className="h-4 w-px bg-slate-200 mx-0.5" />

        {/* Fullscreen Toggle */}
        <button
          type="button"
          onClick={handleToggleFullscreen}
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition active:scale-95 cursor-pointer"
          title={isFullscreen ? 'Exit Fullscreen (Esc)' : 'Expand Fullscreen'}
        >
          {isFullscreen ? <Minimize2 className="w-3.5 h-3.5 text-red-600" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Floating Trim / Delete Route Line Control Bar */}
      {!hideEditTools && isTrimMode && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 max-w-xl w-[92%] bg-slate-900/95 text-white backdrop-blur-md px-4 py-2.5 rounded-2xl shadow-2xl border border-slate-700 flex flex-wrap items-center justify-between gap-3 animate-in fade-in slide-in-from-top duration-200">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 bg-slate-800 p-0.5 rounded-lg border border-slate-700">
              <button
                type="button"
                onClick={() => { setTrimSubMode('single'); setCutStartIndex(null); setCutEndIndex(null); }}
                className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition cursor-pointer ${
                  trimSubMode === 'single' ? 'bg-[#E60012] text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                Single Point
              </button>
              <button
                type="button"
                onClick={() => { setTrimSubMode('range'); setCutStartIndex(null); setCutEndIndex(null); }}
                className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition cursor-pointer ${
                  trimSubMode === 'range' ? 'bg-[#E60012] text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                Section Cut (A → B)
              </button>
            </div>

            <span className="text-[11px] text-slate-300">
              {trimSubMode === 'single' && '👉 Click any point on route to delete it'}
              {trimSubMode === 'range' && !cutStartIndex && '👉 Click 1st point (Cut Start)'}
              {trimSubMode === 'range' && cutStartIndex !== null && cutEndIndex === null && '👉 Click 2nd point (Cut End)'}
              {trimSubMode === 'range' && cutStartIndex !== null && cutEndIndex !== null && (
                <span className="text-amber-400 font-bold">
                  {Math.abs(cutEndIndex - cutStartIndex) + 1} points selected
                </span>
              )}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {trimSubMode === 'range' && cutStartIndex !== null && cutEndIndex !== null && (
              <button
                type="button"
                onClick={handleConfirmRangeDelete}
                className="flex items-center gap-1 px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs font-black rounded-lg transition shadow-xs cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Section</span>
              </button>
            )}

            {undoHistory.length > 0 && (
              <button
                type="button"
                onClick={handleUndo}
                className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition border border-slate-700 cursor-pointer"
                title="Undo last delete"
              >
                <Undo2 className="w-3 h-3" />
                <span>Undo</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => { setIsTrimMode(false); setCutStartIndex(null); setCutEndIndex(null); }}
              className="flex items-center gap-1 px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition shadow-xs cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Done</span>
            </button>
          </div>
        </div>
      )}

      {/* Mode Indicator Overlay */}
      {clickMode !== 'none' && clickMode !== 'manual-route' && (
        <div className="absolute top-3 left-3 z-20 bg-white/95 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-200 shadow-md flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-red-600" />
          <span className="text-xs font-bold text-slate-800">
            {clickMode === 'start' && 'Click map to place Start Location (Green Flag)'}
            {clickMode === 'end' && 'Click map to place Destination (Red Flag)'}
            {clickMode === 'stop' && 'Click map to place Stoppage'}
            {clickMode === 'toll' && 'Click map to place FASTag Toll Gate'}
          </span>
        </div>
      )}

      {/* Street View Pegman Floating Action in Bottom-Right Corner */}
      <div
        className="absolute bottom-5 right-4 z-30 group"
        title="Direct Click: 360° Street View at Vehicle Position | Drag & Drop: Street View anywhere on map"
      >
        <div
          draggable={true}
          onDragStart={(e) => {
            setIsDraggingPegman(true);
            e.dataTransfer.setData('text/plain', 'pegman');
            e.dataTransfer.effectAllowed = 'copyMove';
          }}
          onDragEnd={() => setIsDraggingPegman(false)}
          onClick={handlePegmanClick}
          className={`w-10 h-10 bg-white/95 hover:bg-white active:scale-95 rounded-xl shadow-lg border border-slate-200/90 flex items-center justify-center cursor-grab active:cursor-grabbing transition-all select-none hover:shadow-xl ${
            isDraggingPegman ? 'scale-110 ring-2 ring-amber-500 shadow-amber-500/20' : ''
          }`}
        >
          <img
            src="/images/pegman.png"
            alt="Street View Pegman"
            className="w-6 h-6 object-contain pointer-events-none drop-shadow-xs"
            onError={(e) => {
              (e.currentTarget as HTMLElement).style.display = 'none';
            }}
          />
        </div>
        {/* Tooltip on hover */}
        <div className="absolute right-12 bottom-1/2 translate-y-1/2 hidden group-hover:flex items-center whitespace-nowrap bg-slate-900/90 backdrop-blur-md text-white text-[11px] font-semibold px-2.5 py-1 rounded-lg shadow-lg border border-slate-700 pointer-events-none transition-all">
          Click: Vehicle Street View | Drag: Drop on Map
        </div>
      </div>

      {/* Street View Modal Viewer */}
      {streetViewCoord && (
        <div className="absolute inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex flex-col animate-in fade-in duration-200">
          {/* Top Bar */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900 border-b border-slate-800 text-white">
            <div className="flex items-center gap-2">
              <img src="/images/pegman.png" alt="Pegman" className="w-5 h-5 object-contain" />
              <span className="text-xs font-bold tracking-wide">360° Street View</span>
              <span className="text-[11px] text-slate-400 font-mono hidden sm:inline">
                ({streetViewCoord.lat.toFixed(5)}, {streetViewCoord.lng.toFixed(5)})
              </span>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${streetViewCoord.lat},${streetViewCoord.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition"
                title="Open in Google Maps new tab"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Open in Maps</span>
              </a>
              <button
                type="button"
                onClick={() => setStreetViewCoord(null)}
                className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition cursor-pointer"
                title="Close Street View"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Iframe View */}
          <div className="flex-1 w-full h-full relative bg-slate-900">
            <iframe
              title="Google Street View"
              width="100%"
              height="100%"
              style={{ border: 0 }}
              loading="lazy"
              allowFullScreen
              src={`https://maps.google.com/maps?q=&layer=c&cbll=${streetViewCoord.lat},${streetViewCoord.lng}&cbp=11,0,0,0,0&output=svembed`}
            />
          </div>
        </div>
      )}

      {/* Leaflet Container */}
      <div
        ref={mapContainerRef}
        style={{ height: isFullscreen ? '100vh' : height, width: '100%' }}
        className="w-full flex-1 z-0"
      />
    </div>
  );
};
