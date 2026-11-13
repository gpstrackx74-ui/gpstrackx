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

// Smoothly deform coordinates when a control dot is dragged
function deformPolylineSmooth(
  coords: [number, number][],
  centerIdx: number,
  prevIdx: number,
  nextIdx: number,
  targetLat: number,
  targetLng: number
): [number, number][] {
  const orig = coords[centerIdx];
  if (!orig) return coords;
  const dLat = targetLat - orig[0];
  const dLng = targetLng - orig[1];

  return coords.map(([lat, lng], j) => {
    if (j < prevIdx || j > nextIdx) return [lat, lng];

    let w = 0;
    if (j <= centerIdx) {
      const span = centerIdx - prevIdx;
      const t = span <= 0 ? 1 : (j - prevIdx) / span;
      w = 0.5 * (1 - Math.cos(Math.PI * t));
    } else {
      const span = nextIdx - centerIdx;
      const t = span <= 0 ? 1 : (nextIdx - j) / span;
      w = 0.5 * (1 - Math.cos(Math.PI * t));
    }

    return [
      parseFloat((lat + dLat * w).toFixed(6)),
      parseFloat((lng + dLng * w).toFixed(6))
    ];
  });
}

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
  searchLocation?: { lat: number; lng: number; name?: string; address?: string } | null;
  onUpdateTollPrice?: (tollName: string, newPrice: number) => void;
  onDeleteToll?: (toll: TollGate) => void;
  onRouteChange?: (updated: { coordinates: [number, number][]; distanceKm: number; timeMinutes: number; summary?: string }) => void;
  height?: string;
}

