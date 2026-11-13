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
  Mountain,
  ArrowLeft,
  ExternalLink,
  Search,
  Loader2,
  MapPin
} from 'lucide-react';
import {
  deleteSinglePoint,
  deletePointRange,
  calculateCumulativeDistanceKm,
  calculateDurationMinutes,
  calculateBearing
} from '../utils/routePolylineUtils';

// Cached rotated truck icons generator for Google Maps marker
const rotatedIconCache = new Map<number, string>();
let preloadedTruckImg: HTMLImageElement | null = null;

function getPreloadedTruckImage(onLoaded?: () => void): HTMLImageElement {
  if (!preloadedTruckImg) {
    preloadedTruckImg = new Image();
    preloadedTruckImg.src = '/images/truck-3d.png';
  }
  if (onLoaded && (!preloadedTruckImg.complete || preloadedTruckImg.naturalWidth === 0)) {
    preloadedTruckImg.addEventListener('load', onLoaded, { once: true });
  }
  return preloadedTruckImg;
}

function getRotatedTruckIconUrl(heading: number, onLoaded?: () => void): string {
  // Base offset of the 3D truck is 150 deg (pointing South-East)
  const rotation = Math.round(((heading - 150) % 360 + 360) % 360);
  // Quantize to nearest 3 degrees to optimize cache performance
  const stepAngle = Math.round(rotation / 3) * 3;
  if (rotatedIconCache.has(stepAngle)) {
    return rotatedIconCache.get(stepAngle)!;
  }

  const img = getPreloadedTruckImage(onLoaded);
  if (!img.complete || img.naturalWidth === 0) {
    return '/images/truck-3d.png';
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '/images/truck-3d.png';

    ctx.clearRect(0, 0, 64, 64);
    ctx.translate(32, 32);
    ctx.rotate((stepAngle * Math.PI) / 180);
    ctx.drawImage(img, -22, -22, 44, 44);

    const dataUrl = canvas.toDataURL('image/png');
    rotatedIconCache.set(stepAngle, dataUrl);
    return dataUrl;
  } catch (e) {
    return '/images/truck-3d.png';
  }
}

declare const google: any;

