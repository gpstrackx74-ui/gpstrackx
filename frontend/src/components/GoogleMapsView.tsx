import React, { useEffect, useRef, useState } from 'react';
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
  X,
  CircleDot,
  Trash2,
  Map as MapIcon,
  Globe,
  Mountain
} from 'lucide-react';
import {
  deleteSinglePoint,
  deletePointRange,
  calculateCumulativeDistanceKm,
  calculateDurationMinutes
} from '../utils/routePolylineUtils';

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
  center = { lat: 21.8974, lng: 82.8000 },
  zoom = 7,
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
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const polylinesRef = useRef<any[]>([]);
  const markersRef = useRef<any[]>([]);
  const trimMarkersRef = useRef<any[]>([]);
  const vehicleMarkerRef = useRef<any>(null);
  const geocoderRef = useRef<any>(null);
  const activeInfoWindowRef = useRef<any>(null);
  const lastFittedKeyRef = useRef<string>('');

  // Map controls state
  const [mapType, setMapType] = useState<'roadmap' | 'hybrid' | 'terrain'>('roadmap');
  const [isMapStyleOpen, setIsMapStyleOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showBreadcrumbs, setShowBreadcrumbs] = useState(true);

  // Polyline deletion / trim state
  const [isTrimMode, setIsTrimMode] = useState(false);
  const [trimSubMode, setTrimSubMode] = useState<'single' | 'range'>('single');
  const [cutStartIndex, setCutStartIndex] = useState<number | null>(null);
  const [cutEndIndex, setCutEndIndex] = useState<number | null>(null);
  const [undoHistory, setUndoHistory] = useState<Array<{ coordinates: [number, number][]; distanceKm: number; timeMinutes: number }>>([]);

  // Active route coordinates
  const activeRoute = React.useMemo(() => {
    return routes.find(r => r.id === selectedRouteId) || routes[0];
  }, [routes, selectedRouteId]);

  const activeCoords: [number, number][] = React.useMemo(() => {
    if (!activeRoute?.coordinates) return [];
    return (activeRoute.coordinates || [])
      .map(c => Array.isArray(c) ? [Number(c[0]), Number(c[1])] : (c && typeof c === 'object' ? [Number((c as any).lat), Number((c as any).lng)] : null))
      .filter((c): c is [number, number] => c !== null && !isNaN(c[0]) && !isNaN(c[1]));
  }, [activeRoute?.coordinates]);

  // Stable overlay key
  const overlayKey = React.useMemo(() => {
    const rIds = (routes || []).map(r => r ? `${r.id}_${r.coordinates?.length || 0}` : '').join('|');
    const sKey = startPoint && startPoint.lat ? `${Number(startPoint.lat).toFixed(4)},${Number(startPoint.lng).toFixed(4)}` : 'none';
    const eKey = endPoint && endPoint.lat ? `${Number(endPoint.lat).toFixed(4)},${Number(endPoint.lng).toFixed(4)}` : 'none';
    const stopKey = (stoppages || []).map(s => s && s.lat ? `${s.id || s.name || ''}_${Number(s.lat).toFixed(4)}_${Number(s.lng).toFixed(4)}` : '').join('|');
    const tollKey = (tollGates || []).map(t => t && t.lat ? `${t.id || t.name || ''}_${Number(t.lat).toFixed(4)}_${Number(t.lng).toFixed(4)}_${t.charges || ''}` : '').join('|');
    const parkKey = (parkingPoints || []).map(p => p && p.lat ? `${p.id || p.name || ''}_${Number(p.lat).toFixed(4)}_${Number(p.lng).toFixed(4)}` : '').join('|');
    const wayKey = (customWaypoints || []).map(w => w && w.lat ? `${Number(w.lat).toFixed(4)}_${Number(w.lng).toFixed(4)}` : '').join('|');
    return `${selectedRouteId || ''}::${rIds}::${sKey}::${eKey}::${stopKey}::${tollKey}::${parkKey}::${wayKey}::${isManualDrawing}::${isTrimMode}::${showBreadcrumbs}::${cutStartIndex}::${cutEndIndex}::${trimSubMode}`;
  }, [routes, selectedRouteId, startPoint, endPoint, stoppages, tollGates, parkingPoints, customWaypoints, isManualDrawing, isTrimMode, showBreadcrumbs, cutStartIndex, cutEndIndex, trimSubMode]);

  // Zoom handlers
  const handleZoomIn = () => {
    if (mapInstanceRef.current) {
      const z = mapInstanceRef.current.getZoom() || 10;
      mapInstanceRef.current.setZoom(z + 1);
    }
  };

  const handleZoomOut = () => {
    if (mapInstanceRef.current) {
      const z = mapInstanceRef.current.getZoom() || 10;
      mapInstanceRef.current.setZoom(Math.max(1, z - 1));
    }
  };

  // Fullscreen toggle
  const handleToggleFullscreen = () => {
    const next = !isFullscreen;
    setIsFullscreen(next);

    try {
      if (next) {
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

  // Handle map resize when fullscreen state toggles
  useEffect(() => {
    const t1 = setTimeout(() => {
      if (mapInstanceRef.current && (window as any).google?.maps) {
        google.maps.event.trigger(mapInstanceRef.current, 'resize');
        const c = mapInstanceRef.current.getCenter();
        if (c) mapInstanceRef.current.setCenter(c);
      }
    }, 120);

    const t2 = setTimeout(() => {
      if (mapInstanceRef.current && (window as any).google?.maps) {
        google.maps.event.trigger(mapInstanceRef.current, 'resize');
      }
    }, 350);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isFullscreen]);

  // Set Google Maps type
  const handleSelectMapType = (type: 'roadmap' | 'hybrid' | 'terrain') => {
    setMapType(type);
    setIsMapStyleOpen(false);
    if (!mapInstanceRef.current || typeof (window as any).google?.maps === 'undefined') return;

    try {
      if (type === 'hybrid') {
        mapInstanceRef.current.setMapTypeId(google.maps.MapTypeId.HYBRID);
      } else if (type === 'terrain') {
        mapInstanceRef.current.setMapTypeId(google.maps.MapTypeId.TERRAIN);
      } else {
        mapInstanceRef.current.setMapTypeId(google.maps.MapTypeId.ROADMAP);
      }
    } catch (e) {
      console.warn('Could not set Google Maps mapTypeId:', e);
    }
  };

  // Center sync
  useEffect(() => {
    if (mapInstanceRef.current && center && center.lat && center.lng) {
      mapInstanceRef.current.panTo(center);
    }
  }, [center?.lat, center?.lng]);

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

  // --- Polyline Trimming and Wrong Segment Deletion ---
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
        // If both were set, start new selection
        setCutStartIndex(index);
        setCutEndIndex(null);
      }
    }
  };

  // Initialize Map
  useEffect(() => {
    if (!containerRef.current) return;
    if (mapInstanceRef.current) return;
    if (typeof (window as any).google?.maps === 'undefined') return;

    try {
      geocoderRef.current = new google.maps.Geocoder();
    } catch (e) {}

    const map = new google.maps.Map(containerRef.current, {
      center,
      zoom,
      mapTypeId: google.maps.MapTypeId.ROADMAP,
      disableDefaultUI: true, // We provide clean custom UI controls
      zoomControl: false,
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

      const defaultName = `Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
      if (onMapClickRef.current) {
        onMapClickRef.current(lat, lng, defaultName, currentMode);
      }

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
    trimMarkersRef.current.forEach(m => m.setMap(null));
    trimMarkersRef.current = [];
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

    // 1. Draw Routes
    routes.forEach((route) => {
      if (!route.coordinates || route.coordinates.length < 2) return;
      const validCoords = (route.coordinates || [])
        .map(c => Array.isArray(c) ? [Number(c[0]), Number(c[1])] : (c && typeof c === 'object' ? [Number((c as any).lat), Number((c as any).lng)] : null))
        .filter((c): c is [number, number] => c !== null && !isNaN(c[0]) && !isNaN(c[1]));
      if (validCoords.length < 2) return;

      const isSelected = route.id === selectedRouteId || routes.length === 1;
      const path = validCoords.map(([lat, lng]) => new google.maps.LatLng(lat, lng));

      for (let i = 0; i < path.length; i += 8) {
        bounds.extend(path[i]);
        hasPoints = true;
      }
      bounds.extend(path[path.length - 1]);

      if (isSelected) {
        const isBlue = route.color === '#1A73E8' || route.color === '#2563EB' || route.color === '#3B82F6' || !route.color;
        const glowColor = isBlue ? '#93C5FD' : '#FEE2E2';
        const glow = new google.maps.Polyline({
          path,
          strokeColor: glowColor,
          strokeOpacity: 0.6,
          strokeWeight: 9,
          map,
          zIndex: 10
        });
        polylinesRef.current.push(glow);
      }

      const polyline = new google.maps.Polyline({
        path,
        strokeColor: route.color || (isSelected ? '#1A73E8' : '#3B82F6'),
        strokeOpacity: isSelected ? 1.0 : 0.85,
        strokeWeight: isSelected ? 6 : 4.5,
        map,
        zIndex: isSelected ? 30 : 15,
        editable: Boolean(isSelected && (isDraggableRoute || isTrimMode)),
        draggable: false
      });

      // Interactive polyline vertex drag and right-click delete
      if (isSelected && (isDraggableRoute || isTrimMode)) {
        const mvcPath = polyline.getPath();
        const onPathChange = () => {
          const updatedCoords: [number, number][] = [];
          const count = mvcPath.getLength();
          for (let i = 0; i < count; i++) {
            const pt = mvcPath.getAt(i);
            updatedCoords.push([parseFloat(pt.lat().toFixed(6)), parseFloat(pt.lng().toFixed(6))]);
          }
          const updatedDistKm = calculateCumulativeDistanceKm(updatedCoords);
          const updatedTimeMins = calculateDurationMinutes(updatedDistKm, 45);
          if (onRouteChangeRef.current) {
            onRouteChangeRef.current({
              coordinates: updatedCoords,
              distanceKm: updatedDistKm,
              timeMinutes: updatedTimeMins,
              summary: 'Route Modified via Map'
            });
          }
        };

        mvcPath.addListener('set_at', onPathChange);
        mvcPath.addListener('insert_at', onPathChange);
        mvcPath.addListener('remove_at', onPathChange);

        // Right click on vertex removes it directly!
        polyline.addListener('contextmenu', (e: any) => {
          if (e.vertex != null) {
            setUndoHistory(prev => [
              ...prev,
              {
                coordinates: validCoords,
                distanceKm: route.distanceKm || calculateCumulativeDistanceKm(validCoords),
                timeMinutes: route.timeMinutes || calculateDurationMinutes(calculateCumulativeDistanceKm(validCoords))
              }
            ]);
            mvcPath.removeAt(e.vertex);
          }
        });
      }

      polyline.addListener('click', (e: any) => {
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

      // --- Telematic Breadcrumbs Dots Layer (Matching authentic GPS telematics) ---
      if (showBreadcrumbs && isSelected && !isTrimMode && validCoords.length > 0) {
        const step = validCoords.length > 500 ? Math.ceil(validCoords.length / 380) : 1;
        for (let i = 0; i < validCoords.length; i += step) {
          const [bLat, bLng] = validCoords[i];
          const bMarker = new google.maps.Marker({
            position: new google.maps.LatLng(bLat, bLng),
            map,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 3,
              fillColor: '#FFFFFF',
              fillOpacity: 1,
              strokeColor: '#EF4444',
              strokeWeight: 1.8
            },
            zIndex: 25,
            clickable: false
          });
          markersRef.current.push(bMarker);
        }
      }

      // --- Interactive Trim / Point Deletion Markers ---
      if (isTrimMode && isSelected && validCoords.length > 0) {
        const step = validCoords.length > 400 ? Math.ceil(validCoords.length / 300) : 1;
        for (let i = 0; i < validCoords.length; i += step) {
          const coordIdx = i;
          const [tLat, tLng] = validCoords[i];
          const isStart = cutStartIndex === coordIdx;
          const isEnd = cutEndIndex === coordIdx;
          const isInRange = cutStartIndex !== null && cutEndIndex !== null &&
            coordIdx >= Math.min(cutStartIndex, cutEndIndex) && coordIdx <= Math.max(cutStartIndex, cutEndIndex);

          const markerColor = isStart ? '#10B981' : (isEnd ? '#EF4444' : (isInRange ? '#DC2626' : '#2563EB'));
          const scale = isStart || isEnd ? 7 : (isInRange ? 5.5 : 4);

          const tMarker = new google.maps.Marker({
            position: new google.maps.LatLng(tLat, tLng),
            map,
            title: `Point #${coordIdx + 1} (${tLat.toFixed(4)}, ${tLng.toFixed(4)}) - Click to ${trimSubMode === 'single' ? 'delete' : 'select cut point'}`,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale,
              fillColor: markerColor,
              fillOpacity: 1,
              strokeColor: '#FFFFFF',
              strokeWeight: isStart || isEnd ? 2.5 : 1.5
            },
            zIndex: isStart || isEnd ? 95 : 85,
            cursor: 'pointer'
          });

          tMarker.addListener('click', () => {
            handleVertexMarkerClick(coordIdx);
          });
          trimMarkersRef.current.push(tMarker);
        }
      }
    });

    // Start & Destination Flag SVGs
    const greenFlagSvg = `data:image/svg+xml;utf-8,${encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="38" height="44" viewBox="0 0 38 44">
        <line x1="7" y1="3" x2="7" y2="42" stroke="#0F172A" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="7" cy="3" r="2.5" fill="#10B981" stroke="#059669" stroke-width="1"/>
        <circle cx="7" cy="42" r="3" fill="#0F172A"/>
        <path d="M8 5 H30 C35 10, 28 14.5, 33 19 H8 Z" fill="#10B981" stroke="#047857" stroke-width="1.5"/>
        <circle cx="17" cy="12" r="2.5" fill="#FFFFFF"/>
      </svg>
    `)}`;

    const redFlagSvg = `data:image/svg+xml;utf-8,${encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="38" height="44" viewBox="0 0 38 44">
        <line x1="7" y1="3" x2="7" y2="42" stroke="#0F172A" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="7" cy="3" r="2.5" fill="#EF4444" stroke="#DC2626" stroke-width="1"/>
        <circle cx="7" cy="42" r="3" fill="#0F172A"/>
        <path d="M8 5 H30 C35 10, 28 14.5, 33 19 H8 Z" fill="#EF4444" stroke="#B91C1C" stroke-width="1.5"/>
        <circle cx="17" cy="12" r="2.5" fill="#FFFFFF"/>
      </svg>
    `)}`;

    // 2. Start Marker
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
          </div>
        `
      });

      marker.addListener('click', () => openPopup(infoWindow, marker));
      markersRef.current.push(marker);
    }

    // 3. Destination Marker
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
          </div>
        `
      });

      marker.addListener('click', () => openPopup(infoWindow, marker));
      markersRef.current.push(marker);
    }

    // 4. Stoppage Markers
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

      const durationMins = stop.stop_duration_mins || stop.duration || 25;
      const info = new google.maps.InfoWindow({
        content: `
          <div style="min-width: 220px; padding: 6px; font-family: 'Plus Jakarta Sans', sans-serif;">
            <div style="font-size: 10px; font-weight: 800; color: #EA580C; text-transform: uppercase;">Transit Halt #${idx + 1} (${durationMins}m)</div>
            <div style="font-size: 13px; font-weight: 800; color: #0F172A; margin-top: 2px;">${stop.name}</div>
            ${stop.address ? `<div style="font-size: 11px; color: #64748B; margin-top: 2px;">${stop.address}</div>` : ''}
          </div>
        `
      });
      marker.addListener('click', () => openPopup(info, marker));
      markersRef.current.push(marker);
    });

    // 5. Parking Points
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
      markersRef.current.push(marker);
    });

    // 6. Toll Gate Markers
    const tollPlazaSvg = `data:image/svg+xml;utf-8,${encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r="15" fill="#1E293B" stroke="#FFFFFF" stroke-width="2.5"/>
        <path d="M10 13L18 9L26 13H10Z" fill="#38BDF8"/>
        <rect x="11.5" y="13.5" width="2" height="9.5" fill="#FFFFFF"/>
        <rect x="22.5" y="13.5" width="2" height="9.5" fill="#FFFFFF"/>
        <line x1="12" y1="16.5" x2="24" y2="16.5" stroke="#F59E0B" stroke-width="2.5"/>
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
      markersRef.current.push(marker);
    });

    // Auto-fit bounds on initial route load
    const currentKey = `${startPoint?.lat || ''}_${startPoint?.lng || ''}_${endPoint?.lat || ''}_${endPoint?.lng || ''}_${routes.length}`;
    if (hasPoints && lastFittedKeyRef.current !== currentKey && !isTrimMode) {
      lastFittedKeyRef.current = currentKey;
      map.fitBounds(bounds);
    }
  };

  useEffect(() => {
    renderOverlays();
  }, [overlayKey]);

  // Live Vehicle Position Marker
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
      vehicleMarkerRef.current.setPosition(pos);
      vehicleMarkerRef.current.setTitle(`${vehiclePosition.plate || 'Vehicle'} • ${vehiclePosition.speed || 0} km/h`);
    } else {
      const truckSvg = `data:image/svg+xml;utf-8,${encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
          <circle cx="24" cy="24" r="17" fill="#0F172A" stroke="#FFFFFF" stroke-width="2.5"/>
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
      vehicleMarkerRef.current = vMarker;
    }
  }, [vehiclePosition]);

  return (
    <div
      ref={wrapperRef}
      className={
        isFullscreen
          ? 'fixed inset-0 z-[99999] w-screen h-screen rounded-none border-none bg-slate-900 flex flex-col overflow-hidden shadow-2xl'
          : 'relative w-full rounded-2xl overflow-hidden border border-slate-200/90 shadow-xs bg-white'
      }
    >
      {/* Top Map Action Bar (Toolbar) */}
      <div className="absolute top-3 right-3 z-30 flex items-center gap-1.5 bg-white/95 backdrop-blur-md p-1.5 rounded-xl border border-slate-200 shadow-md">
        {/* Polyline Trim / Delete Wrong Line Button */}
        {activeCoords.length > 2 && (
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

        <div className="h-4 w-px bg-slate-200 mx-0.5" />

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
                onClick={() => handleSelectMapType('roadmap')}
                className={`w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-slate-50 transition cursor-pointer ${
                  mapType === 'roadmap' ? 'font-bold text-[#E60012] bg-red-50/50' : 'text-slate-700'
                }`}
              >
                <MapIcon className="w-3.5 h-3.5" />
                <span>Roadmap</span>
              </button>
              <button
                type="button"
                onClick={() => handleSelectMapType('hybrid')}
                className={`w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-slate-50 transition cursor-pointer ${
                  mapType === 'hybrid' ? 'font-bold text-[#E60012] bg-red-50/50' : 'text-slate-700'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                <span>Satellite</span>
              </button>
              <button
                type="button"
                onClick={() => handleSelectMapType('terrain')}
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
      {isTrimMode && (
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
          <div className="w-2 h-2 rounded-full bg-red-600 animate-ping" />
          <span className="text-xs font-bold text-slate-900">
            {clickMode === 'start' && '👉 Click map to set Start Location (Green Flag)'}
            {clickMode === 'end' && '👉 Click map to set Destination (Red Flag)'}
            {clickMode === 'stop' && '👉 Click map to place Stoppage'}
            {clickMode === 'parking' && '👉 Click map to place Parking Point'}
            {clickMode === 'toll' && '👉 Click map to place FASTag Toll Plaza'}
          </span>
        </div>
      )}

      {/* Google Maps Container */}
      <div
        ref={containerRef}
        style={{ height: isFullscreen ? '100vh' : height, width: '100%' }}
        className="w-full flex-1"
      />
    </div>
  );
};