const GooglePegmanSvg: React.FC<{ className?: string }> = ({ className = "w-6 h-7" }) => (
  <svg
    viewBox="0 0 24 32"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Ground drop shadow */}
    <ellipse cx="12" cy="30" rx="6.5" ry="1.5" fill="#000000" fillOpacity="0.18" />
    {/* Head */}
    <circle cx="12" cy="6" r="4" fill="#F4B400" stroke="#755100" strokeWidth="0.9" />
    {/* Body, Arms & Legs */}
    <path
      d="M7 11.2C5.9 11.2 5 12.1 5 13.2V18.5C5 19.33 5.67 20 6.5 20C7.33 20 8 19.33 8 18.5V14.8H9V28C9 28.83 9.67 29.5 10.5 29.5C11.33 29.5 12 28.83 12 28V20.5H12V28C12 28.83 12.67 29.5 13.5 29.5C14.33 29.5 15 28.83 15 28V14.8H16V18.5C16 19.33 16.67 20 17.5 20C18.33 20 19 19.33 19 18.5V13.2C19 12.1 18.1 11.2 17 11.2H7Z"
      fill="#F4B400"
      stroke="#755100"
      strokeWidth="0.9"
      strokeLinejoin="round"
    />
    {/* Iconic Orange Tie */}
    <polygon points="12,11.2 10.4,15.8 12,17.2 13.6,15.8" fill="#E37400" />
  </svg>
);

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
  searchLocation,
  onUpdateTollPrice,
  onDeleteToll,
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
  const droppedPegmanMarkerRef = useRef<L.Marker | null>(null);

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

  const openStreetViewAtCoord = (targetLat: number, targetLng: number) => {
    setStreetViewCoord({ lat: targetLat, lng: targetLng });

    const map = mapRef.current;
    if (map) {
      if (droppedPegmanMarkerRef.current) {
        droppedPegmanMarkerRef.current.remove();
        droppedPegmanMarkerRef.current = null;
      }
      try {
        const pIcon = L.icon({
          iconUrl: '/images/pegman.svg',
          iconSize: [26, 34],
          iconAnchor: [13, 32]
        });
        const marker = L.marker([targetLat, targetLng], {
          icon: pIcon,
          title: `360° Street View (${targetLat.toFixed(4)}, ${targetLng.toFixed(4)})`,
          zIndexOffset: 500
        }).addTo(map);

        marker.on('click', () => {
          const url = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${targetLat},${targetLng}`;
          window.open(url, '_blank');
        });
        droppedPegmanMarkerRef.current = marker;
      } catch (_) {}
    }

    const url = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${targetLat},${targetLng}`;
    try {
      const win = window.open(url, '_blank');
      if (win) win.focus();
    } catch (_) {}
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
      openStreetViewAtCoord(targetLat, targetLng);
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
        openStreetViewAtCoord(latLng.lat, latLng.lng);
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

  // Center & zoom update
  useEffect(() => {
    if (mapRef.current && center) {
      mapRef.current.setView(center, typeof zoom === 'number' && zoom > 0 ? zoom : mapRef.current.getZoom());
    }
  }, [center?.[0], center?.[1], zoom]);

  // Search Location Pin
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (layersRef.current['search_marker']) {
      map.removeLayer(layersRef.current['search_marker']);
      delete layersRef.current['search_marker'];
    }
    if (searchLocation && searchLocation.lat && searchLocation.lng) {
      const searchIcon = L.divIcon({
        className: 'search-location-pin',
        html: `
          <div style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;background:#2563EB;border:3px solid #FFFFFF;border-radius:50%;box-shadow:0 4px 12px rgba(37,99,235,0.5);">
            <svg style="width:16px;height:16px;color:#FFFFFF;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -16]
      });
      const marker = L.marker([searchLocation.lat, searchLocation.lng], { icon: searchIcon, zIndexOffset: 9000 });
      marker.bindPopup(`
        <div style="font-family: 'Plus Jakarta Sans', sans-serif; padding: 4px;">
          <div style="font-size: 10px; font-weight: bold; color: #2563EB; text-transform: uppercase;">📍 Searched Location</div>
          <div style="font-size: 13px; font-weight: bold; color: #0F172A; margin-top: 2px;">${searchLocation.name || 'Location'}</div>
          ${searchLocation.address ? `<div style="font-size: 11px; color: #64748B; margin-top: 2px;">${searchLocation.address}</div>` : ''}
        </div>
      `);
      marker.addTo(map);
      marker.openPopup();
      layersRef.current['search_marker'] = marker;
    }
  }, [searchLocation]);

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

      // Telematic & Draggable Breadcrumb Dots
      if (!hideBreadcrumbs && showBreadcrumbs && isSelected && !isTrimMode && validCoords.length > 1) {
        // 1. Background telematic dots
        const bgStep = validCoords.length > 400 ? Math.ceil(validCoords.length / 300) : 1;
        for (let i = 0; i < validCoords.length; i += bgStep) {
          const ll = L.latLng(validCoords[i][0], validCoords[i][1]);
          const dot = L.circleMarker(ll, {
            radius: 2,
            fillColor: '#FFFFFF',
            fillOpacity: 0.9,
            color: route.color || (isSelected ? '#1A73E8' : '#E60012'),
            weight: 1
          });
          dot.addTo(group);
        }

        // 2. Interactive Draggable Control Dots
        const totalPts = validCoords.length;
        const targetDotCount = totalPts <= 25 ? Math.max(1, totalPts - 2) : Math.min(28, Math.max(8, Math.floor(totalPts / 18)));
        const ctrlStep = targetDotCount > 0 ? Math.max(1, Math.floor((totalPts - 1) / (targetDotCount + 1))) : 1;

        const dotIndices: number[] = [];
        if (totalPts <= 15) {
          for (let i = 1; i < totalPts - 1; i++) dotIndices.push(i);
        } else {
          for (let i = ctrlStep; i < totalPts - 1; i += ctrlStep) {
            dotIndices.push(i);
          }
        }

        const dotColor = route.color || (isSelected ? '#1A73E8' : '#E60012');
        const dotIcon = L.divIcon({
          className: 'draggable-route-dot',
          html: `<div style="width: 12px; height: 12px; border-radius: 50%; background: #FFFFFF; border: 2.5px solid ${dotColor}; box-shadow: 0 1px 4px rgba(0,0,0,0.35); cursor: grab;"></div>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6]
        });

        dotIndices.forEach((dotIdx, k) => {
          const pt = validCoords[dotIdx];
          if (!pt) return;
          const prevIdx = k > 0 ? dotIndices[k - 1] : 0;
          const nextIdx = k < dotIndices.length - 1 ? dotIndices[k + 1] : totalPts - 1;

          const dotMarker = L.marker([pt[0], pt[1]], {
            draggable: true,
            icon: dotIcon,
            title: `Waypoint Dot #${k + 1} - Drag to modify route`
          });

          dotMarker.on('drag', (e: any) => {
            const ll = e.latlng;
            const deformed = deformPolylineSmooth(validCoords, dotIdx, prevIdx, nextIdx, ll.lat, ll.lng);
            polyline.setLatLngs(deformed.map(([lat, lng]) => L.latLng(lat, lng)));
          });

          dotMarker.on('dragend', (e: any) => {
            const ll = e.latlng;
            const deformed = deformPolylineSmooth(validCoords, dotIdx, prevIdx, nextIdx, ll.lat, ll.lng);
            const newDistKm = calculateCumulativeDistanceKm(deformed);
            const newTimeMins = calculateDurationMinutes(newDistKm, 45);
            if (onRouteChangeRef.current) {
              onRouteChangeRef.current({
                coordinates: deformed,
                distanceKm: newDistKm,
                timeMinutes: newTimeMins,
                summary: 'Route Modified via Draggable Dots'
              });
            }
          });

          dotMarker.addTo(group);
        });
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

    // --- LIVE MANUAL ROUTE DRAWING: Polyline & Waypoints Layer ---
    if ((isManualDrawing || (customWaypoints && customWaypoints.length > 0))) {
      const livePathPts: L.LatLng[] = [];
      if (startPoint?.lat && startPoint?.lng) {
        livePathPts.push(L.latLng(startPoint.lat, startPoint.lng));
      }
      (customWaypoints || []).forEach((wp) => {
        if (wp.lat && wp.lng) {
          if (!startPoint || Math.abs(startPoint.lat - wp.lat) > 0.0001 || Math.abs(startPoint.lng - wp.lng) > 0.0001) {
            livePathPts.push(L.latLng(wp.lat, wp.lng));
          }
        }
      });
      if (endPoint?.lat && endPoint?.lng && !isManualDrawing) {
        livePathPts.push(L.latLng(endPoint.lat, endPoint.lng));
      }

      if (livePathPts.length >= 2) {
        // Casing
        L.polyline(livePathPts, {
          color: '#FFFFFF',
          weight: 7,
          opacity: 0.9
        }).addTo(group);

        // Active Red Polyline
        L.polyline(livePathPts, {
          color: '#EF4444',
          weight: 4.5,
          opacity: 1.0
        }).addTo(group);
      }

      // Render numbered markers at each clicked point
      (customWaypoints || []).forEach((wp, idx) => {
        if (!wp.lat || !wp.lng) return;
        const p = L.latLng(wp.lat, wp.lng);
        boundsPoints.push(p);

        const isStart = startPoint && Math.abs(startPoint.lat - wp.lat) < 0.0001 && Math.abs(startPoint.lng - wp.lng) < 0.0001;
        if (isStart) return;

        const wpIcon = L.divIcon({
          className: 'custom-wp-pin',
          html: `<div style="background:#EF4444;color:#fff;border:2px solid #fff;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;box-shadow:0 1px 4px rgba(0,0,0,0.4);">${idx + 1}</div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        });
        L.marker(p, { icon: wpIcon, title: `Custom Point #${idx + 1}` }).addTo(group);
      });
    }

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

    // Toll Gates (Interactive Marker with Hover & Click Price Edit)
    tollGates.forEach((toll) => {
      if (!toll.lat || !toll.lng) return;
      const p = L.latLng(toll.lat, toll.lng);
      boundsPoints.push(p);

      const tollIcon = L.divIcon({
        className: 'custom-toll-icon',
        html: `
          <div style="background: #D97706; color: white; width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 13px; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.35);">
            🛑
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -14]
      });

      const m = L.marker(p, { icon: tollIcon, title: `${toll.name} (FASTag Toll Plaza) - ₹${toll.charges || 0}` });
      const safeId = (toll.id || toll.name).toString().replace(/[^a-zA-Z0-9]/g, '');
      m.bindPopup(`
        <div style="font-family: 'Plus Jakarta Sans', sans-serif; min-width: 190px; padding: 4px;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <div style="font-size: 10px; font-weight: bold; color: #D97706; text-transform: uppercase;">🛑 NHAI FASTag Toll Plaza</div>
            ${onDeleteToll ? `<button id="leaf-toll-del-${safeId}" style="background: #FEE2E2; border: 1px solid #FECACA; color: #DC2626; font-size: 10px; font-weight: 700; cursor: pointer; padding: 1px 6px; border-radius: 4px;" title="Delete Toll">✕ Delete</button>` : ''}
          </div>
          <div style="font-size: 13px; font-weight: 800; color: #0F172A; margin-top: 2px;">${toll.name}</div>
          <div style="font-size: 10px; color: #64748B; margin-top: 2px;">GPS: ${Number(toll.lat).toFixed(4)}, ${Number(toll.lng).toFixed(4)}</div>
          <div style="margin-top: 8px; padding-top: 6px; border-top: 1px solid #E2E8F0; display: flex; align-items: center; justify-content: space-between; gap: 6px;">
            <span style="font-size: 11px; font-weight: bold; color: #334155;">Toll Tariff:</span>
            <div style="display: flex; align-items: center; gap: 4px;">
              <span style="font-size: 12px; font-weight: bold; color: #16A34A;">₹</span>
              <input type="number" min="0" value="${toll.charges || 0}" id="leaf-toll-input-${safeId}" style="width: 65px; padding: 2px 4px; font-size: 12px; font-weight: bold; font-family: monospace; border: 1px solid #CBD5E1; border-radius: 6px; text-align: right;" />
              <button id="leaf-toll-btn-${safeId}" style="padding: 2px 6px; font-size: 10px; font-weight: bold; background: #E60012; color: white; border: none; border-radius: 6px; cursor: pointer;">Save</button>
            </div>
          </div>
        </div>
      `);
      m.on('popupopen', () => {
        const delBtn = document.getElementById(`leaf-toll-del-${safeId}`);
        if (delBtn) {
          delBtn.onclick = () => {
            m.closePopup();
            group.removeLayer(m);
            if (onDeleteToll) onDeleteToll(toll);
          };
        }
        const btn = document.getElementById(`leaf-toll-btn-${safeId}`);
        const input = document.getElementById(`leaf-toll-input-${safeId}`) as HTMLInputElement;
        if (btn && input) {
          btn.onclick = () => {
            const val = parseFloat(input.value);
            if (!isNaN(val) && onUpdateTollPrice) {
              onUpdateTollPrice(toll.name, val);
            }
          };
          input.onchange = () => {
            const val = parseFloat(input.value);
            if (!isNaN(val) && onUpdateTollPrice) {
              onUpdateTollPrice(toll.name, val);
            }
          };
        }
      });
      m.on('mouseover', () => m.openPopup());
      m.addTo(group);
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

      {/* 360° Street View Active Banner */}
      {streetViewCoord && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 text-white px-4 py-2 rounded-2xl text-xs font-semibold shadow-2xl border border-slate-700/80 flex items-center gap-3 backdrop-blur-md animate-in fade-in slide-in-from-top duration-200">
          <div className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-amber-400">360° Street View:</span>
            <span className="font-mono text-slate-300">({streetViewCoord.lat.toFixed(4)}, {streetViewCoord.lng.toFixed(4)})</span>
          </div>
          <a
            href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${streetViewCoord.lat},${streetViewCoord.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-2.5 py-1 bg-[#E60012] hover:bg-[#CC0010] text-white rounded-lg font-bold text-[11px] transition flex items-center gap-1 cursor-pointer"
          >
            <span>Open HD 360° View</span>
            <ExternalLink className="w-3 h-3" />
          </a>
          <button
            type="button"
            onClick={() => {
              setStreetViewCoord(null);
              if (droppedPegmanMarkerRef.current) {
                droppedPegmanMarkerRef.current.remove();
                droppedPegmanMarkerRef.current = null;
              }
            }}
            className="text-slate-400 hover:text-white p-1 rounded-md transition cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Street View Pegman Floating Action in Bottom-Right Corner (Google Maps Default Style) */}
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
          className={`w-10 h-10 bg-white hover:bg-slate-50 active:scale-95 rounded-lg shadow-[0_2px_6px_rgba(0,0,0,0.3)] border border-slate-200/90 flex items-center justify-center cursor-grab active:cursor-grabbing transition-all select-none hover:shadow-lg ${
            isDraggingPegman ? 'scale-110 ring-2 ring-amber-500 shadow-amber-500/20' : ''
          }`}
        >
          <GooglePegmanSvg className="w-5 h-6 drop-shadow-xs" />
        </div>
        {/* Tooltip on hover */}
        <div className="absolute right-12 bottom-1/2 translate-y-1/2 hidden group-hover:flex items-center whitespace-nowrap bg-slate-900/90 backdrop-blur-md text-white text-[11px] font-semibold px-2.5 py-1 rounded-lg shadow-lg border border-slate-700 pointer-events-none transition-all">
          Click: Vehicle Street View | Drag: Drop on Map
        </div>
      </div>

      {/* Leaflet Container */}
      <div
        ref={mapContainerRef}
        style={{ height: isFullscreen ? '100vh' : height, width: '100%' }}
        className="w-full flex-1 z-0"
      />
    </div>
  );
};