export const GooglePegmanSvg: React.FC<{ className?: string }> = ({ className = "w-6 h-7" }) => (
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
  vehiclePosition?: { lat: number; lng: number; speed?: number; status?: string; plate?: string; heading?: number } | null;
  onMapClick?: (lat: number, lng: number, address?: string, mode?: string) => void;
  clickMode?: 'start' | 'end' | 'stop' | 'parking' | 'toll' | 'manual-route' | 'none';
  customWaypoints?: Array<{ lat: number; lng: number; name?: string }>;
  isManualDrawing?: boolean;
  isDraggableRoute?: boolean;
  hideEditTools?: boolean;
  hideBreadcrumbs?: boolean;
  searchLocation?: { lat: number; lng: number; name?: string; address?: string } | null;
  onUpdateTollPrice?: (tollName: string, newPrice: number) => void;
  onUpdateToll?: (oldName: string, newName: string, newPrice: number) => void;
  onDeleteToll?: (toll: TollGate) => void;
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
  hideEditTools = false,
  hideBreadcrumbs = false,
  searchLocation,
  onUpdateTollPrice,
  onUpdateToll,
  onDeleteToll,
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
  const prevVehiclePosRef = useRef<{ lat: number; lng: number } | null>(null);
  const currentHeadingRef = useRef<number>(150);
  const geocoderRef = useRef<any>(null);
  const activeInfoWindowRef = useRef<any>(null);
  const lastFittedKeyRef = useRef<string>('');
  const overlayRef = useRef<any>(null);
  const streetViewServiceRef = useRef<any>(null);
  const droppedPegmanMarkerRef = useRef<any>(null);

  // Street View States (Pegman Drag & Drop / Direct Click)
  const [isStreetViewActive, setIsStreetViewActive] = useState<boolean>(false);
  const [isDraggingPegman, setIsDraggingPegman] = useState<boolean>(false);
  const [streetViewMsg, setStreetViewMsg] = useState<string | null>(null);
  const [activeStreetViewLocation, setActiveStreetViewLocation] = useState<{ lat: number; lng: number } | null>(null);

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
    const searchKey = searchLocation && searchLocation.lat ? `${Number(searchLocation.lat).toFixed(4)}_${Number(searchLocation.lng).toFixed(4)}` : 'none';
    return `${selectedRouteId || ''}::${rIds}::${sKey}::${eKey}::${stopKey}::${tollKey}::${parkKey}::${wayKey}::${searchKey}::${isManualDrawing}::${isTrimMode}::${showBreadcrumbs}::${cutStartIndex}::${cutEndIndex}::${trimSubMode}`;
  }, [routes, selectedRouteId, startPoint, endPoint, stoppages, tollGates, parkingPoints, customWaypoints, searchLocation, isManualDrawing, isTrimMode, showBreadcrumbs, cutStartIndex, cutEndIndex, trimSubMode]);

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
      if (typeof zoom === 'number' && zoom > 0) {
        mapInstanceRef.current.setZoom(zoom);
      }
    }
  }, [center?.lat, center?.lng, zoom]);

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

  // Open Street View at specified GPS coordinates in official 360° viewer
  const openStreetViewAt = (lat: number, lng: number) => {
    const map = mapInstanceRef.current;
    setActiveStreetViewLocation({ lat, lng });
    setStreetViewMsg(`Opening 360° Street View (${lat.toFixed(4)}, ${lng.toFixed(4)})...`);

    // Place dropped Pegman marker on map
    if (map && (window as any).google?.maps) {
      if (droppedPegmanMarkerRef.current) {
        droppedPegmanMarkerRef.current.setMap(null);
      }
      try {
        const marker = new google.maps.Marker({
          position: { lat, lng },
          map,
          title: `360° Street View (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
          icon: {
            url: '/images/pegman.svg',
            scaledSize: new google.maps.Size(26, 34),
            anchor: new google.maps.Point(13, 32)
          },
          animation: google.maps.Animation.DROP,
          zIndex: 350
        });
        marker.addListener('click', () => {
          const url = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
          window.open(url, '_blank');
        });
        droppedPegmanMarkerRef.current = marker;
      } catch (_) {}
    }

    // Official Google Maps 360° Panorama URL (Universal, always works without billing errors)
    const url = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
    try {
      const win = window.open(url, '_blank');
      if (win) win.focus();
    } catch (_) {}

    setTimeout(() => {
      setStreetViewMsg(null);
    }, 3500);
  };

  // Direct Click on Pegman: open Street View at Vehicle Standing Position (or Route Start / Center)
  const handlePegmanClick = () => {
    let targetLat = 0;
    let targetLng = 0;

    if (vehiclePosition?.lat && vehiclePosition?.lng) {
      targetLat = Number(vehiclePosition.lat);
      targetLng = Number(vehiclePosition.lng);
    } else if (startPoint?.lat && startPoint?.lng) {
      targetLat = Number(startPoint.lat);
      targetLng = Number(startPoint.lng);
    } else if (activeRoute?.coordinates && activeRoute.coordinates.length > 0) {
      const firstCoord = activeRoute.coordinates[0];
      if (Array.isArray(firstCoord)) {
        targetLat = Number(firstCoord[0]);
        targetLng = Number(firstCoord[1]);
      } else if (firstCoord && typeof firstCoord === 'object') {
        targetLat = Number((firstCoord as any).lat);
        targetLng = Number((firstCoord as any).lng);
      }
    } else if (mapInstanceRef.current) {
      const c = mapInstanceRef.current.getCenter();
      if (c) {
        targetLat = c.lat();
        targetLng = c.lng();
      }
    }

    if (targetLat && targetLng) {
      openStreetViewAt(targetLat, targetLng);
    }
  };

  // Handle Drag & Drop of Pegman onto Map
  const handleDropOnMap = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingPegman(false);
    const map = mapInstanceRef.current;
    if (!map || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    let targetLat: number | null = null;
    let targetLng: number | null = null;

    if (overlayRef.current && overlayRef.current.getProjection()) {
      const point = new google.maps.Point(x, y);
      const latLng = overlayRef.current.getProjection().fromContainerPixelToLatLng(point);
      if (latLng) {
        targetLat = latLng.lat();
        targetLng = latLng.lng();
      }
    }

    // Fallback using map bounds if overlay projection is not yet computed
    if (targetLat === null || targetLng === null) {
      const bounds = map.getBounds();
      if (bounds) {
        const ne = bounds.getNorthEast();
        const sw = bounds.getSouthWest();
        targetLat = ne.lat() - (y / rect.height) * (ne.lat() - sw.lat());
        targetLng = sw.lng() + (x / rect.width) * (ne.lng() - sw.lng());
      }
    }

    if (targetLat !== null && targetLng !== null) {
      openStreetViewAt(targetLat, targetLng);
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

    // Initialize OverlayView for screen-pixel to GPS conversion on drop
    try {
      const overlay = new google.maps.OverlayView();
      overlay.draw = () => {};
      overlay.setMap(map);
      overlayRef.current = overlay;
    } catch (e) {}

    // Initialize StreetViewService & Panorama visibility tracking
    try {
      streetViewServiceRef.current = new google.maps.StreetViewService();
      const panorama = map.getStreetView();
      if (panorama) {
        panorama.addListener('visible_changed', () => {
          setIsStreetViewActive(Boolean(panorama.getVisible()));
        });
      }
    } catch (e) {}

    const triggerClick = (lat: number, lng: number) => {
      const currentMode = clickModeRef.current;
      if (currentMode === 'none') return;

      const defaultName = `Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
      if (onMapClickRef.current) {
        onMapClickRef.current(lat, lng, defaultName, currentMode);
      }

      // Reverse geocode address for named markers (skip for rapid manual-route drawing so points aren't duplicated)
      if (geocoderRef.current && currentMode !== 'manual-route') {
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

    // 1. Draw Routes - ONLY render the selected/primary route (Alternative routes are strictly hidden from map)
    const activeRouteToDraw = routes.find(r => r.id === selectedRouteId) || routes[0];
    const routesToRender = activeRouteToDraw ? [activeRouteToDraw] : [];

    routesToRender.forEach((route) => {
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

      let glow: any = null;
      if (isSelected) {
        const isBlue = route.color === '#1A73E8' || route.color === '#2563EB' || route.color === '#3B82F6' || !route.color;
        const glowColor = isBlue ? '#93C5FD' : '#FEE2E2';
        glow = new google.maps.Polyline({
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
        editable: Boolean(isSelected && !hideEditTools && isTrimMode),
        draggable: false
      });

      // Interactive polyline vertex trim mode contextmenu delete
      if (isSelected && !hideEditTools && isTrimMode) {
        const mvcPath = polyline.getPath();
        let dragDebounceTimer: any = null;
        const onPathChange = () => {
          if (dragDebounceTimer) clearTimeout(dragDebounceTimer);
          dragDebounceTimer = setTimeout(() => {
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
          }, 120);
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
        } else if (showBreadcrumbs && !isTrimMode && e.latLng) {
          // If in dots mode, clicking on the polyline inserts a new draggable dot right there
          const clickLat = parseFloat(e.latLng.lat().toFixed(6));
          const clickLng = parseFloat(e.latLng.lng().toFixed(6));
          let bestIdx = 1;
          let bestDist = Infinity;
          for (let i = 0; i < validCoords.length - 1; i++) {
            const p1 = validCoords[i];
            const p2 = validCoords[i + 1];
            const midLat = (p1[0] + p2[0]) / 2;
            const midLng = (p1[1] + p2[1]) / 2;
            const d = Math.hypot(clickLat - midLat, clickLng - midLng);
            if (d < bestDist) {
              bestDist = d;
              bestIdx = i + 1;
            }
          }
          const newCoords: [number, number][] = [...validCoords];
          newCoords.splice(bestIdx, 0, [clickLat, clickLng]);
          const newDistKm = calculateCumulativeDistanceKm(newCoords);
          const newTimeMins = calculateDurationMinutes(newDistKm, 45);
          if (onRouteChangeRef.current) {
            onRouteChangeRef.current({
              coordinates: newCoords,
              distanceKm: newDistKm,
              timeMinutes: newTimeMins,
              summary: 'Waypoint Dot Added to Route'
            });
          }
        } else {
          if (onSelectRoute) onSelectRoute(route.id);
        }
      });

      polylinesRef.current.push(polyline);

      // --- Telematic & Draggable Route Dots Layer ---
      if (!hideBreadcrumbs && showBreadcrumbs && isSelected && !isTrimMode && validCoords.length > 1) {
        const dotColor = route.color || (isSelected ? '#1A73E8' : '#E60012');

        // 1. Subtle telematic dots line for background texture
        const breadcrumbPolyline = new google.maps.Polyline({
          path,
          strokeOpacity: 0,
          icons: [{
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 2.0,
              fillColor: '#FFFFFF',
              fillOpacity: 0.9,
              strokeColor: dotColor,
              strokeWeight: 1.2
            },
            offset: '0',
            repeat: '28px'
          }],
          map,
          zIndex: 25,
          clickable: false
        });
        polylinesRef.current.push(breadcrumbPolyline);

        // 2. Interactive Draggable Control Dots
        const totalPts = validCoords.length;
        const targetDotCount = totalPts <= 25 ? Math.max(1, totalPts - 2) : Math.min(28, Math.max(8, Math.floor(totalPts / 18)));
        const step = targetDotCount > 0 ? Math.max(1, Math.floor((totalPts - 1) / (targetDotCount + 1))) : 1;

        const dotIndices: number[] = [];
        if (totalPts <= 15) {
          for (let i = 1; i < totalPts - 1; i++) dotIndices.push(i);
        } else {
          for (let i = step; i < totalPts - 1; i += step) {
            dotIndices.push(i);
          }
        }

        dotIndices.forEach((dotIdx, k) => {
          const pt = validCoords[dotIdx];
          if (!pt) return;
          const prevIdx = k > 0 ? dotIndices[k - 1] : 0;
          const nextIdx = k < dotIndices.length - 1 ? dotIndices[k + 1] : totalPts - 1;

          const dotMarker = new google.maps.Marker({
            position: new google.maps.LatLng(pt[0], pt[1]),
            map,
            draggable: true,
            cursor: 'grab',
            zIndex: 45,
            title: `Waypoint Dot #${k + 1} - Drag to modify route corridor`,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 5.5,
              fillColor: '#FFFFFF',
              fillOpacity: 1.0,
              strokeColor: dotColor,
              strokeWeight: 2.5
            }
          });

          // Visual feedback on hover
          dotMarker.addListener('mouseover', () => {
            dotMarker.setIcon({
              path: google.maps.SymbolPath.CIRCLE,
              scale: 7.5,
              fillColor: '#FEF2F2',
              fillOpacity: 1.0,
              strokeColor: '#0F172A',
              strokeWeight: 3.0
            });
          });
          dotMarker.addListener('mouseout', () => {
            dotMarker.setIcon({
              path: google.maps.SymbolPath.CIRCLE,
              scale: 5.5,
              fillColor: '#FFFFFF',
              fillOpacity: 1.0,
              strokeColor: dotColor,
              strokeWeight: 2.5
            });
          });

          // Dynamic 60fps real-time polyline bending during drag
          dotMarker.addListener('drag', (e: any) => {
            if (!e.latLng) return;
            const newLat = e.latLng.lat();
            const newLng = e.latLng.lng();
            const deformed = deformPolylineSmooth(validCoords, dotIdx, prevIdx, nextIdx, newLat, newLng);
            const deformedPath = deformed.map(([lat, lng]) => ({ lat, lng }));
            polyline.setPath(deformedPath);
            breadcrumbPolyline.setPath(deformedPath);
            if (glow) {
              glow.setPath(deformedPath);
            }
          });

          // Commit modified route on dragend
          dotMarker.addListener('dragend', (e: any) => {
            if (!e.latLng) return;
            const newLat = e.latLng.lat();
            const newLng = e.latLng.lng();
            const deformed = deformPolylineSmooth(validCoords, dotIdx, prevIdx, nextIdx, newLat, newLng);
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

          markersRef.current.push(dotMarker);
        });
      }

      // --- Interactive Trim / Point Deletion Markers ---
      if (!hideEditTools && isTrimMode && isSelected && validCoords.length > 0) {
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

    // --- LIVE MANUAL ROUTE DRAWING: Polyline & Waypoints Layer ---
    if ((isManualDrawing || (customWaypoints && customWaypoints.length > 0))) {
      const livePathPts: any[] = [];
      
      // If startPoint exists, include it as origin
      if (startPoint?.lat && startPoint?.lng) {
        livePathPts.push(new google.maps.LatLng(startPoint.lat, startPoint.lng));
      }

      // Add all clicked points
      (customWaypoints || []).forEach((wp) => {
        if (wp.lat && wp.lng) {
          if (!startPoint || Math.abs(startPoint.lat - wp.lat) > 0.0001 || Math.abs(startPoint.lng - wp.lng) > 0.0001) {
            livePathPts.push(new google.maps.LatLng(wp.lat, wp.lng));
          }
        }
      });

      // If user provided endPoint and finished drawing, include destination
      if (endPoint?.lat && endPoint?.lng && !isManualDrawing) {
        livePathPts.push(new google.maps.LatLng(endPoint.lat, endPoint.lng));
      }

      // Draw the live connecting polyline as user clicks on the map!
      if (livePathPts.length >= 2) {
        const casing = new google.maps.Polyline({
          path: livePathPts,
          map,
          strokeColor: '#FFFFFF',
          strokeOpacity: 0.9,
          strokeWeight: 7,
          zIndex: 55
        });
        polylinesRef.current.push(casing);

        const livePolyline = new google.maps.Polyline({
          path: livePathPts,
          map,
          strokeColor: '#EF4444',
          strokeOpacity: 1.0,
          strokeWeight: 4.5,
          zIndex: 60
        });
        polylinesRef.current.push(livePolyline);
      }

      // Render numbered markers at each clicked point so user sees their clicks
      (customWaypoints || []).forEach((wp, idx) => {
        if (!wp.lat || !wp.lng) return;
        const pos = new google.maps.LatLng(wp.lat, wp.lng);
        bounds.extend(pos);
        hasPoints = true;

        const isStart = startPoint && Math.abs(startPoint.lat - wp.lat) < 0.0001 && Math.abs(startPoint.lng - wp.lng) < 0.0001;
        if (isStart) return;

        const wpMarker = new google.maps.Marker({
          position: pos,
          map,
          title: `Custom Point #${idx + 1}`,
          label: {
            text: `${idx + 1}`,
            color: '#FFFFFF',
            fontWeight: 'bold',
            fontSize: '10px'
          },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: '#EF4444',
            fillOpacity: 1,
            strokeColor: '#FFFFFF',
            strokeWeight: 2
          },
          zIndex: 75
        });
        markersRef.current.push(wpMarker);
      });
    }

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

    // Search Result Pin (Across India Search)
    if (searchLocation && searchLocation.lat && searchLocation.lng) {
      const pos = new google.maps.LatLng(searchLocation.lat, searchLocation.lng);
      map.panTo(pos);
      map.setZoom(16);

      const searchMarker = new google.maps.Marker({
        position: pos,
        map,
        title: `Search Result: ${searchLocation.name || 'Location'}`,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: '#2563EB',
          fillOpacity: 1,
          strokeColor: '#FFFFFF',
          strokeWeight: 2.5,
        },
        zIndex: 9999
      });

      const searchInfoWindow = new google.maps.InfoWindow({
        content: `
          <div style="padding: 4px; font-family: 'Plus Jakarta Sans', sans-serif;">
            <div style="font-size: 10px; font-weight: bold; color: #2563EB; text-transform: uppercase;">📍 Searched Location</div>
            <div style="font-size: 13px; font-weight: 800; color: #0F172A; margin-top: 2px;">${searchLocation.name || 'Location'}</div>
            ${searchLocation.address ? `<div style="font-size: 11px; color: #64748B; margin-top: 2px;">${searchLocation.address}</div>` : ''}
          </div>
        `
      });

      searchMarker.addListener('click', () => openPopup(searchInfoWindow, searchMarker));
      openPopup(searchInfoWindow, searchMarker);
      markersRef.current.push(searchMarker);
    }

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
        title: `${toll.name} (FASTag Toll Plaza) - ₹${toll.charges || 0}`,
        icon: {
          url: tollPlazaSvg,
          scaledSize: new google.maps.Size(34, 34),
          anchor: new google.maps.Point(17, 17)
        },
        zIndex: 45
      });
      markersRef.current.push(marker);

      const safeId = (toll.id || toll.name).toString().replace(/[^a-zA-Z0-9]/g, '');
      const tollInfoWindow = new google.maps.InfoWindow({
        content: `
          <div style="padding: 6px 8px; font-family: 'Plus Jakarta Sans', sans-serif; min-width: 210px;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px;">
              <div style="font-size: 10px; font-weight: bold; color: #D97706; text-transform: uppercase; letter-spacing: 0.5px;">
                🛑 FASTag Toll Plaza
              </div>
              <button id="gmap-toll-del-${safeId}" style="background: none; border: none; color: #EF4444; font-size: 11px; font-weight: 700; cursor: pointer; padding: 1px 4px; border-radius: 4px;" title="Delete this toll">✕ Delete</button>
            </div>
            <div style="margin-top: 4px;">
              <input type="text" value="${toll.name || ''}" id="gmap-toll-name-${safeId}" style="width: 100%; padding: 4px 6px; font-size: 12px; font-weight: 700; color: #0F172A; border: 1px solid #CBD5E1; border-radius: 6px; box-sizing: border-box;" placeholder="Toll Plaza Name" />
            </div>
            <div style="font-size: 10px; color: #64748B; margin-top: 3px;">
              GPS: ${Number(toll.lat).toFixed(4)}, ${Number(toll.lng).toFixed(4)}
            </div>
            <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid #E2E8F0; display: flex; align-items: center; justify-content: space-between; gap: 6px;">
              <span style="font-size: 11px; font-weight: 700; color: #334155;">Tariff:</span>
              <div style="display: flex; align-items: center; gap: 4px;">
                <span style="font-size: 12px; font-weight: 800; color: #16A34A;">₹</span>
                <input type="number" min="0" value="${toll.charges || 0}" id="gmap-toll-input-${safeId}" style="width: 65px; padding: 3px 6px; font-size: 12px; font-weight: 800; font-family: monospace; border: 1px solid #CBD5E1; border-radius: 6px; text-align: right;" />
                <button id="gmap-toll-btn-${safeId}" style="padding: 3px 8px; font-size: 11px; font-weight: 700; background: #0F172A; color: #FFFFFF; border: none; border-radius: 6px; cursor: pointer;">Save</button>
              </div>
            </div>
          </div>
        `
      });

      tollInfoWindow.addListener('domready', () => {
        const btn = document.getElementById(`gmap-toll-btn-${safeId}`);
        const delBtn = document.getElementById(`gmap-toll-del-${safeId}`);
        const input = document.getElementById(`gmap-toll-input-${safeId}`) as HTMLInputElement;
        const nameInput = document.getElementById(`gmap-toll-name-${safeId}`) as HTMLInputElement;

        const handleSaveToll = () => {
          const val = parseFloat(input?.value || '0');
          const newName = nameInput?.value?.trim() || toll.name;
          const parsedVal = isNaN(val) ? 0 : val;
          if (onUpdateToll) {
            onUpdateToll(toll.name, newName, parsedVal);
          } else if (onUpdateTollPrice) {
            onUpdateTollPrice(toll.name, parsedVal);
          }
        };

        if (btn) {
          btn.onclick = handleSaveToll;
        }
        if (delBtn) {
          delBtn.onclick = () => {
            tollInfoWindow.close();
            marker.setMap(null);
            if (onDeleteToll) onDeleteToll(toll);
          };
        }
        if (input) {
          input.onkeydown = (e) => {
            if (e.key === 'Enter') handleSaveToll();
          };
        }
        if (nameInput) {
          nameInput.onkeydown = (e) => {
            if (e.key === 'Enter') handleSaveToll();
          };
        }
      });

      // Show on hover (mouseover) and click
      marker.addListener('mouseover', () => openPopup(tollInfoWindow, marker));
      marker.addListener('click', () => openPopup(tollInfoWindow, marker));
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
      prevVehiclePosRef.current = null;
      return;
    }

    const pos = new google.maps.LatLng(vehiclePosition.lat, vehiclePosition.lng);

    // Calculate heading / angle along route
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

    const iconUrl = getRotatedTruckIconUrl(heading, () => {
      if (vehicleMarkerRef.current) {
        const refreshedUrl = getRotatedTruckIconUrl(currentHeadingRef.current);
        vehicleMarkerRef.current.setIcon({
          url: refreshedUrl,
          scaledSize: new google.maps.Size(46, 46),
          anchor: new google.maps.Point(23, 23)
        });
      }
    });

    const truckIconConfig = {
      url: iconUrl,
      scaledSize: new google.maps.Size(46, 46),
      anchor: new google.maps.Point(23, 23)
    };

    if (vehicleMarkerRef.current) {
      vehicleMarkerRef.current.setPosition(pos);
      vehicleMarkerRef.current.setIcon(truckIconConfig);
      vehicleMarkerRef.current.setTitle(
        `${vehiclePosition.plate || 'Vehicle'} • ${vehiclePosition.speed || 0} km/h • ${vehiclePosition.status?.toUpperCase() || 'MOVING'}`
      );
    } else {
      const vMarker = new google.maps.Marker({
        position: pos,
        map,
        title: `${vehiclePosition.plate || 'Vehicle'} • ${vehiclePosition.speed || 0} km/h • ${vehiclePosition.status?.toUpperCase() || 'MOVING'}`,
        icon: truckIconConfig,
        optimized: false,
        zIndex: 200
      });
      vehicleMarkerRef.current = vMarker;
    }
  }, [vehiclePosition]);

  return (
    <div
      ref={wrapperRef}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={handleDropOnMap}
      className={
        isFullscreen
          ? 'fixed inset-0 z-[99999] w-screen h-screen rounded-none border-none bg-slate-900 flex flex-col overflow-hidden shadow-2xl'
          : 'relative w-full rounded-2xl overflow-hidden border border-slate-200/90 shadow-xs bg-white'
      }
    >
      {/* Top Map Action Bar (Toolbar) */}
      <div className="absolute top-3 right-3 z-30 flex items-center gap-1.5 bg-white/95 backdrop-blur-md p-1.5 rounded-xl border border-slate-200 shadow-md">
        {/* Polyline Trim / Delete Wrong Line Button */}
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

      {/* 360° Street View Active Banner */}
      {activeStreetViewLocation && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 text-white px-4 py-2 rounded-2xl text-xs font-semibold shadow-2xl border border-slate-700/80 flex items-center gap-3 backdrop-blur-md animate-in fade-in slide-in-from-top duration-200">
          <div className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-amber-400">360° Street View:</span>
            <span className="font-mono text-slate-300">({activeStreetViewLocation.lat.toFixed(4)}, {activeStreetViewLocation.lng.toFixed(4)})</span>
          </div>
          <a
            href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${activeStreetViewLocation.lat},${activeStreetViewLocation.lng}`}
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
              setActiveStreetViewLocation(null);
              if (droppedPegmanMarkerRef.current) {
                droppedPegmanMarkerRef.current.setMap(null);
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

      {/* Street View Status Notification Toast */}
      {streetViewMsg && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 text-white px-4 py-2 rounded-xl text-xs font-semibold shadow-2xl border border-slate-700/80 flex items-center gap-2 backdrop-blur-md pointer-events-none animate-in fade-in duration-200">
          <div className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
          <span>{streetViewMsg}</span>
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

      {/* Google Maps Container */}
      <div
        ref={containerRef}
        style={{ height: isFullscreen ? '100vh' : height, width: '100%' }}
        className="w-full flex-1"
      />
    </div>
  );
};
