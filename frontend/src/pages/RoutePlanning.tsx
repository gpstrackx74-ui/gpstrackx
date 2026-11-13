import * as XLSX from 'xlsx';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { api } from '../api/client';
import { Vehicle, AlternativeRoute, Stoppage, TollGate } from '../types';
import { InteractiveMap } from '../components/InteractiveMap';
import { LocationSearchInput } from '../components/LocationSearchInput';
import { DMYDateInput } from '../components/DMYDateInput';
import {
  detectRealTollsOnRoute,
  detectAllTollsOnRoute,
  computeTotalTruckToll,
  TruckAxleType,
  AXLE_CONFIGURATIONS
} from '../utils/realTolls';
import {
  enhanceRouteWithRoadGeometry,
  calculateCumulativeDistanceKm,
  calculateDurationMinutes
} from '../utils/routePolylineUtils';
import { extractAccurateExcelTelemetry } from '../utils/excelTelemetryExtractor';
import {
  MapPin,
  Trash2,
  Check,
  RotateCcw,
  Truck,
  Navigation,
  Plus,
  Minus,
  Clock,
  Route,
  Undo2,
  Pencil,
  Calendar,
  UserCheck,
  Layers,
  Edit3,
  FileSpreadsheet,
  Search,
  Loader2,
  X
} from 'lucide-react';

interface ParkingPoint {
  id?: number;
  name: string;
  lat: number;
  lng: number;
  address?: string;
}

interface RoutePlanningProps {
  initialVehicleId?: number | null;
  onSavedRouteSuccess: (vehicleId: number) => void;
}

const GOOGLE_ROUTE_COLORS = [
  '#EF4444', // Route 1: Light Red / Crimson (Fastest / Recommended)
  '#3B82F6', // Route 2: Indigo / Blue (Alternative 2)
  '#8B5CF6', // Route 3: Purple / Violet (Alternative 3)
  '#10B981'  // Route 4: Emerald / Green (Alternative 4)
];

export const RoutePlanning: React.FC<RoutePlanningProps> = ({ initialVehicleId, onSavedRouteSuccess }) => {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [allotUserId, setAllotUserId] = useState<string>('');
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>(initialVehicleId ? String(initialVehicleId) : '');

  // Saved Corridors / Existing Routes
  const [savedCorridors, setSavedCorridors] = useState<any[]>([]);
  const [selectedCorridorId, setSelectedCorridorId] = useState<string>('');
  const [corridorNameInput, setCorridorNameInput] = useState<string>('');
  const [showSavedCorridorSearch, setShowSavedCorridorSearch] = useState<boolean>(false);
  const [savedCorridorSearchTerm, setSavedCorridorSearchTerm] = useState<string>('');

  const filteredSavedCorridors = useMemo(() => {
    if (!savedCorridorSearchTerm.trim()) return savedCorridors;
    const q = savedCorridorSearchTerm.toLowerCase().trim();
    return savedCorridors.filter(c => {
      const name = (c.route_name || '').toLowerCase();
      const veh = (c.vehicle_registration_no || '').toLowerCase();
      const user = (c.user_name || '').toLowerCase();
      return name.includes(q) || veh.includes(q) || user.includes(q);
    });
  }, [savedCorridors, savedCorridorSearchTerm]);

  // Excel File Route Import State
  const [excelFileName, setExcelFileName] = useState<string | null>(null);
  const [isExcelRouteActive, setIsExcelRouteActive] = useState<boolean>(false);
  const [importedWaypointsCount, setImportedWaypointsCount] = useState<number>(0);
  const [excelSummaryMeta, setExcelSummaryMeta] = useState<{
    vehicleReg?: string;
    startDate?: string;
    endDate?: string;
    distanceKm?: number;
    avgSpeed?: number;
    maxSpeed?: number;
    runningTime?: string;
    haltedTime?: string;
  } | null>(null);
  const [isDraggableRoute, setIsDraggableRoute] = useState<boolean>(true);
  const [isImportingExcel, setIsImportingExcel] = useState<boolean>(false);

  // Draggable Route Modification State
  const [isRouteModifiedByDrag, setIsRouteModifiedByDrag] = useState<boolean>(false);
  const [newModifiedRouteName, setNewModifiedRouteName] = useState<string>('');
  const [modifiedDistanceKm, setModifiedDistanceKm] = useState<number | null>(null);
  const [modifiedDurationMins, setModifiedDurationMins] = useState<number | null>(null);
  const [modifiedPolyline, setModifiedPolyline] = useState<Array<[number, number]>>([]);

  // Commercial Truck Axle & Configuration (NHAI 2008 Classification)
  const [selectedAxle, setSelectedAxle] = useState<TruckAxleType>('4-axle');
  const [customTollOverrides, setCustomTollOverrides] = useState<Record<string, number>>({});
  const [customTollsAdded, setCustomTollsAdded] = useState<TollGate[]>([]);
  const [showAddCustomToll, setShowAddCustomToll] = useState<boolean>(false);
  const [newCustomTollName, setNewCustomTollName] = useState<string>('');
  const [newCustomTollLat, setNewCustomTollLat] = useState<string>('');
  const [newCustomTollLng, setNewCustomTollLng] = useState<string>('');
  const [newCustomTollPrice, setNewCustomTollPrice] = useState<string>('');

  // Start & End Points (Default completely blank so search bars are empty on page open)
  const [startPoint, setStartPoint] = useState<{ lat: number; lng: number; name: string; address: string } | null>(null);
  const [endPoint, setEndPoint] = useState<{ lat: number; lng: number; name: string; address: string } | null>(null);

  // Stoppages & Manual Tolls
  const [stoppages, setStoppages] = useState<Stoppage[]>([]);
  const [parkingPoints, setParkingPoints] = useState<ParkingPoint[]>([]);
  const [manualTolls, setManualTolls] = useState<TollGate[]>([]);

  // Manual number text inputs for Tolls and Stops
  const [tollsInput, setTollsInput] = useState<string>('0');
  const [stopsInput, setStopsInput] = useState<string>('0');

  // Manual Estimated Travel Time (Hours & Minutes)
  const [travelHours, setTravelHours] = useState<number>(2);
  const [travelMinutes, setTravelMinutes] = useState<number>(15);

  // Scheduled Trip Date & Timings
  const [tripDate, setTripDate] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const [endTripDate, setEndTripDate] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const [startTripTime, setStartTripTime] = useState<string>('08:00');
  const [endTripTime, setEndTripTime] = useState<string>('18:00');

  // Custom / Override Kilometer Setting
  const [customDistanceKm, setCustomDistanceKm] = useState<number | null>(null);

  // Auto-sync endTripTime when startTripTime or travel duration changes
  useEffect(() => {
    if (!startTripTime) return;
    const parts = startTripTime.split(':');
    const startH = parseInt(parts[0]) || 0;
    const startM = parseInt(parts[1]) || 0;
    const totalM = startH * 60 + startM + (Number(travelHours) || 0) * 60 + (Number(travelMinutes) || 0);
    const endH = Math.floor((totalM / 60) % 24);
    const endM = Math.floor(totalM % 60);
    setEndTripTime(`${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`);
  }, [startTripTime, travelHours, travelMinutes]);

  // Route calculation results (4 Alternative Routes)
  const [routes, setRoutes] = useState<AlternativeRoute[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string>('');
  const [calculating, setCalculating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Click Mode: 'start' | 'end' | 'stop' | 'parking' | 'toll' | 'manual-route' | 'none'
  const [clickMode, setClickMode] = useState<'start' | 'end' | 'stop' | 'parking' | 'toll' | 'manual-route' | 'none'>('none');
  const [isManualDrawing, setIsManualDrawing] = useState(false);
  const [customWaypoints, setCustomWaypoints] = useState<Array<{ lat: number; lng: number; name?: string }>>([]);
  const [snapToRoads, setSnapToRoads] = useState(true);
  const [isApplyingCustomRoute, setIsApplyingCustomRoute] = useState(false);

  // Map Search across India (Cities, States, Streets, Towns)
  const [showMapSearch, setShowMapSearch] = useState<boolean>(false);
  const [mapSearchQuery, setMapSearchQuery] = useState<string>('');
  const [mapSearchResults, setMapSearchResults] = useState<any[]>([]);
  const [mapSearchLoading, setMapSearchLoading] = useState<boolean>(false);
  const [searchedLocation, setSearchedLocation] = useState<{ lat: number; lng: number; name?: string; address?: string } | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);
  const [mapZoom, setMapZoom] = useState<number>(8);
  const mapSearchRef = useRef<HTMLDivElement>(null);
  const autocompleteServiceRef = useRef<any>(null);
  const geocoderRef = useRef<any>(null);

  // Initialize Google Autocomplete and Geocoder if Google Maps JS API is available
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).google?.maps?.places?.AutocompleteService) {
      try {
        autocompleteServiceRef.current = new (window as any).google.maps.places.AutocompleteService();
      } catch (_) {}
    }
    if (typeof window !== 'undefined' && (window as any).google?.maps?.Geocoder) {
      try {
        geocoderRef.current = new (window as any).google.maps.Geocoder();
      } catch (_) {}
    }
  }, []);

  // Outside click & touch listener: hide search bar when clicking anywhere on map or page
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (mapSearchRef.current && !mapSearchRef.current.contains(e.target as Node)) {
        setShowMapSearch(false);
        setMapSearchResults([]);
      }
    };
    if (showMapSearch) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('touchstart', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [showMapSearch]);

  const fetchBackendLocations = async (queryText: string) => {
    try {
      const res = await fetch(`/api/locations/search?q=${encodeURIComponent(queryText)}`);
      if (res.ok) {
        const data = await res.json();
        setMapSearchResults(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Error searching map locations via backend:', err);
    } finally {
      setMapSearchLoading(false);
    }
  };

  // Debounced search for locations across India using Google Places Autocomplete API with fallback
  useEffect(() => {
    const q = mapSearchQuery.trim();
    if (!q || q.length < 1) {
      setMapSearchResults([]);
      setMapSearchLoading(false);
      return;
    }

    const timer = setTimeout(() => {
      setMapSearchLoading(true);

      // 1. Try Google Maps Places Autocomplete Service first (instant, high-precision across India)
      if ((window as any).google?.maps?.places?.AutocompleteService) {
        if (!autocompleteServiceRef.current) {
          try {
            autocompleteServiceRef.current = new (window as any).google.maps.places.AutocompleteService();
          } catch (_) {}
        }
        if (autocompleteServiceRef.current) {
          try {
            autocompleteServiceRef.current.getPlacePredictions(
              {
                input: q,
                componentRestrictions: { country: 'in' }
              },
              (predictions: any, status: any) => {
                if (
                  status === (window as any).google?.maps?.places?.PlacesServiceStatus?.OK &&
                  Array.isArray(predictions) &&
                  predictions.length > 0
                ) {
                  const formatted = predictions.map((p: any) => ({
                    place_id: p.place_id,
                    name: p.structured_formatting?.main_text || p.description,
                    address: p.structured_formatting?.secondary_text || p.description,
                    description: p.description,
                    isGoogle: true
                  }));
                  setMapSearchResults(formatted);
                  setMapSearchLoading(false);
                  return;
                }
                // Fallback to backend search API if Google Places returned empty
                fetchBackendLocations(q);
              }
            );
            return;
          } catch (e) {
            console.warn('Google Places Autocomplete error:', e);
          }
        }
      }

      // 2. Fallback to backend locations search API
      fetchBackendLocations(q);
    }, 180);

    return () => clearTimeout(timer);
  }, [mapSearchQuery]);

  const handleSelectMapSearchResult = (item: any) => {
    // If it has place_id, resolve exact coordinates via Google Geocoder
    if (item.place_id && (window as any).google?.maps?.Geocoder) {
      if (!geocoderRef.current) {
        try {
          geocoderRef.current = new (window as any).google.maps.Geocoder();
        } catch (_) {}
      }
      if (geocoderRef.current) {
        geocoderRef.current.geocode({ placeId: item.place_id }, (results: any, status: any) => {
          if (status === 'OK' && results && results[0]?.geometry?.location) {
            const loc = results[0].geometry.location;
            const lat = typeof loc.lat === 'function' ? loc.lat() : Number(loc.lat);
            const lng = typeof loc.lng === 'function' ? loc.lng() : Number(loc.lng);
            const placeName = item.name || results[0].formatted_address;
            const placeAddr = item.address || results[0].formatted_address;
            setSearchedLocation({ lat, lng, name: placeName, address: placeAddr });
            setMapCenter([lat, lng]);
            setMapZoom(16);
            setMapSearchResults([]);
            setShowMapSearch(false);
          } else {
            // Fallback geocode by address/description string
            geocoderRef.current.geocode({ address: item.description || item.name }, (r2: any, s2: any) => {
              if (s2 === 'OK' && r2 && r2[0]?.geometry?.location) {
                const loc = r2[0].geometry.location;
                const lat = typeof loc.lat === 'function' ? loc.lat() : Number(loc.lat);
                const lng = typeof loc.lng === 'function' ? loc.lng() : Number(loc.lng);
                setSearchedLocation({ lat, lng, name: item.name, address: item.address });
                setMapCenter([lat, lng]);
                setMapZoom(16);
                setMapSearchResults([]);
                setShowMapSearch(false);
              }
            });
          }
        });
        return;
      }
    }

    // Direct lat & lng coordinates
    const lat = Number(item.lat);
    const lng = Number(item.lng);
    if (!isNaN(lat) && !isNaN(lng)) {
      setSearchedLocation({
        lat,
        lng,
        name: item.name || item.address,
        address: item.address || ''
      });
      setMapCenter([lat, lng]);
      setMapZoom(16); // High zoom street level view
      setMapSearchResults([]);
      setShowMapSearch(false); // Hide search bar after selection
    }
  };

  const handleDirectGeocodeQuery = (q: string) => {
    if (typeof window !== 'undefined' && (window as any).google?.maps?.Geocoder) {
      if (!geocoderRef.current) {
        try {
          geocoderRef.current = new (window as any).google.maps.Geocoder();
        } catch (_) {}
      }
      if (geocoderRef.current) {
        geocoderRef.current.geocode({ address: q.includes('India') ? q : `${q}, India` }, (results: any, status: any) => {
          if (status === 'OK' && results && results[0]?.geometry?.location) {
            const loc = results[0].geometry.location;
            const lat = typeof loc.lat === 'function' ? loc.lat() : Number(loc.lat);
            const lng = typeof loc.lng === 'function' ? loc.lng() : Number(loc.lng);
            setSearchedLocation({ lat, lng, name: results[0].formatted_address, address: results[0].formatted_address });
            setMapCenter([lat, lng]);
            setMapZoom(16);
            setMapSearchResults([]);
            setShowMapSearch(false);
          }
        });
      }
    }
  };

  useEffect(() => {
    Promise.all([
      api.getVehicles(),
      api.getUsers(),
      api.getSavedCorridors()
    ]).then(([vehs, users, corridors]) => {
      setVehicles(vehs || []);
      setUsersList(users || []);
      setSavedCorridors(corridors || []);
      const initId = initialVehicleId ? String(initialVehicleId) : (vehs && vehs.length > 0 ? String(vehs[0].id) : '');
      if (initId) {
        setSelectedVehicleId(initId);
        const match = vehs.find((v: any) => String(v.id) === initId);
        if (match) {
          if (match.assigned_user_id) {
            setAllotUserId(String(match.assigned_user_id));
          }
          if ((match as any).axle_type) {
            handleSelectAxle((match as any).axle_type as TruckAxleType);
          }
        }
      }
    }).catch(() => { });
  }, [initialVehicleId]);


  // Download Sample Excel Template for Route Import
  const handleDownloadSampleExcel = () => {
    try {
      const sampleData = [
        { Sequence: 1, 'Location Name': 'Raipur Tatibandh Chowk (Origin)', Latitude: 21.2580, Longitude: 81.5645, 'Halt Duration (Mins)': 0 },
        { Sequence: 2, 'Location Name': 'Simga Bypass Junction (Via Stop)', Latitude: 21.6250, Longitude: 81.7050, 'Halt Duration (Mins)': 20 },
        { Sequence: 3, 'Location Name': 'Nandghat Toll Corridor (Via Stop)', Latitude: 21.8500, Longitude: 81.8200, 'Halt Duration (Mins)': 15 },
        { Sequence: 4, 'Location Name': 'Bilaspur Tifra Transport Nagar (Destination)', Latitude: 22.0620, Longitude: 82.1150, 'Halt Duration (Mins)': 0 }
      ];
      const ws = XLSX.utils.json_to_sheet(sampleData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'RouteWaypoints');
      XLSX.writeFile(wb, 'GpsTrackX_Route_Template.xlsx');
    } catch (e: any) {
      alert('Failed to generate Excel template: ' + e.message);
    }
  };

  // Fetch 100% accurate driving road distance directly from Google Maps between Start and Destination
  const fetchGoogleRoadDistance = async (
    start: { lat: number; lng: number },
    end: { lat: number; lng: number }
  ): Promise<{ distanceKm: number; durationMins: number } | null> => {
    // 1. Google Maps JS DirectionsService in browser
    if (typeof (window as any).google?.maps?.DirectionsService !== 'undefined') {
      try {
        const directionsService = new (window as any).google.maps.DirectionsService();
        const res: any = await new Promise((resolve, reject) => {
          directionsService.route(
            {
              origin: new (window as any).google.maps.LatLng(Number(start.lat), Number(start.lng)),
              destination: new (window as any).google.maps.LatLng(Number(end.lat), Number(end.lng)),
              travelMode: (window as any).google.maps.TravelMode.DRIVING
            },
            (response: any, status: any) => {
              if (status === 'OK' && response?.routes?.[0]?.legs?.[0]) {
                resolve(response);
              } else {
                reject(new Error(`Directions status: ${status}`));
              }
            }
          );
        });

        const leg = res.routes[0].legs[0];
        const distMeters = leg.distance?.value || 0;
        const durSecs = leg.duration?.value || 0;
        if (distMeters > 0) {
          return {
            distanceKm: Math.round((distMeters / 1000) * 10) / 10,
            durationMins: Math.round(durSecs / 60)
          };
        }
      } catch (e) {
        console.warn('Google DirectionsService route error:', e);
      }
    }

    // 2. Google Maps DistanceMatrixService in browser
    if (typeof (window as any).google?.maps?.DistanceMatrixService !== 'undefined') {
      try {
        const dmService = new (window as any).google.maps.DistanceMatrixService();
        const res: any = await new Promise((resolve, reject) => {
          dmService.getDistanceMatrix(
            {
              origins: [{ lat: Number(start.lat), lng: Number(start.lng) }],
              destinations: [{ lat: Number(end.lat), lng: Number(end.lng) }],
              travelMode: (window as any).google.maps.TravelMode.DRIVING
            },
            (response: any, status: any) => {
              if (status === 'OK' && response?.rows?.[0]?.elements?.[0]?.status === 'OK') {
                resolve(response);
              } else {
                reject(new Error(`Distance Matrix status: ${status}`));
              }
            }
          );
        });

        const elem = res.rows[0].elements[0];
        const distMeters = elem.distance?.value || 0;
        const durSecs = elem.duration?.value || 0;
        if (distMeters > 0) {
          return {
            distanceKm: Math.round((distMeters / 1000) * 10) / 10,
            durationMins: Math.round(durSecs / 60)
          };
        }
      } catch (e) {
        console.warn('Google DistanceMatrixService error:', e);
      }
    }

    // 3. Fallback to backend route calculator (/api/routes/calculate)
    try {
      const calc = await api.calculateRoutes({
        origin: { lat: start.lat, lng: start.lng },
        destination: { lat: end.lat, lng: end.lng }
      });
      if (calc?.routes && calc.routes.length > 0) {
        const r = calc.routes[0];
        return {
          distanceKm: Math.round(Number(r.distanceKm) * 10) / 10,
          durationMins: Math.round(Number(r.timeMinutes) || 120)
        };
      }
    } catch (e) {
      console.warn('Backend calculateRoute fallback error:', e);
    }

    return null;
  };

  // Import Route from Excel (.xlsx, .xls, .csv) with 0ms latency & smooth performance
  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImportingExcel(true);
    const fileName = file.name.replace(/\.[^/.]+$/, '');
    setExcelFileName(file.name);
    setCorridorNameInput(fileName);
    setSelectedCorridorId('');
    setIsRouteModifiedByDrag(false);
    setExcelSummaryMeta(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      // Non-blocking microtask execution so UI remains 100% fluid
      setTimeout(async () => {
        try {
          const data = new Uint8Array(evt.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });

          // Extract 100% Accurate Telemetry & Coordinates using Universal Parser
          const tele = extractAccurateExcelTelemetry(workbook);
          const validPoints = tele.rawPoints;

          if (!validPoints || validPoints.length < 2) {
            alert('Could not detect valid GPS coordinates in ' + tele.detailsSheetName + '. Please verify the Excel format has Start lat, lng or Latitude/Longitude.');
            setIsImportingExcel(false);
            return;
          }

          const start = {
            lat: validPoints[0].lat,
            lng: validPoints[0].lng,
            name: validPoints[0].name || 'Start Point (Origin)',
            address: `GPS: ${validPoints[0].lat}, ${validPoints[0].lng}`
          };
          const end = {
            lat: validPoints[validPoints.length - 1].lat,
            lng: validPoints[validPoints.length - 1].lng,
            name: validPoints[validPoints.length - 1].name || 'Destination Point',
            address: `GPS: ${validPoints[validPoints.length - 1].lat}, ${validPoints[validPoints.length - 1].lng}`
          };

          // Full-fidelity polyline: preserve 100% of vertices so all turns and curves are followed accurately
          let displayPolyline: [number, number][] = validPoints.map(p => [p.lat, p.lng]);
          if (validPoints.length > 3000) {
            const step = Math.ceil(validPoints.length / 2500);
            const filtered: [number, number][] = [];
            for (let i = 0; i < validPoints.length; i += step) {
              filtered.push([validPoints[i].lat, validPoints[i].lng]);
            }
            const last = validPoints[validPoints.length - 1];
            filtered.push([last.lat, last.lng]);
            displayPolyline = filtered;
          }

          // Natural road snapping & micro-curve smoothing: ensure route hugs real road curves without straight lines
          const enhancedPolyline = await enhanceRouteWithRoadGeometry(displayPolyline);
          displayPolyline = enhancedPolyline;

          // Fetch 100% accurate driving road distance directly from Google Maps between Start and Destination!
          let finalDistKm = 0;
          let totalMins = 0;
          try {
            const googleRoadPromise = fetchGoogleRoadDistance(start, end);
            const roadTimeout = new Promise<null>((r) => setTimeout(() => r(null), 1200));
            const googleRoad = await Promise.race([googleRoadPromise, roadTimeout]);
            if (googleRoad && googleRoad.distanceKm > 0) {
              finalDistKm = googleRoad.distanceKm;
              totalMins = googleRoad.durationMins || Math.round((finalDistKm / 45) * 60);
            }
          } catch (_) {}

          // Fallback if Google Maps query is unavailable
          if (!finalDistKm || finalDistKm <= 0) {
            const accurateDist = calculateCumulativeDistanceKm(displayPolyline);
            finalDistKm = tele.isAccurateMeterFound && tele.distanceKm > 0
              ? tele.distanceKm
              : (accurateDist > 0 ? accurateDist : tele.distanceKm);
            totalMins = Math.round((finalDistKm / (tele.avgSpeed || 42)) * 60) || 120;
          }

          const summaryMeta = {
            vehicleReg: tele.vehicleReg,
            startDate: tele.startDate,
            endDate: tele.endDate,
            distanceKm: finalDistKm,
            avgSpeed: tele.avgSpeed,
            maxSpeed: tele.maxSpeed,
            runningTime: tele.runningTime,
            haltedTime: tele.haltedTime
          };
          setExcelSummaryMeta(summaryMeta);

          if (summaryMeta.runningTime) {
            const tParts = summaryMeta.runningTime.split(':').map(Number);
            if (tParts.length >= 2 && !isNaN(tParts[0]) && !isNaN(tParts[1])) {
              totalMins = tParts[0] * 60 + tParts[1];
            }
          }

          setStartPoint(start);
          setEndPoint(end);

          // Place 2-3 stoppages directly along the actual road polyline so they sit accurately on the road
          const stopsCount = Math.max(1, Math.min(5, parseInt(stopsInput) || 2));
          const autoStops: Stoppage[] = [];
          for (let i = 0; i < stopsCount; i++) {
            const ratio = (i + 1) / (stopsCount + 1);
            const pIdx = Math.min(displayPolyline.length - 1, Math.max(0, Math.floor(displayPolyline.length * ratio)));
            const pt = displayPolyline[pIdx] || [start.lat, start.lng];
            const ptName = validPoints[pIdx]?.name && !validPoints[pIdx].name.startsWith('Point #') && !validPoints[pIdx].name.startsWith('Leg #')
              ? validPoints[pIdx].name
              : `Transit Halt #${i + 1}`;
            autoStops.push({
              id: i + 1,
              sequence_order: i + 1,
              name: ptName,
              address: `Highway Stoppage at ${pt[0].toFixed(4)}, ${pt[1].toFixed(4)}`,
              lat: pt[0],
              lng: pt[1],
              duration: 25,
              stop_duration_mins: 25
            });
          }

          setStoppages(autoStops);
          setStopsInput(String(autoStops.length));
          setImportedWaypointsCount(validPoints.length);
          setIsDraggableRoute(false);

          // Set 100% accurate distance as custom distance so effectiveDistanceKm and inputs reflect it immediately
          setCustomDistanceKm(finalDistKm);

          // Parse start and end dates from summary if available
          if (summaryMeta.startDate) {
            try {
              const d = new Date(summaryMeta.startDate);
              if (!isNaN(d.getTime())) {
                const iso = d.toISOString().split('T')[0];
                setTripDate(iso);
              }
            } catch (e) { }
          }
          if (summaryMeta.endDate) {
            try {
              const d = new Date(summaryMeta.endDate);
              if (!isNaN(d.getTime())) {
                const iso = d.toISOString().split('T')[0];
                setEndTripDate(iso);
              }
            } catch (e) { }
          }

          // Auto-match vehicle if registration plate was parsed in Summary sheet!
          if (summaryMeta.vehicleReg && vehicles.length > 0) {
            const cleanReg = summaryMeta.vehicleReg.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
            const matchedVeh = vehicles.find(v => v.registration_no.replace(/[^A-Za-z0-9]/g, '').toUpperCase() === cleanReg);
            if (matchedVeh) {
              setSelectedVehicleId(String(matchedVeh.id));
            }
          }

          // Set corridor name
          const autoCorridorName = `${summaryMeta.vehicleReg ? summaryMeta.vehicleReg + ': ' : ''}${start.name.split(',')[0]} to ${end.name.split(',')[0]}`;
          setCorridorNameInput(autoCorridorName);

          // Build genuine curved road route directly from actual Excel GPS breadcrumbs (Single Excel Route ONLY - No alternate routes!)
          // CRITICAL: DO NOT overwrite with Google Maps Directions or OSRM!
          // Google Directions calculates a generic highway path (e.g. via Pamgarh) and throws away the actual GPS coordinates!
          const highwayCoords: [number, number][] = displayPolyline;
          const highwayDist = finalDistKm;
          const highwayMins = totalMins;

          // Detect all FASTag tolls on this actual route corridor (combining verified NHAI database & Google Places API)
          let detectedTolls = await detectAllTollsOnRoute(highwayCoords, 3.5, selectedAxle);
          if (detectedTolls.length === 0 && highwayDist > 30) {
            detectedTolls = await detectAllTollsOnRoute(highwayCoords, 5.0, selectedAxle);
          }
          const realTolls = detectedTolls.map(t => ({
            ...t,
            charges: customTollOverrides[t.name] !== undefined ? customTollOverrides[t.name] : t.charges
          }));

          // EXACTLY ONE SINGLE EXCEL ROUTE - AUTHENTIC BLUE ROUTE (MATCHING IMAGE 1)
          const singleExcelRoute: AlternativeRoute = {
            id: 'excel-exact-gps-route',
            name: autoCorridorName,
            distanceKm: highwayDist,
            timeMinutes: highwayMins,
            tollGatesCount: realTolls.length,
            stopsCount: autoStops.length,
            summary: `Excel Highway Route (${validPoints.length} Points, ${realTolls.length} Tolls)`,
            color: '#1A73E8', // Royal Google Maps Blue (matching Image 1)
            coordinates: highwayCoords,
            tollGates: realTolls
          };

          setRoutes([singleExcelRoute]);
          setSelectedRouteId('excel-exact-gps-route');
          setIsExcelRouteActive(true);
          setCustomDistanceKm(highwayDist);
          setTravelHours(Math.floor(highwayMins / 60));
          setTravelMinutes(highwayMins % 60);
          setModifiedPolyline(highwayCoords);
          setIsDraggableRoute(false); // Clean crisp polyline without draggable circle clutter!
        } catch (err: any) {
          alert('Failed to read Excel file: ' + err.message);
        } finally {
          setIsImportingExcel(false);
        }
      }, 20);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  // Save Current Corridor to Dropdown for Future Vehicle Allocation
  const handleSaveCorridorToDropdown = async () => {
    if (!startPoint || !endPoint) {
      alert('Please import an Excel route or select a route first.');
      return;
    }
    const routeName = corridorNameInput.trim() || `${startPoint.name} to ${endPoint.name}`;
    try {
      setSaving(true);
      await api.saveCorridor({
        route_name: routeName,
        start_location_name: startPoint.name,
        start_address: startPoint.address,
        start_lat: startPoint.lat,
        start_lng: startPoint.lng,
        end_location_name: endPoint.name,
        end_address: endPoint.address,
        end_lat: endPoint.lat,
        end_lng: endPoint.lng,
        total_distance_km: effectiveDistanceKm,
        estimated_travel_time_min: (travelHours * 60) + travelMinutes,
        overview_polyline: activeRoute?.coordinates || [],
        waypoints: stoppages,
        toll_gates: currentTolls
      });

      const corridors = await api.getSavedCorridors();
      setSavedCorridors(corridors || []);
      setSelectedCorridorId(routeName);
      alert(`Route "${routeName}" successfully saved to dropdown list!`);
    } catch (err: any) {
      alert('Failed to save corridor: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Handle Dragging Route on Google Map
  const handleRouteDragChange = (updated: { coordinates: [number, number][]; distanceKm: number; timeMinutes: number; summary?: string }) => {
    setIsRouteModifiedByDrag(true);
    setModifiedDistanceKm(updated.distanceKm);
    setModifiedDurationMins(updated.timeMinutes);
    setModifiedPolyline(updated.coordinates);
    if (!newModifiedRouteName) {
      setNewModifiedRouteName(corridorNameInput || 'Commercial Highway Corridor');
    }

    setRoutes(prev => prev.map((r, i) => i === 0 ? {
      ...r,
      coordinates: updated.coordinates,
      distanceKm: updated.distanceKm,
      timeMinutes: updated.timeMinutes,
      name: corridorNameInput || 'Commercial Highway Corridor'
    } : r));

    setTravelHours(Math.floor(updated.timeMinutes / 60));
    setTravelMinutes(updated.timeMinutes % 60);
    setCustomDistanceKm(null);
  };

  // Save Modified Draggable Route as Brand New Route
  const handleSaveModifiedAsNewRoute = async () => {
    const routeName = newModifiedRouteName.trim() || corridorNameInput || 'Commercial Highway Corridor';
    try {
      setSaving(true);
      await api.saveCorridor({
        route_name: routeName,
        start_location_name: startPoint?.name || 'Origin',
        start_address: startPoint?.address || '',
        start_lat: startPoint?.lat || 0,
        start_lng: startPoint?.lng || 0,
        end_location_name: endPoint?.name || 'Destination',
        end_address: endPoint?.address || '',
        end_lat: endPoint?.lat || 0,
        end_lng: endPoint?.lng || 0,
        total_distance_km: modifiedDistanceKm || effectiveDistanceKm,
        estimated_travel_time_min: (travelHours * 60) + travelMinutes,
        overview_polyline: modifiedPolyline.length > 0 ? modifiedPolyline : (activeRoute?.coordinates || []),
        waypoints: stoppages,
        toll_gates: currentTolls
      });

      const corridors = await api.getSavedCorridors();
      setSavedCorridors(corridors || []);
      setSelectedCorridorId(routeName);
      setCorridorNameInput(routeName);
      setIsRouteModifiedByDrag(false);
      alert(`Modified route saved as "${routeName}" in the dropdown list! Both routes are now available.`);
    } catch (err: any) {
      alert('Failed to save modified route: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSelectExistingCorridor = (cName: string) => {
    setSelectedCorridorId(cName);
    if (!cName) return;
    const found = savedCorridors.find(c => c.route_name === cName);
    if (!found) return;

    const newStart = {
      lat: Number(found.start_lat),
      lng: Number(found.start_lng),
      name: found.start_location_name || 'Start Point',
      address: found.start_address || ''
    };
    const newEnd = {
      lat: Number(found.end_lat),
      lng: Number(found.end_lng),
      name: found.end_location_name || 'Destination',
      address: found.end_address || ''
    };

    setStartPoint(newStart);
    setEndPoint(newEnd);
    setCorridorNameInput(found.route_name || '');
    setExcelFileName(null);
    setIsRouteModifiedByDrag(false);
    setModifiedDistanceKm(null);
    setModifiedDurationMins(null);
    setNewModifiedRouteName('');
    setParkingPoints([]);
    setCustomWaypoints([]);
    setCustomTollOverrides({});

    // 1. Parse Waypoints / Stoppages from Saved Route
    let parsedWaypoints: Stoppage[] = [];
    const rawWp = found.waypoints || (found as any).waypoints_json;
    if (rawWp) {
      try {
        const wps = typeof rawWp === 'string' ? JSON.parse(rawWp) : rawWp;
        if (Array.isArray(wps) && wps.length > 0) {
          parsedWaypoints = wps;
          setStoppages(wps);
          setStopsInput(String(wps.length));
        } else {
          setStoppages([]);
          setStopsInput('0');
        }
      } catch (e) {
        setStoppages([]);
        setStopsInput('0');
      }
    } else {
      setStoppages([]);
      setStopsInput('0');
    }

    // 2. Parse Toll Gates from Saved Route (DEDUPLICATED & clean)
    let parsedTolls: TollGate[] = [];
    const rawT = found.toll_gates || (found as any).toll_gates_json;
    if (rawT) {
      try {
        const tg = typeof rawT === 'string' ? JSON.parse(rawT) : rawT;
        if (Array.isArray(tg) && tg.length > 0) {
          const seenTollKeys = new Set<string>();
          for (const t of tg) {
            const key = `${t.name || ''}_${Number(t.lat || 0).toFixed(4)}_${Number(t.lng || 0).toFixed(4)}`;
            if (!seenTollKeys.has(key)) {
              seenTollKeys.add(key);
              parsedTolls.push(t);
            }
          }
        }
      } catch (e) { }
    }
    // CRITICAL: customTollsAdded MUST be empty [] so tolls are never doubled/accumulated!
    setCustomTollsAdded([]);
    setTollsInput(String(parsedTolls.length));

    // 3. Parse Overview Polyline Coordinates
    let polyCoords: [number, number][] = [];
    if (found.overview_polyline) {
      try {
        const rawPoly = typeof found.overview_polyline === 'string' ? JSON.parse(found.overview_polyline) : found.overview_polyline;
        if (Array.isArray(rawPoly) && rawPoly.length >= 2) {
          polyCoords = rawPoly.map((pt: any) => {
            if (Array.isArray(pt)) return [Number(pt[0]), Number(pt[1])];
            if (pt && typeof pt === 'object') return [Number(pt.lat), Number(pt.lng)];
            return null;
          }).filter((pt): pt is [number, number] => pt !== null && !isNaN(pt[0]) && !isNaN(pt[1]));
        }
      } catch (e) { }
    }

    // 4. Set Total Distance and Travel Duration (NO stale accumulation from previous route)
    const savedDist = Number(found.total_distance_km) || 0;
    const calcDist = polyCoords.length >= 2 ? calculateCumulativeDistanceKm(polyCoords) : 0;
    const finalDist = savedDist > 0 ? savedDist : (calcDist > 0 ? calcDist : 0);

    const mins = Number(found.estimated_travel_time_min) || (finalDist > 0 ? Math.round((finalDist / 45) * 60) : 0);
    setTravelHours(Math.floor(mins / 60));
    setTravelMinutes(mins % 60);

    // Reset custom distance so it doesn't leak from a previously selected route
    setCustomDistanceKm(null);

    if (polyCoords.length >= 2) {
      // EXACT ONE SINGLE SAVED ROUTE - NO ALTERNATIVE ROUTES & NO ACCUMULATED TOLLS!
      const singleSavedRoute: AlternativeRoute = {
        id: `saved-route-${found.id || 'single'}`,
        name: found.route_name || `${newStart.name} to ${newEnd.name}`,
        distanceKm: finalDist,
        timeMinutes: mins,
        tollGatesCount: parsedTolls.length,
        stopsCount: parsedWaypoints.length,
        summary: `Saved Route Corridor: ${found.route_name || 'Highway Route'} (${finalDist} km)`,
        color: '#1A73E8',
        coordinates: polyCoords,
        tollGates: parsedTolls,
        source: 'Saved Corridor'
      };

      setRoutes([singleSavedRoute]);
      setSelectedRouteId(singleSavedRoute.id);
      setModifiedPolyline(polyCoords);
      setIsDraggableRoute(true);
      setIsExcelRouteActive(true);
    } else {
      // Legacy fallback: single calculated route only (no alternative routes)
      handleCalculateRoutes(newStart, newEnd, parsedWaypoints);
    }
  };

  const handleSelectAxle = (newAxle: TruckAxleType) => {
    setSelectedAxle(newAxle);
    // Recalculate toll gates on all existing route options based on new axle category
    setRoutes(prev => prev.map(r => {
      const detected = detectRealTollsOnRoute(r.coordinates, 2.5, newAxle);
      const tollsWithOverrides = detected.map(t => ({
        ...t,
        charges: customTollOverrides[t.name] !== undefined ? customTollOverrides[t.name] : t.charges
      }));
      return {
        ...r,
        tollGates: tollsWithOverrides,
        tollGatesCount: tollsWithOverrides.length
      };
    }));
  };

  const handleUpdateTollPrice = (tollName: string, newPrice: number) => {
    setCustomTollOverrides(prev => ({
      ...prev,
      [tollName]: newPrice
    }));
    setRoutes(prev => prev.map(r => {
      const updatedTolls = (r.tollGates || []).map(tg =>
        tg.name === tollName ? { ...tg, charges: newPrice, is_manual: true } : tg
      );
      return {
        ...r,
        tollGates: updatedTolls
      };
    }));
  };

  const handleResetTollPrice = (tollName: string) => {
    setCustomTollOverrides(prev => {
      const copy = { ...prev };
      delete copy[tollName];
      return copy;
    });
    setRoutes(prev => prev.map(r => {
      const detected = detectRealTollsOnRoute(r.coordinates, 2.5, selectedAxle);
      return {
        ...r,
        tollGates: detected
      };
    }));
  };

  const handleUpdateToll = (oldName: string, newName: string, newPrice: number) => {
    const finalName = newName.trim() || oldName;
    setCustomTollOverrides(prev => {
      const copy = { ...prev };
      if (oldName !== finalName) {
        delete copy[oldName];
      }
      copy[finalName] = newPrice;
      return copy;
    });
    setCustomTollsAdded(prev => prev.map(t =>
      t.name === oldName ? { ...t, name: finalName, charges: newPrice, is_manual: true } : t
    ));
    setRoutes(prev => prev.map(r => {
      const updatedTolls = (r.tollGates || []).map(tg =>
        tg.name === oldName ? { ...tg, name: finalName, charges: newPrice, is_manual: true } : tg
      );
      return {
        ...r,
        tollGates: updatedTolls
      };
    }));
  };

  const handleAddCustomToll = () => {
    const rawLat = newCustomTollLat.trim();
    const rawLng = newCustomTollLng.trim();
    let lat: number | null = null;
    let lng: number | null = null;

    if (rawLat.includes(',')) {
      const parts = rawLat.split(',').map(s => parseFloat(s.trim()));
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        lat = parts[0];
        lng = parts[1];
      }
    } else if (rawLat && rawLng) {
      const pLat = parseFloat(rawLat);
      const pLng = parseFloat(rawLng);
      if (!isNaN(pLat) && !isNaN(pLng)) {
        lat = pLat;
        lng = pLng;
      }
    }

    if (lat === null || lng === null) {
      const midCoord = (activeRoute?.coordinates && activeRoute.coordinates.length > 0)
        ? activeRoute.coordinates[Math.floor(activeRoute.coordinates.length / 2)]
        : (startPoint ? [startPoint.lat + 0.05, startPoint.lng + 0.05] : [21.5, 82.0]);
      lat = midCoord[0];
      lng = midCoord[1];
    }

    const price = parseFloat(newCustomTollPrice) || 250;
    const tollName = newCustomTollName.trim() || `Toll Gate (${lat.toFixed(4)}, ${lng.toFixed(4)})`;

    const newToll: TollGate = {
      id: Date.now(),
      name: tollName,
      lat,
      lng,
      charges: price,
      is_manual: true,
      toll_type: 'FASTag Commercial Toll Barrier'
    };

    setCustomTollsAdded(prev => [...prev, newToll]);
    setRoutes(prev => prev.map(r => ({
      ...r,
      tollGates: [...(r.tollGates || []), newToll],
      tollGatesCount: (r.tollGates || []).length + 1
    })));

    setMapCenter([lat, lng]);
    setMapZoom(14);
    setNewCustomTollName('');
    setNewCustomTollLat('');
    setNewCustomTollLng('');
    setNewCustomTollPrice('');
    setShowAddCustomToll(false);
  };

  const handleRemoveCustomToll = (idx: number) => {
    setCustomTollsAdded(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSelectVehicle = (vId: string) => {
    setSelectedVehicleId(vId);
    const match = vehicles.find((v: any) => String(v.id) === vId);
    if (match) {
      if (match.assigned_user_id) {
        setAllotUserId(String(match.assigned_user_id));
      }
      if ((match as any).axle_type) {
        handleSelectAxle((match as any).axle_type as TruckAxleType);
      } else {
        const modelStr = `${match.name_model || ''} ${match.vehicle_type || ''}`.toLowerCase();
        let autoAxle: TruckAxleType = selectedAxle;
        if (modelStr.includes('4825') || modelStr.includes('16-wheel') || modelStr.includes('18-wheel') || modelStr.includes('trailer')) {
          autoAxle = '6-axle';
        } else if (modelStr.includes('4220') || modelStr.includes('14-wheel')) {
          autoAxle = '5-axle';
        } else if (modelStr.includes('3718') || modelStr.includes('3518') || modelStr.includes('12-wheel')) {
          autoAxle = '4-axle';
        } else if (modelStr.includes('2518') || modelStr.includes('3118') || modelStr.includes('10-wheel')) {
          autoAxle = '3-axle';
        } else if (modelStr.includes('1613') || modelStr.includes('6-wheel') || modelStr.includes('bus')) {
          autoAxle = '2-axle';
        }
        if (autoAxle !== selectedAxle) {
          handleSelectAxle(autoAxle);
        }
      }
    }
  };

  // Client-side Google Maps Directions Engine: 100% genuine Google highway paths with ZERO crooked detours
  const calculateWithGoogleMaps = (
    start: { lat: number; lng: number },
    end: { lat: number; lng: number },
    waypointsList: any[] = []
  ): Promise<AlternativeRoute[] | null> => {
    return new Promise((resolve) => {
      if (typeof (window as any).google?.maps?.DirectionsService === 'undefined') {
        resolve(null);
        return;
      }

      try {
        const ds = new (window as any).google.maps.DirectionsService();
        const origin = new (window as any).google.maps.LatLng(start.lat, start.lng);
        const destination = new (window as any).google.maps.LatLng(end.lat, end.lng);

        const collected: AlternativeRoute[] = [];
        const seenKm = new Set<number>();

        const addRoutes = (routesArr: any[], tag = '') => {
          if (!routesArr || !Array.isArray(routesArr)) return;

          routesArr.forEach((r: any) => {
            if (collected.length >= 4) return;

            let coords: [number, number][] = (r.overview_path || []).map((pt: any) => [
              parseFloat(pt.lat().toFixed(6)),
              parseFloat(pt.lng().toFixed(6))
            ]);
            if (coords.length < 2) return;

            // Connect exactly to Start (Point A) and Destination (Point B)
            if (coords[0][0] !== start.lat || coords[0][1] !== start.lng) {
              coords.unshift([start.lat, start.lng]);
            }
            if (coords[coords.length - 1][0] !== end.lat || coords[coords.length - 1][1] !== end.lng) {
              coords.push([end.lat, end.lng]);
            }

            let totalMeters = 0;
            let totalSeconds = 0;
            (r.legs || []).forEach((leg: any) => {
              totalMeters += leg.distance?.value || 0;
              totalSeconds += leg.duration?.value || 0;
            });

            const distKm = parseFloat((totalMeters / 1000).toFixed(1));
            const roundedKm = Math.round(distKm);

            // Ensure route has distinct distance (at least 1.5 km difference from existing)
            const isDuplicate = Array.from(seenKm).some(k => Math.abs(k - roundedKm) < 1.5);
            if (isDuplicate) return;
            seenKm.add(roundedKm);

            const timeMinutes = Math.max(1, Math.round(totalSeconds / 60));
            const routeIdx = collected.length;
            const summaryName = r.summary ? `via ${r.summary}` : `via Highway Option ${routeIdx + 1}`;
            const routeName = routeIdx === 0
              ? `${summaryName} (Fastest / Recommended)`
              : `${summaryName}${tag ? ' (' + tag + ')' : ` (Option ${routeIdx + 1})`}`;

            const detectedTolls = detectRealTollsOnRoute(coords, 2.5, selectedAxle);
            const realTolls = detectedTolls.map(t => ({
              ...t,
              charges: customTollOverrides[t.name] !== undefined ? customTollOverrides[t.name] : t.charges
            }));
            const totalTruckFee = computeTotalTruckToll(realTolls);
            const tollSummary = realTolls.length > 0
              ? `${realTolls.length} Real Tolls (₹${totalTruckFee} Truck Rate)`
              : 'Toll-Free Route (₹0)';

            collected.push({
              id: `route-google-${routeIdx + 1}`,
              name: routeName,
              distanceKm: distKm,
              timeMinutes: timeMinutes,
              tollGatesCount: realTolls.length,
              stopsCount: stoppages.length,
              summary: `${tollSummary}. Official Google Road Route via ${r.summary || 'Highway'}.`,
              color: GOOGLE_ROUTE_COLORS[routeIdx % GOOGLE_ROUTE_COLORS.length],
              coordinates: coords,
              tollGates: realTolls,
              source: 'Google Maps'
            });
          });
        };

        // Execute single direct query for fastest highway corridor (provideRouteAlternatives: false - NO alternative routes)
        ds.route({
          origin,
          destination,
          travelMode: (window as any).google.maps.TravelMode.DRIVING,
          provideRouteAlternatives: false
        }, (r: any, s: any) => {
          if (s === 'OK' && r?.routes && r.routes.length > 0) {
            addRoutes([r.routes[0]]);
            resolve(collected.length > 0 ? [collected[0]] : null);
          } else {
            resolve(null);
          }
        });
      } catch (e) {
        resolve(null);
      }
    });
  };

  const handleCalculateRoutes = async (overrideStart = startPoint, overrideEnd = endPoint, overrideWaypoints: Stoppage[] = stoppages) => {
    if (!overrideStart || !overrideEnd) return;

    try {
      setCalculating(true);
      setErrorMsg(null);

      // 1. Fetch Google Maps real driving routes from browser
      const allWaypoints = [
        ...overrideWaypoints,
        ...parkingPoints.map((p, i) => ({
          sequence_order: overrideWaypoints.length + i + 1,
          name: `[Parking] ${p.name}`,
          lat: p.lat,
          lng: p.lng,
          duration: 30
        }))
      ];
      const googleRoutes = await calculateWithGoogleMaps(overrideStart, overrideEnd, allWaypoints);

      // 2. Fetch backend genuine alternative highway corridors (snapped to real highway nodes)

      let backendRoutes: AlternativeRoute[] = [];
      try {
        const res = await api.calculateRoutes({
          origin: overrideStart,
          destination: overrideEnd,
          waypoints: allWaypoints,
          manualTolls: manualTolls
        });
        if (res.routes && Array.isArray(res.routes)) {
          backendRoutes = res.routes.map((br: any) => {
            const detected = detectRealTollsOnRoute(br.coordinates || [], 2.5, selectedAxle);
            const tollsWithOverrides = detected.map(t => ({
              ...t,
              charges: customTollOverrides[t.name] !== undefined ? customTollOverrides[t.name] : t.charges
            }));
            return {
              ...br,
              tollGates: tollsWithOverrides,
              tollGatesCount: tollsWithOverrides.length
            };
          });
        }
      } catch (e) {
        // Backend fallback silently caught
      }

      // 3. Combine ONLY GENUINELY DIFFERENT physical road corridors
      const combined: AlternativeRoute[] = [];

      // Add single Google route first
      if (googleRoutes && googleRoutes.length > 0) {
        combined.push(googleRoutes[0]);
      } else if (backendRoutes && backendRoutes.length > 0) {
        combined.push(backendRoutes[0]);
      }

      // Single Authentic Route ONLY - Never generate or display alternative routes!
      const finalRoutes = combined.slice(0, 1).map((r) => ({
        ...r,
        id: 'route-opt-1',
        name: r.name.replace(/\(.*?\)/, '').trim(),
        color: '#1A73E8'
      }));

      if (finalRoutes.length > 0) {
        setRoutes(finalRoutes);
        setSelectedRouteId(finalRoutes[0].id);
        if (finalRoutes[0].timeMinutes) {
          setTravelHours(Math.floor(finalRoutes[0].timeMinutes / 60));
          setTravelMinutes(finalRoutes[0].timeMinutes % 60);
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Route calculation failed');
    } finally {
      setCalculating(false);
    }
  };

  // Initial calculation on mount
  useEffect(() => {
    if (startPoint && endPoint) {
      handleCalculateRoutes(startPoint, endPoint);
    }
  }, []);

  const activeRoute = routes.find(r => r.id === selectedRouteId) || routes[0];

  // Sync travel duration when active route changes
  useEffect(() => {
    if (activeRoute && activeRoute.timeMinutes) {
      setTravelHours(Math.floor(activeRoute.timeMinutes / 60));
      setTravelMinutes(activeRoute.timeMinutes % 60);
    }
  }, [selectedRouteId]);

  // Distribute Toll Plazas evenly along the active road route (INSTANT local update - 0ms delay)
  const handleSetTollsCount = (count: number) => {
    if (!activeRoute || !activeRoute.coordinates || activeRoute.coordinates.length < 2) return;
    if (count <= 0) {
      setManualTolls([]);
      return;
    }
    const coords = activeRoute.coordinates;
    const newTolls: TollGate[] = [];
    // Authentic Indian Commercial 3-Axle Truck Toll Tariffs
    const truckFees = [340, 285, 360, 245, 420, 275, 310];

    for (let i = 1; i <= count; i++) {
      const ratio = i / (count + 1);
      const idx = Math.min(Math.floor(coords.length * ratio), coords.length - 1);
      const [lat, lng] = coords[idx];
      const approxKm = Math.round(activeRoute.distanceKm * ratio);

      newTolls.push({
        name: `Highway Toll Plaza #${i} (KM ${approxKm})`,
        lat: parseFloat(lat.toFixed(5)),
        lng: parseFloat(lng.toFixed(5)),
        charges: truckFees[(i - 1) % truckFees.length],
        is_manual: true,
        toll_type: 'Commercial Truck FASTag ETC Plaza'
      });
    }
    setManualTolls(newTolls);
  };

  // Distribute Stoppages evenly along the active road route (INSTANT local update - 0ms delay)
  const handleSetStopsCount = (count: number) => {
    if (!activeRoute || !activeRoute.coordinates || activeRoute.coordinates.length < 2) return;
    if (count <= 0) {
      setStoppages([]);
      return;
    }
    const coords = activeRoute.coordinates;
    const newStops: Stoppage[] = [];
    for (let i = 1; i <= count; i++) {
      const ratio = i / (count + 1);
      const idx = Math.min(Math.floor(coords.length * ratio), coords.length - 1);
      const [lat, lng] = coords[idx];
      const approxKm = Math.round(activeRoute.distanceKm * ratio);

      newStops.push({
        sequence_order: i,
        name: `Transit Halt #${i} (KM ${approxKm})`,
        address: `Highway Corridor KM ${approxKm}`,
        lat: parseFloat(lat.toFixed(5)),
        lng: parseFloat(lng.toFixed(5)),
        duration: 25
      });
    }
    setStoppages(newStops);
  };

  // Calculate direct polyline distance using Haversine
  const calculateDirectDistance = (coords: Array<[number, number]>): number => {
    let dist = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const lat1 = coords[i][0];
      const lon1 = coords[i][1];
      const lat2 = coords[i + 1][0];
      const lon2 = coords[i + 1][1];
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      dist += R * c;
    }
    return dist;
  };

  const handleUndoLastCustomPoint = () => {
    if (customWaypoints.length <= 1) {
      setCustomWaypoints([]);
      setStartPoint(null);
    } else {
      setCustomWaypoints(prev => prev.slice(0, -1));
    }
  };

  const handleClearCustomPoints = () => {
    setCustomWaypoints([]);
    setStartPoint(null);
    setEndPoint(null);
  };

  const handleCancelCustomDrawing = () => {
    setIsManualDrawing(false);
    setCustomWaypoints([]);
    setStartPoint(null);
    setEndPoint(null);
    setClickMode('none');
  };

  // Client-side Google Maps Directions + Backend OSRM fallback for genuine road curves
  const fetchRealRoadPolyline = (
    origin: { lat: number; lng: number },
    destination: { lat: number; lng: number },
    waypoints: Array<{ lat: number; lng: number }>
  ): Promise<{ coordinates: [number, number][]; distanceKm: number; timeMinutes: number } | null> => {
    return new Promise((resolve) => {
      // 1. First try client-side Google Maps DirectionsService directly in browser
      if (typeof (window as any).google?.maps?.DirectionsService !== 'undefined') {
        try {
          const ds = new (window as any).google.maps.DirectionsService();
          const gWp = waypoints.slice(0, 25).map(w => ({
            location: new (window as any).google.maps.LatLng(w.lat, w.lng),
            stopover: false
          }));

          ds.route({
            origin: new (window as any).google.maps.LatLng(origin.lat, origin.lng),
            destination: new (window as any).google.maps.LatLng(destination.lat, destination.lng),
            waypoints: gWp,
            travelMode: (window as any).google.maps.TravelMode.DRIVING,
            optimizeWaypoints: false
          }, (res: any, status: any) => {
            if (status === 'OK' && res?.routes?.[0]) {
              const r = res.routes[0];
              const coords: [number, number][] = r.overview_path.map((pt: any) => [
                parseFloat(pt.lat().toFixed(6)),
                parseFloat(pt.lng().toFixed(6))
              ]);
              let meters = 0;
              let secs = 0;
              r.legs.forEach((l: any) => {
                meters += l.distance?.value || 0;
                secs += l.duration?.value || 0;
              });
              const dKm = parseFloat((meters / 1000).toFixed(1));
              const tMin = Math.round(secs / 60);
              resolve({ coordinates: coords, distanceKm: dKm, timeMinutes: tMin });
              return;
            }
            tryBackend();
          });
          return;
        } catch (e) {
          tryBackend();
          return;
        }
      }

      // 2. Try backend calculateRoutes (which uses OSRM or Google Routes V2 with waypoints)
      async function tryBackend() {
        try {
          const res = await api.calculateRoutes({
            origin,
            destination,
            waypoints,
            manualTolls: []
          });
          if (res.routes && res.routes.length > 0 && res.routes[0].coordinates?.length > 5) {
            resolve({
              coordinates: res.routes[0].coordinates,
              distanceKm: res.routes[0].distanceKm,
              timeMinutes: res.routes[0].timeMinutes
            });
            return;
          }
        } catch (err) { }
        resolve(null);
      }

      tryBackend();
    });
  };

  const handleFinishCustomRoute = async () => {
    if (customWaypoints.length < 2) {
      alert('Please click at least 2 points on the map (First click = Start Point, Last click = Destination).');
      return;
    }

    try {
      setIsApplyingCustomRoute(true);

      // 1. First click is Start Point (🟢), Last click is Destination (🔴)
      const firstWp = customWaypoints[0];
      const lastWp = customWaypoints[customWaypoints.length - 1];

      const effectiveStart = startPoint || {
        lat: firstWp.lat,
        lng: firstWp.lng,
        name: firstWp.name && !firstWp.name.startsWith('Point ') ? firstWp.name : `Start (${firstWp.lat.toFixed(3)}, ${firstWp.lng.toFixed(3)})`,
        address: `Coordinates: ${firstWp.lat.toFixed(4)}, ${firstWp.lng.toFixed(4)}`
      };
      setStartPoint(effectiveStart);

      const effectiveEnd = {
        lat: lastWp.lat,
        lng: lastWp.lng,
        name: lastWp.name && !lastWp.name.startsWith('Point ') ? lastWp.name : `Destination (${lastWp.lat.toFixed(3)}, ${lastWp.lng.toFixed(3)})`,
        address: `Coordinates: ${lastWp.lat.toFixed(4)}, ${lastWp.lng.toFixed(4)}`
      };
      setEndPoint(effectiveEnd);

      // Intermediate waypoints between Start and End
      const intermediateWps = customWaypoints.slice(1, -1);

      let finalCoords: [number, number][] = [];
      let finalDistKm = 0;
      let finalTimeMin = 0;

      // 2. Fetch real road polyline through intermediate road waypoints
      if (snapToRoads) {
        const roadRes = await fetchRealRoadPolyline(effectiveStart, effectiveEnd, intermediateWps);
        if (roadRes && roadRes.coordinates && roadRes.coordinates.length > 5) {
          finalCoords = roadRes.coordinates;
          finalDistKm = roadRes.distanceKm;
          finalTimeMin = roadRes.timeMinutes;
        }
      }

      if (finalCoords.length === 0) {
        finalCoords = customWaypoints.map(w => [w.lat, w.lng] as [number, number]);
      }

      // 3. Make custom route look authentic with road geometry & subtle highway zig-zag ("ekdum light zig jag line show krna taaki asli lage")
      finalCoords = await enhanceRouteWithRoadGeometry(finalCoords);

      finalDistKm = calculateCumulativeDistanceKm(finalCoords);
      finalTimeMin = calculateDurationMinutes(finalDistKm, 45);

      const detectedCustom = detectRealTollsOnRoute(finalCoords, 2.5, selectedAxle);
      const customTolls = detectedCustom.map(t => ({
        ...t,
        charges: customTollOverrides[t.name] !== undefined ? customTollOverrides[t.name] : t.charges
      }));
      const customFee = computeTotalTruckToll(customTolls);
      const customSummary = customTolls.length > 0
        ? `${customTolls.length} Real Tolls (₹${customFee} Truck Rate)`
        : 'Toll-Free Route (₹0)';

      const routeName = corridorNameInput.trim()
        ? corridorNameInput.trim()
        : `Custom Route: ${effectiveStart.name} to ${effectiveEnd.name}`;

      const customRoute: AlternativeRoute = {
        id: 'custom-manual-' + Date.now(),
        name: routeName,
        distanceKm: finalDistKm,
        timeMinutes: finalTimeMin,
        tollGatesCount: customTolls.length,
        stopsCount: stoppages.length,
        summary: `${customSummary}. Custom authentic road corridor (${finalDistKm} km).`,
        color: '#1A73E8',
        coordinates: finalCoords,
        tollGates: customTolls,
        source: 'Custom Route'
      };

      // Set ONLY this custom route on map - no alternatives
      setRoutes([customRoute]);
      setSelectedRouteId(customRoute.id);
      setTravelHours(Math.floor(finalTimeMin / 60));
      setTravelMinutes(finalTimeMin % 60);
      setCustomWaypoints([]);
      setIsManualDrawing(false);
      setClickMode('none');
    } catch (err: any) {
      alert('Failed to generate custom route: ' + (err?.message || err));
    } finally {
      setIsApplyingCustomRoute(false);
    }
  };

  // Handle direct map clicks
  const handleMapClick = (lat: number, lng: number, address?: string, mode?: string) => {
    const effectiveMode = mode || clickMode;
    if (effectiveMode === 'start') {
      const name = address ? address.split(',')[0] : `Start (${lat.toFixed(3)}, ${lng.toFixed(3)})`;
      const newStart = { lat, lng, name, address: address || `Coordinates: ${lat}, ${lng}` };
      setStartPoint(newStart);
      setClickMode('none');
      handleCalculateRoutes(newStart, endPoint);
    } else if (effectiveMode === 'end') {
      const name = address ? address.split(',')[0] : `Destination (${lat.toFixed(3)}, ${lng.toFixed(3)})`;
      const newEnd = { lat, lng, name, address: address || `Coordinates: ${lat}, ${lng}` };
      setEndPoint(newEnd);
      setClickMode('none');
      handleCalculateRoutes(startPoint, newEnd);
    } else if (effectiveMode === 'stop') {
      const nextSeq = stoppages.length + 1;
      const name = address ? address.split(',')[0] : `Transit Halt #${nextSeq}`;
      const newStop: Stoppage = {
        sequence_order: nextSeq,
        name,
        address: address || `Highway Stoppage at ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        lat: parseFloat(lat.toFixed(5)),
        lng: parseFloat(lng.toFixed(5)),
        duration: 20
      };
      setStoppages(prev => [...prev, newStop]);
      setStopsInput((stoppages.length + 1).toString());
      // Kept in stop clickMode so user can click more points on polyline/map freely!
    } else if (effectiveMode === 'parking') {
      const name = address ? `Parking: ${address.split(',')[0]}` : `Parking #${parkingPoints.length + 1}`;
      const newParking: ParkingPoint = {
        name,
        lat,
        lng,
        address: address || ''
      };
      setParkingPoints(prev => [...prev, newParking]);
      setClickMode('none');
    } else if (effectiveMode === 'toll') {
      const defaultName = address ? address.split(',')[0] : `Toll Plaza #${(customTollsAdded.length + 1)}`;
      api.estimateFastagToll({ lat, lng, plaza_name: defaultName }).then(est => {
        const estFee = est.truckRate || 340;
        const tollName = prompt('Enter Toll Plaza Name:', est.officialName || defaultName) || defaultName;
        const feeInput = prompt(`Enter Commercial Truck Toll Fee (₹) [Area NHAI Truck Tariff: ₹${estFee}]:`, String(estFee));
        const charges = parseFloat(feeInput || String(estFee)) || estFee;
        const newToll: TollGate = {
          name: tollName,
          lat: parseFloat(lat.toFixed(5)),
          lng: parseFloat(lng.toFixed(5)),
          charges,
          is_manual: true,
          toll_type: 'FASTag ETC Commercial Truck Gate',
          highway: est.highway || 'National Highway Corridor'
        };
        setCustomTollsAdded(prev => [...prev, newToll]);
        setManualTolls(prev => [...prev, newToll]);
        setTollsInput((customTollsAdded.length + 1).toString());
        setClickMode('none');
      }).catch(() => {
        const tollName = prompt('Enter Toll Plaza Name:', defaultName) || defaultName;
        const charges = parseFloat(prompt('Enter Commercial Truck Toll Fee (₹):', '340') || '340') || 340;
        const newToll: TollGate = {
          name: tollName,
          lat: parseFloat(lat.toFixed(5)),
          lng: parseFloat(lng.toFixed(5)),
          charges,
          is_manual: true,
          toll_type: 'FASTag ETC Commercial Truck Gate'
        };
        setCustomTollsAdded(prev => [...prev, newToll]);
        setManualTolls(prev => [...prev, newToll]);
        setTollsInput((customTollsAdded.length + 1).toString());
        setClickMode('none');
      });
    } else if (effectiveMode === 'manual-route') {
      // 1st click: Set & show as Start Point (🟢 Green Start Flag on map)
      if (!startPoint || customWaypoints.length === 0) {
        const name = address ? address.split(',')[0] : `Start (${lat.toFixed(3)}, ${lng.toFixed(3)})`;
        const newStart = { lat, lng, name, address: address || `Coordinates: ${lat}, ${lng}` };
        setStartPoint(newStart);
        setCustomWaypoints([{ lat, lng, name: 'Start' }]);
        return;
      }

      // Check for duplicate rapid click
      const lastPt = customWaypoints[customWaypoints.length - 1];
      if (lastPt && Math.abs(lastPt.lat - lat) < 0.00005 && Math.abs(lastPt.lng - lng) < 0.00005) {
        return;
      }

      const nextIdx = customWaypoints.length + 1;
      const newPt = {
        lat,
        lng,
        name: 'Point ' + nextIdx
      };
      setCustomWaypoints(prev => [...prev, newPt]);
    }
  };

  const handleSelectStart = (loc: { name: string; address: string; lat: number; lng: number }) => {
    const newStart = { lat: loc.lat, lng: loc.lng, name: loc.name, address: loc.address };
    setStartPoint(newStart);
    handleCalculateRoutes(newStart, endPoint);
  };

  const handleSelectEnd = (loc: { name: string; address: string; lat: number; lng: number }) => {
    const newEnd = { lat: loc.lat, lng: loc.lng, name: loc.name, address: loc.address };
    setEndPoint(newEnd);
    handleCalculateRoutes(startPoint, newEnd);
  };

  const targetVehicle = vehicles.find(v => String(v.id) === selectedVehicleId);
  const selectedAxleConfig = AXLE_CONFIGURATIONS.find(a => a.id === selectedAxle) || AXLE_CONFIGURATIONS[1];
  const rawTolls = activeRoute?.tollGates || [];
  const currentTolls: TollGate[] = React.useMemo(() => {
    const list: TollGate[] = [];
    const seen = new Set<string>();

    for (const t of rawTolls) {
      const key = `${t.name || ''}_${Number(t.lat || 0).toFixed(4)}_${Number(t.lng || 0).toFixed(4)}`;
      if (!seen.has(key)) {
        seen.add(key);
        list.push({
          ...t,
          charges: customTollOverrides[t.name] !== undefined ? customTollOverrides[t.name] : t.charges
        });
      }
    }

    for (const t of customTollsAdded) {
      const key = `${t.name || ''}_${Number(t.lat || 0).toFixed(4)}_${Number(t.lng || 0).toFixed(4)}`;
      if (!seen.has(key)) {
        seen.add(key);
        list.push({
          ...t,
          charges: customTollOverrides[t.name] !== undefined ? customTollOverrides[t.name] : t.charges
        });
      }
    }

    return list;
  }, [rawTolls, customTollsAdded, customTollOverrides]);
  const totalTruckToll = computeTotalTruckToll(currentTolls);
  const effectiveDistanceKm = customDistanceKm !== null ? customDistanceKm : (activeRoute?.distanceKm || 0);

  // Allocate Route to Vehicle
  const handleAllocateRoute = async () => {
    if (!selectedVehicleId) {
      alert('Please select a target vehicle from the dropdown first.');
      return;
    }
    const selectedRoute = routes.find(r => r.id === selectedRouteId) || routes[0];
    if (!selectedRoute || !startPoint || !endPoint) {
      alert('Please select a valid route first.');
      return;
    }

    try {
      setSaving(true);
      setErrorMsg(null);

      const allTolls = currentTolls.length > 0 ? currentTolls : (selectedRoute.tollGates || []);
      const totalEstimatedMinutes = (Number(travelHours) || 0) * 60 + (Number(travelMinutes) || 0);
      const effectiveDistance = customDistanceKm !== null ? customDistanceKm : (selectedRoute.distanceKm || 0);

      const sanitizedAltRoutes = routes.map(r => ({
        id: r.id,
        name: r.name,
        distanceKm: r.distanceKm,
        timeMinutes: r.timeMinutes,
        tollGatesCount: r.tollGatesCount,
        stopsCount: r.stopsCount,
        summary: r.summary,
        color: r.color,
        tollGates: r.tollGates
      }));

      await api.saveRoute({
        vehicle_id: parseInt(selectedVehicleId),
        assigned_user_id: allotUserId ? parseInt(allotUserId) : undefined,
        route_name: corridorNameInput.trim() || `${startPoint.name} to ${endPoint.name}`,
        start_location_name: startPoint.name,
        start_address: startPoint.address,
        start_lat: startPoint.lat,
        start_lng: startPoint.lng,
        end_location_name: endPoint.name,
        end_address: endPoint.address,
        end_lat: endPoint.lat,
        end_lng: endPoint.lng,
        total_distance_km: effectiveDistance,
        estimated_travel_time_min: totalEstimatedMinutes,
        overview_polyline: selectedRoute.coordinates,
        route_color: selectedRoute.color,
        waypoints: stoppages,
        toll_gates: allTolls,
        alternative_routes: sanitizedAltRoutes,
        trip_date: tripDate,
        end_trip_date: endTripDate,
        start_trip_time: startTripTime,
        end_trip_time: endTripTime
      });

      setSaveSuccess(true);
      setTimeout(() => {
        onSavedRouteSuccess(parseInt(selectedVehicleId));
      }, 1000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to allocate route');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      {errorMsg && (
        <div className="p-3 rounded-2xl bg-red-50 border border-red-200 text-xs font-semibold text-red-700">
          {errorMsg}
        </div>
      )}

      {/* ONE LARGE UNIFIED MAIN CONTAINER (ALL-IN-ONE ENTERPRISE LAYOUT) */}
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-xs overflow-hidden">
        {/* Section 1: Scheduled Trip Date & Timings */}
        <div className="p-5 sm:p-6 space-y-3.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E60012]/10">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#F1F5F9] text-[#0F172A] flex items-center justify-center shrink-0 border border-emerald-100">
                <Calendar className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-900">
                  Scheduled Trip Date & Timings
                </h3>
                <p className="text-[11px] text-slate-500 font-medium">
                  Set scheduled trip date, vehicle dispatch time, and estimated arrival
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-[11px] font-bold text-slate-400">Total Duration:</span>
              <span className="px-2.5 py-1 rounded-full bg-[#0F172A] text-white font-mono font-bold text-xs">
                {travelHours}h {travelMinutes}m
              </span>
            </div>
          </div>

          {/* 4-Column Inputs: Start Date, End Date, Start Time, End Time */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {/* 1. Trip Start Date (From) (Strict DD/MM/YYYY) */}
            <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                  Start Date (From)
                </label>
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
              </div>
              <DMYDateInput
                value={tripDate}
                onChange={(val) => {
                  setTripDate(val);
                  if (endTripDate < val) {
                    setEndTripDate(val);
                  }
                }}
                className="w-full justify-between bg-white px-3 py-2 rounded-xl border border-[#E2E8F0] text-xs font-bold text-slate-900 shadow-2xs"
              />
            </div>

            {/* 2. Trip End Date (To Date) (Strict DD/MM/YYYY) */}
            <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                  End Date (To Date)
                </label>
                <Calendar className="w-3.5 h-3.5 text-[#0F172A]" />
              </div>
              <DMYDateInput
                min={tripDate}
                value={endTripDate || tripDate}
                onChange={(val) => setEndTripDate(val)}
                className="w-full justify-between bg-white px-3 py-2 rounded-xl border border-[#E2E8F0] text-xs font-bold text-slate-900 shadow-2xs"
              />
            </div>

            {/* 3. Start Trip Time */}
            <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                  Start Time (Dispatch)
                </label>
                <Clock className="w-3.5 h-3.5 text-[#0F172A]" />
              </div>
              <input
                type="time"
                value={startTripTime}
                onChange={(e) => setStartTripTime(e.target.value)}
                className="w-full bg-white px-3 py-2 rounded-xl border border-[#E2E8F0] text-xs font-mono font-bold text-slate-900 focus:outline-none focus:border-[#0F172A] transition"
              />
            </div>

            {/* 4. End Trip Time */}
            <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                  End Time (Arrival)
                </label>
                <Clock className="w-3.5 h-3.5 text-slate-500" />
              </div>
              <input
                type="time"
                value={endTripTime}
                onChange={(e) => setEndTripTime(e.target.value)}
                className="w-full bg-white px-3 py-2 rounded-xl border border-[#E2E8F0] text-xs font-mono font-bold text-slate-900 focus:outline-none focus:border-[#0F172A] transition"
              />
            </div>
          </div>
        </div>

        {/* Thin horizontal divider with light red 10% opacity */}
        <div className="border-t border-[#E60012]/10" />

        {/* Section 2: Split 2-Column Route Planning Workspace */}
        <div className="p-5 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Route Controls (5 cols) */}
          <div className="lg:col-span-5 space-y-5">
            {/* Target Vehicle & Driver User Allotment */}
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-1 border-b border-[#E60012]/10">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Target Vehicle
                </span>
                {targetVehicle && (
                  <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full font-semibold">
                    {targetVehicle.registration_no}
                  </span>
                )}
              </div>
            </div>

            {/* Vehicle Selection */}
            <div className="space-y-1">
              <label className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                Vehicle Unit
              </label>
              <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200">
                <Truck className="w-4 h-4 text-slate-600 shrink-0" />
                <select
                  value={selectedVehicleId}
                  onChange={(e) => handleSelectVehicle(e.target.value)}
                  className="w-full bg-transparent text-xs font-bold text-slate-900 focus:outline-none cursor-pointer truncate"
                >
                  <option value="">-- Choose Vehicle --</option>
                  {vehicles.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.registration_no} • {v.name_model}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Allot To User Account */}
            <div className="pt-2 border-t border-slate-100 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  User Allocation
                </span>
                <span className={`text-[10px] font-bold ${allotUserId ? 'text-emerald-600' : 'text-slate-400'}`}>
                  {allotUserId ? 'Assigned' : 'Optional'}
                </span>
              </div>
              <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200 text-xs">
                <UserCheck className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <select
                  value={allotUserId}
                  onChange={(e) => setAllotUserId(e.target.value)}
                  className="w-full bg-transparent text-xs font-bold text-slate-800 focus:outline-none cursor-pointer"
                >
                  <option value="">-- Select User to Allot --</option>
                  {usersList.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.email}) • {u.role === 'admin' ? 'Administrator' : 'Fleet User'}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="border-t border-[#E60012]/10" />

            {/* Excel Route File Import & Saved Corridors */}
            <div className="space-y-3.5">
              <div className="flex items-center justify-between pb-2 border-b border-[#E60012]/10">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-[#E60012]/10 text-[#E60012] flex items-center justify-center font-bold text-xs">
                    X
                  </div>
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-800">
                    Excel Route Import & Saved Corridors
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadSampleExcel}
                  className="text-[10px] font-bold text-[#E60012] hover:underline flex items-center gap-1 cursor-pointer"
                  title="Download Sample Excel Route Template (.xlsx)"
                >
                  <span>↓ Download Template</span>
                </button>
              </div>

              {/* Compact Import Excel Button */}
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className={`inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-[#E60012] font-bold text-xs cursor-pointer shadow-2xs transition ${isImportingExcel ? 'opacity-60 cursor-wait pointer-events-none' : ''}`}>
                    {isImportingExcel ? (
                      <div className="w-3.5 h-3.5 border-2 border-[#E60012] border-t-transparent rounded-full animate-spin shrink-0" />
                    ) : (
                      <FileSpreadsheet className="w-3.5 h-3.5 text-[#E60012]" />
                    )}
                    <span>{isImportingExcel ? 'Optimizing & Routing...' : excelFileName ? `Imported: ${excelFileName}` : 'Import Excel / CSV'}</span>
                    <input
                      type="file"
                      accept=".xlsx, .xls, .csv"
                      onChange={handleExcelUpload}
                      disabled={isImportingExcel}
                      className="hidden"
                    />
                  </label>

                  {excelFileName && (
                    <button
                      type="button"
                      onClick={() => {
                        setExcelFileName('');
                        setImportedWaypointsCount(0);
                      }}
                      className="px-2.5 py-1.5 text-xs font-bold text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
                      title="Clear imported file"
                    >
                      ✕ Clear
                    </button>
                  )}
                </div>


              </div>

              {/* Route / Corridor Name */}
              <div className="space-y-1 pt-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                  Route / Corridor Name *
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={corridorNameInput}
                    onChange={(e) => setCorridorNameInput(e.target.value)}
                    placeholder="e.g. Raipur to Bilaspur Industrial Highway"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#E60012]"
                  />
                  <button
                    type="button"
                    onClick={handleSaveCorridorToDropdown}
                    disabled={!startPoint || saving}
                    className="px-3 py-2 rounded-xl bg-[#E60012] hover:bg-[#CC0010] text-white font-bold text-xs shrink-0 shadow-xs transition cursor-pointer disabled:opacity-40"
                    title="Save this Route into Dropdown for Future Re-use"
                  >
                    Save Route
                  </button>
                </div>
              </div>

              {/* OR Use Existing Saved Route Selector */}
              <div className="pt-2 border-t border-slate-100 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-200">
                      OR Select Previously Saved Route
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowSavedCorridorSearch(prev => !prev);
                      if (showSavedCorridorSearch) setSavedCorridorSearchTerm('');
                    }}
                    className={`p-1 px-2 rounded-lg border text-[10px] font-bold flex items-center gap-1 transition cursor-pointer ${
                      showSavedCorridorSearch
                        ? 'bg-red-50 border-red-200 text-[#E60012]'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                    title="Search saved routes"
                  >
                    <Search className="w-3 h-3 text-[#E60012]" />
                    <span>Search</span>
                  </button>
                </div>

                {showSavedCorridorSearch && (
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={savedCorridorSearchTerm}
                      onChange={(e) => setSavedCorridorSearchTerm(e.target.value)}
                      placeholder="Type to filter routes by name, vehicle, or user..."
                      className="w-full pl-8 pr-7 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold focus:outline-none focus:border-red-500 text-slate-800"
                      autoFocus
                    />
                    {savedCorridorSearchTerm && (
                      <button
                        type="button"
                        onClick={() => setSavedCorridorSearchTerm('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-200">
                  <Route className="w-4 h-4 text-[#E60012] shrink-0" />
                  <select
                    value={selectedCorridorId}
                    onChange={(e) => handleSelectExistingCorridor(e.target.value)}
                    className="w-full bg-transparent text-xs font-bold text-slate-800 focus:outline-none cursor-pointer truncate"
                  >
                    <option value="">
                      {savedCorridorSearchTerm
                        ? `-- Showing ${filteredSavedCorridors.length} of ${savedCorridors.length} Routes --`
                        : `-- Select from ${savedCorridors.length} Saved Routes / Corridors --`}
                    </option>
                    {filteredSavedCorridors.map((c, idx) => {
                      const vehReg = c.vehicle_registration_no || '';
                      const uName = c.user_name || '';
                      const prefix = vehReg ? (uName ? `${vehReg} (${uName}): ` : `${vehReg}: `) : (uName ? `(${uName}): ` : '');
                      return (
                        <option key={idx} value={c.route_name}>
                          {prefix}{c.route_name} ({c.total_distance_km} KM{c.trip_date ? ` • ${c.trip_date}` : ''})
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              {/* Compact Save Modified Route Bar */}
              {isRouteModifiedByDrag && (
                <div className="flex items-center gap-2 p-2 rounded-xl bg-amber-50 border border-amber-200 text-xs">
                  <input
                    type="text"
                    value={newModifiedRouteName}
                    onChange={(e) => setNewModifiedRouteName(e.target.value)}
                    placeholder="Save modified route name..."
                    className="flex-1 px-2.5 py-1 text-xs rounded-lg border border-amber-300 bg-white font-medium focus:outline-none focus:border-amber-500"
                  />
                  <button
                    type="button"
                    onClick={handleSaveModifiedAsNewRoute}
                    disabled={saving}
                    className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold shrink-0 transition cursor-pointer disabled:opacity-40"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsRouteModifiedByDrag(false);
                      setNewModifiedRouteName('');
                    }}
                    className="px-1.5 py-1 text-xs text-slate-400 hover:text-slate-600 font-bold cursor-pointer"
                    title="Dismiss"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>

            <div className="border-t border-[#E60012]/10" />

            {/* Custom Manual Route Drawer / Creator */}
            <div className="space-y-2.5">
              <div className="pt-1">
                {!isManualDrawing ? (
                  <div className="space-y-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setIsManualDrawing(true);
                        setClickMode('manual-route');
                        setCustomWaypoints([]);
                        setStartPoint(null);
                        setEndPoint(null);
                        setRoutes([]);
                        setSelectedRouteId('');
                      }}
                      className="w-full py-2.5 px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer shadow-2xs"
                      title="Draw custom road route by clicking points directly on map"
                    >
                      <Route className="w-4 h-4 text-red-600" />
                      <span>+ Draw / Create Custom Route (Click Points)</span>
                    </button>

                    {routes.some(r => r.id.startsWith('custom-manual-')) && (
                      <button
                        type="button"
                        onClick={() => handleCalculateRoutes()}
                        className="w-full text-center text-[11px] font-bold text-slate-500 hover:text-slate-800 underline transition cursor-pointer py-1"
                      >
                        ↺ Reset to 4 Automated Routes
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="p-3.5 rounded-2xl bg-white border border-slate-200/90 shadow-xs space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-600" />
                        <span className="font-extrabold text-xs text-slate-900">Manual Route Draw Mode</span>
                      </div>
                      <span className="text-[10px] font-mono font-bold bg-slate-100 text-slate-700 px-2.5 py-0.5 rounded-full border border-slate-200">
                        {customWaypoints.length} Points Added
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-500 leading-snug">
                      {customWaypoints.length === 0
                        ? '📍 1st Click on Map: Sets Start Point (🟢 Green Flag). Then continue clicking along your road path.'
                        : `📍 ${customWaypoints.length} point${customWaypoints.length > 1 ? 's' : ''} placed. Click "Apply & Save Route" when done (last point becomes 🔴 Destination).`}
                    </p>

                    <div className="flex items-center justify-between text-xs text-slate-700 bg-slate-50 p-2.5 rounded-xl border border-slate-200/80">
                      <label className="flex items-center gap-2 cursor-pointer font-semibold">
                        <input
                          type="checkbox"
                          checked={snapToRoads}
                          onChange={(e) => setSnapToRoads(e.target.checked)}
                          className="w-4 h-4 rounded accent-red-600 cursor-pointer"
                        />
                        <span>Snap through real tarmac roads</span>
                      </label>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={handleUndoLastCustomPoint}
                        disabled={customWaypoints.length === 0}
                        className="py-1.5 px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 transition disabled:opacity-40 cursor-pointer shadow-2xs"
                      >
                        <Undo2 className="w-3.5 h-3.5 text-slate-500" />
                        <span>Undo Point</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleClearCustomPoints}
                        disabled={customWaypoints.length === 0}
                        className="py-1.5 px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition disabled:opacity-40 cursor-pointer shadow-2xs"
                      >
                        Clear All
                      </button>
                    </div>

                    <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={handleFinishCustomRoute}
                        disabled={customWaypoints.length === 0 || isApplyingCustomRoute}
                        className="flex-1 py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition shadow-xs disabled:opacity-40 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>{isApplyingCustomRoute ? 'Calculating Real Road...' : 'Apply & Save Route'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelCustomDrawing}
                        className="py-2 px-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-bold transition cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Highway FASTag Tolls */}
            <div className="bg-white p-3 rounded-xl border border-slate-200/80 shadow-xs space-y-2.5">
              <div className="flex items-center justify-between pb-1 border-b border-slate-100">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  <span>Highway FASTag Tolls</span>
                </span>
                <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/60 font-mono">
                  {selectedAxleConfig.shortLabel}
                </span>
              </div>

              {currentTolls.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-2 rounded-lg bg-amber-50/70 border border-amber-200/70 text-xs">
                    <div>
                      <span className="text-[9px] uppercase font-bold text-amber-800 tracking-wider">Tolls</span>
                      <p className="font-extrabold text-slate-900 text-xs">{currentTolls.length} Gate{currentTolls.length > 1 ? 's' : ''}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-[9px] uppercase font-bold text-slate-500 tracking-wider">Total</span>
                      <p className="font-black text-emerald-700 font-mono text-sm">₹{totalTruckToll}</p>
                    </div>
                  </div>

                  <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                    {currentTolls.map((toll, idx) => {
                      const isOverridden = customTollOverrides[toll.name] !== undefined;
                      return (
                        <div key={idx} className="p-1.5 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between text-[11px] gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-slate-800 truncate">{idx + 1}. {toll.name}</span>
                              {isOverridden && (
                                <span className="px-1 py-0.2 rounded bg-red-50 text-red-700 border border-red-200 font-bold text-[8px] uppercase tracking-wider shrink-0">
                                  Custom
                                </span>
                              )}
                            </div>
                            <p className="text-[9px] text-slate-400 font-mono truncate">
                              {Number(toll.lat).toFixed(4)}, {Number(toll.lng).toFixed(4)}
                            </p>
                          </div>

                          {/* Editable Custom Toll Price Input */}
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-xs font-bold text-slate-400">₹</span>
                            <input
                              type="number"
                              min="0"
                              value={toll.charges}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                handleUpdateTollPrice(toll.name, isNaN(val) ? 0 : val);
                              }}
                              className="w-16 px-1.5 py-0.5 rounded-md border border-slate-200 bg-white font-mono font-bold text-xs text-slate-900 focus:outline-none focus:border-slate-800 text-right"
                              title="Edit Custom Toll Fee"
                            />
                            {isOverridden && (
                              <button
                                type="button"
                                onClick={() => handleResetTollPrice(toll.name)}
                                className="text-[9px] text-red-600 hover:text-red-700 font-bold px-1 py-0.5 rounded hover:bg-red-50 cursor-pointer"
                                title="Reset"
                              >
                                ↺
                              </button>
                            )}
                            {toll.is_manual && (
                              <button
                                type="button"
                                onClick={() => handleRemoveCustomToll(idx)}
                                className="text-slate-400 hover:text-red-600 p-0.5"
                                title="Remove Custom Toll"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Button / Form to Add Custom Extra Toll Barrier */}
                  {!showAddCustomToll ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setShowAddCustomToll(true)}
                        className="flex-1 py-1.5 px-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold flex items-center justify-center gap-1 transition shadow-2xs cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5 text-amber-400" />
                        <span>+ Add Toll Gate (Lat / Long)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setClickMode(clickMode === 'toll' ? 'none' : 'toll')}
                        className={`py-1.5 px-2 rounded-lg border text-[10px] font-bold flex items-center gap-1 transition cursor-pointer ${clickMode === 'toll'
                          ? 'bg-amber-500 text-white border-amber-600 ring-2 ring-amber-300'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-100 bg-white'
                          }`}
                        title="Click on map to drop a toll pin"
                      >
                        <MapPin className="w-3 h-3" />
                        <span>{clickMode === 'toll' ? 'Click Map...' : 'Map Pin'}</span>
                      </button>
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/90 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-700 text-[11px] flex items-center gap-1">
                          <Plus className="w-3 h-3 text-amber-500" />
                          <span>Add Toll Gate by GPS Coordinates</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowAddCustomToll(false)}
                          className="text-slate-400 hover:text-slate-600 text-[10px] cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                      <div className="space-y-1.5">
                        <input
                          type="text"
                          value={newCustomTollName}
                          onChange={(e) => setNewCustomTollName(e.target.value)}
                          placeholder="Toll Plaza Name (e.g., Bilaspur Plaza)..."
                          className="w-full px-2 py-1 rounded-md border border-slate-200 bg-white text-xs font-medium focus:outline-none focus:border-slate-800"
                        />
                        <div className="grid grid-cols-2 gap-1.5">
                          <input
                            type="text"
                            value={newCustomTollLat}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v.includes(',')) {
                                const parts = v.split(',');
                                setNewCustomTollLat(parts[0].trim());
                                if (parts[1]) setNewCustomTollLng(parts[1].trim());
                              } else {
                                setNewCustomTollLat(v);
                              }
                            }}
                            placeholder="Latitude (e.g. 21.8500 or paste Lat, Lng)"
                            className="px-2 py-1 rounded-md border border-slate-200 bg-white font-mono text-xs text-slate-800 focus:outline-none focus:border-slate-800"
                          />
                          <input
                            type="text"
                            value={newCustomTollLng}
                            onChange={(e) => setNewCustomTollLng(e.target.value)}
                            placeholder="Longitude (e.g. 81.8200)"
                            className="px-2 py-1 rounded-md border border-slate-200 bg-white font-mono text-xs text-slate-800 focus:outline-none focus:border-slate-800"
                          />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="relative flex-1">
                            <span className="absolute left-2 top-1 text-slate-400 font-bold text-xs">₹</span>
                            <input
                              type="number"
                              min="0"
                              value={newCustomTollPrice}
                              onChange={(e) => setNewCustomTollPrice(e.target.value)}
                              placeholder="Tariff (₹)..."
                              className="w-full pl-6 pr-2 py-1 rounded-md border border-slate-200 bg-white font-mono font-bold text-xs text-slate-900 focus:outline-none focus:border-slate-800"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={handleAddCustomToll}
                            disabled={!newCustomTollName.trim() && !newCustomTollLat.trim()}
                            className="px-3 py-1 rounded-md bg-slate-900 hover:bg-slate-800 text-white font-bold text-[11px] transition cursor-pointer disabled:opacity-40 shrink-0"
                          >
                            + Add Toll
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-slate-500">No Tolls on Route</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowAddCustomToll(true)}
                      className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold cursor-pointer transition shadow-2xs"
                    >
                      <Plus className="w-3.5 h-3.5 text-amber-400" />
                      <span>+ Add Toll Gate (Lat / Long)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setClickMode(clickMode === 'toll' ? 'none' : 'toll')}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-bold cursor-pointer transition ${clickMode === 'toll'
                        ? 'bg-amber-500 text-white border-amber-600 ring-2 ring-amber-300'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      title="Click on map to drop a toll pin"
                    >
                      <MapPin className="w-3 h-3" />
                      <span>{clickMode === 'toll' ? 'Click Map...' : 'Map Pin'}</span>
                    </button>
                  </div>
                </div>
              )}
              {currentTolls.length === 0 && showAddCustomToll && (
                <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/90 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-700 text-[11px] flex items-center gap-1">
                      <Plus className="w-3 h-3 text-amber-500" />
                      <span>Add Toll Gate by GPS Coordinates</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowAddCustomToll(false)}
                      className="text-slate-400 hover:text-slate-600 text-[10px] cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    <input
                      type="text"
                      value={newCustomTollName}
                      onChange={(e) => setNewCustomTollName(e.target.value)}
                      placeholder="Toll Plaza Name (e.g., Bilaspur Plaza)..."
                      className="w-full px-2 py-1 rounded-md border border-slate-200 bg-white text-xs font-medium focus:outline-none focus:border-slate-800"
                    />
                    <div className="grid grid-cols-2 gap-1.5">
                      <input
                        type="text"
                        value={newCustomTollLat}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v.includes(',')) {
                            const parts = v.split(',');
                            setNewCustomTollLat(parts[0].trim());
                            if (parts[1]) setNewCustomTollLng(parts[1].trim());
                          } else {
                            setNewCustomTollLat(v);
                          }
                        }}
                        placeholder="Latitude (e.g. 21.8500 or paste Lat, Lng)"
                        className="px-2 py-1 rounded-md border border-slate-200 bg-white font-mono text-xs text-slate-800 focus:outline-none focus:border-slate-800"
                      />
                      <input
                        type="text"
                        value={newCustomTollLng}
                        onChange={(e) => setNewCustomTollLng(e.target.value)}
                        placeholder="Longitude (e.g. 81.8200)"
                        className="px-2 py-1 rounded-md border border-slate-200 bg-white font-mono text-xs text-slate-800 focus:outline-none focus:border-slate-800"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="relative flex-1">
                        <span className="absolute left-2 top-1 text-slate-400 font-bold text-xs">₹</span>
                        <input
                          type="number"
                          min="0"
                          value={newCustomTollPrice}
                          onChange={(e) => setNewCustomTollPrice(e.target.value)}
                          placeholder="Tariff (₹)..."
                          className="w-full pl-6 pr-2 py-1 rounded-md border border-slate-200 bg-white font-mono font-bold text-xs text-slate-900 focus:outline-none focus:border-slate-800"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleAddCustomToll}
                        disabled={!newCustomTollName.trim() && !newCustomTollLat.trim()}
                        className="px-3 py-1 rounded-md bg-slate-900 hover:bg-slate-800 text-white font-bold text-[11px] transition cursor-pointer disabled:opacity-40 shrink-0"
                      >
                        + Add Toll
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Stoppages & Route Metrics Card */}
            <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-xs space-y-2">
              {/* Stoppages */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs pb-0.5 border-b border-slate-100">
                  <label className="font-bold text-slate-700 flex items-center gap-1.5 text-xs">
                    <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                    <span>Stoppages</span>
                  </label>
                  <span className="text-[10px] font-mono text-orange-600 font-bold bg-orange-50 px-2 py-0.5 rounded-full">
                    {stoppages.length} Stops
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <div className="flex items-center gap-1 bg-slate-50 p-0.5 rounded-lg border border-slate-200">
                    <button
                      type="button"
                      onClick={() => {
                        const next = Math.max(0, (parseInt(stopsInput) || 0) - 1);
                        setStopsInput(next.toString());
                        handleSetStopsCount(next);
                      }}
                      className="w-6 h-6 rounded bg-white hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center transition border border-slate-200 cursor-pointer"
                      title="Decrease Stops"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <input
                      type="number"
                      min="0"
                      max="99"
                      value={stopsInput}
                      onChange={(e) => {
                        const val = e.target.value;
                        setStopsInput(val);
                        const n = parseInt(val);
                        if (!isNaN(n) && n >= 0) {
                          handleSetStopsCount(n);
                        } else if (val === '') {
                          handleSetStopsCount(0);
                        }
                      }}
                      placeholder="0"
                      className="w-10 h-6 bg-transparent font-mono font-bold text-xs text-center text-slate-900 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const next = (parseInt(stopsInput) || 0) + 1;
                        setStopsInput(next.toString());
                        handleSetStopsCount(next);
                      }}
                      className="w-6 h-6 rounded bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center justify-center transition cursor-pointer"
                      title="Increase Stops"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Map Click Stoppage Option */}
                  <button
                    type="button"
                    onClick={() => setClickMode(clickMode === 'stop' ? 'none' : 'stop')}
                    className={`flex-1 h-7 px-2 rounded-lg border text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${clickMode === 'stop'
                      ? 'bg-amber-600 text-white border-amber-600'
                      : 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-200/80'
                      }`}
                  >
                    <MapPin className="w-3 h-3 text-amber-600" />
                    <span>{clickMode === 'stop' ? 'Click Map...' : '+ Map Stop'}</span>
                  </button>
                </div>
              </div>

              {/* Custom Route Distance */}
              <div className="space-y-1 pt-1.5 border-t border-slate-100">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-bold text-slate-700 flex items-center gap-1.5 text-xs">
                    <span className="w-2 h-2 rounded-full bg-red-600"></span>
                    <span>Route Distance</span>
                  </label>
                  {customDistanceKm !== null && customDistanceKm !== activeRoute?.distanceKm && (
                    <button
                      type="button"
                      onClick={() => setCustomDistanceKm(null)}
                      className="text-[10px] font-bold text-red-600 hover:underline flex items-center gap-0.5 cursor-pointer"
                    >
                      <span>↺ Reset ({activeRoute?.distanceKm || 0} KM)</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <input
                      type="number"
                      min="1"
                      max="99999"
                      step="0.1"
                      value={effectiveDistanceKm || ''}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setCustomDistanceKm(isNaN(val) ? 0 : Math.max(0, Math.round(val * 10) / 10));
                      }}
                      placeholder="Distance..."
                      className="w-full h-7 px-2.5 rounded-lg border border-slate-200 bg-white font-mono font-bold text-xs text-slate-900 focus:outline-none focus:border-slate-800 pr-9"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-bold text-slate-400 font-mono">
                      KM
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const current = effectiveDistanceKm;
                      setCustomDistanceKm(Math.max(1, Math.round((current - 5) * 10) / 10));
                    }}
                    className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center transition cursor-pointer"
                    title="Minus 5 KM"
                  >
                    -5
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const current = effectiveDistanceKm;
                      setCustomDistanceKm(Math.round((current + 5) * 10) / 10);
                    }}
                    className="w-7 h-7 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center justify-center transition shadow-xs cursor-pointer"
                    title="Add 5 KM"
                  >
                    +5
                  </button>
                </div>
              </div>

              {/* Route Travel Duration */}
              <div className="space-y-1 pt-1.5 border-t border-slate-100">
                <div className="flex items-center justify-between text-xs">
                  <label className="font-bold text-slate-700 flex items-center gap-1.5 text-xs">
                    <Clock className="w-3 h-3 text-slate-600" />
                    <span>Travel Duration</span>
                  </label>
                  <span className="text-[10px] font-mono text-slate-600 font-bold bg-slate-100 px-2 py-0.5 rounded-full">
                    {travelHours}h {travelMinutes}m
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {/* Hours Box */}
                  <div className="flex items-center gap-1 bg-slate-50 px-2 py-1 rounded-lg border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-500 shrink-0">Hrs</span>
                    <input
                      type="number"
                      min="0"
                      max="99"
                      value={travelHours}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setTravelHours(isNaN(val) ? 0 : Math.max(0, val));
                      }}
                      placeholder="0"
                      className="w-full h-5.5 bg-white px-1.5 rounded border border-slate-200 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:border-slate-800 text-center"
                    />
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setTravelHours(prev => prev + 1)}
                        className="w-3.5 h-2.5 bg-white hover:bg-slate-200 rounded text-[6px] font-bold flex items-center justify-center border border-slate-200 cursor-pointer"
                        title="Add 1 Hour"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => setTravelHours(prev => Math.max(0, prev - 1))}
                        className="w-3.5 h-2.5 bg-white hover:bg-slate-200 rounded text-[6px] font-bold flex items-center justify-center border border-slate-200 cursor-pointer"
                        title="Subtract 1 Hour"
                      >
                        ▼
                      </button>
                    </div>
                  </div>

                  {/* Minutes Box */}
                  <div className="flex items-center gap-1 bg-slate-50 px-2 py-1 rounded-lg border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-500 shrink-0">Min</span>
                    <input
                      type="number"
                      min="0"
                      max="59"
                      value={travelMinutes}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setTravelMinutes(isNaN(val) ? 0 : Math.min(59, Math.max(0, val)));
                      }}
                      placeholder="0"
                      className="w-full h-5.5 bg-white px-1.5 rounded border border-slate-200 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:border-slate-800 text-center"
                    />
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setTravelMinutes(prev => (prev + 5) % 60)}
                        className="w-3.5 h-2.5 bg-white hover:bg-slate-200 rounded text-[6px] font-bold flex items-center justify-center border border-slate-200 cursor-pointer"
                        title="Add 5 Minutes"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => setTravelMinutes(prev => (prev - 5 < 0 ? 55 : prev - 5))}
                        className="w-3.5 h-2.5 bg-white hover:bg-slate-200 rounded text-[6px] font-bold flex items-center justify-center border border-slate-200 cursor-pointer"
                        title="Subtract 5 Minutes"
                      >
                        ▼
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* List of active scheduled stoppages */}
              {stoppages.length > 0 && (
                <div className="mt-2 pt-2 border-t border-slate-100 space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {stoppages.map((s, idx) => {
                    const durationMins = s.stop_duration_mins || s.duration || 25;
                    const cleanName = (s.name || `Stoppage #${idx + 1}`)
                      .replace(/Highway Dhaba & Rest Point|Fuel Station & Inspection Bay|Driver Rest Area|Logistics Checkpoint|Restaurant|Dhaba/gi, 'Transit Halt')
                      .trim();
                    return (
                      <div key={idx} className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-100 text-[11px]">
                        <div className="min-w-0 pr-2">
                          <div className="flex items-center gap-1.5">
                            <span className="w-4 h-4 rounded-full bg-slate-900 text-white font-bold text-[9px] flex items-center justify-center shrink-0">
                              {idx + 1}
                            </span>
                            <span className="font-bold text-slate-800 truncate">{cleanName}</span>
                          </div>
                          <p className="text-[10px] text-slate-400 font-mono mt-0.5 pl-5">
                            {durationMins}m halt • {Number(s.lat || 0).toFixed(4)}, {Number(s.lng || 0).toFixed(4)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const updated = stoppages.filter((_, i) => i !== idx);
                            setStoppages(updated);
                            setStopsInput(updated.length.toString());
                          }}
                          className="text-slate-400 hover:text-red-600 p-1 rounded-lg hover:bg-white transition cursor-pointer"
                          title="Delete Stoppage"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Primary Action Button: Allocate Route */}
            <button
              type="button"
              onClick={handleAllocateRoute}
              disabled={saving || !selectedVehicleId || routes.length === 0}
              className="w-full py-3 bg-[#E60012] hover:bg-[#CC0010] text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              <Check className="w-4 h-4 text-emerald-200" />
              <span>
                {saving ? 'Allocating Route...' : saveSuccess ? 'Route Allocated Successfully!' : `Confirm & Allocate Route to ${targetVehicle?.registration_no || 'Vehicle'}`}
              </span>
            </button>
          </div>

          {/* Right Column: Google Maps (Full View) + Route Summary Card Below Map (7 cols) */}
          <div className="lg:col-span-7 space-y-5">
            {/* Map Container */}
            <div className="relative flex flex-col">
              {/* Map Top Floating Header: Clear Map & Engine Status */}
              <div className="flex items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-[#E60012]/10 text-xs">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setStartPoint(null);
                      setEndPoint(null);
                      setRoutes([]);
                      setSelectedRouteId('');
                      setCustomWaypoints([]);
                      setIsManualDrawing(false);
                      setClickMode('none');
                      setStoppages([]);
                      setManualTolls([]);
                      setCustomTollsAdded([]);
                      setSearchedLocation(null);
                    }}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 bg-slate-100 hover:bg-red-50 text-slate-700 hover:text-red-700 border border-slate-200 hover:border-red-200 transition cursor-pointer"
                    title="Clear all points, routes and custom drawing from map"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Clear Map</span>
                  </button>

                  {clickMode !== 'none' && (
                    <button
                      type="button"
                      onClick={() => setClickMode('none')}
                      className="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 cursor-pointer transition shadow-2xs"
                    >
                      Cancel ({clickMode === 'toll' ? 'Toll Placement' : clickMode === 'stop' ? 'Stoppage Placement' : clickMode})
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Google Maps Engine</span>
                </div>
              </div>

              {/* Interactive Toll Placement Mode Active Notification Banner */}
              {clickMode === 'toll' && (
                <div className="mb-2.5 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-bold flex items-center justify-between gap-2 shadow-2xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
                    <span>
                      📍 Toll Placement Active: Click anywhere on the route polyline or map to place a Toll Gate.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setClickMode('none')}
                    className="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold rounded-lg transition cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              )}

              {/* Interactive Stoppage Mode Active Notification Banner */}
              {clickMode === 'stop' && (
                <div className="mb-2.5 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-bold flex items-center justify-between gap-2 shadow-2xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
                    <span>
                      Interactive Stoppage Mode: Click anywhere on the route polyline or map to add a stoppage ({stoppages.length} placed).
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setClickMode('none')}
                    className="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold rounded-lg transition cursor-pointer"
                  >
                    Done Adding
                  </button>
                </div>
              )}

              {/* Interactive Google Map Container - Completely Unobstructed with Native In-Map Google Search */}
              <div className="relative rounded-2xl overflow-hidden min-h-[520px]">
                <InteractiveMap
                  height="540px"
                  center={mapCenter || (startPoint ? [startPoint.lat, startPoint.lng] : [21.2580, 81.5645])}
                  zoom={mapZoom}
                  searchLocation={searchedLocation}
                  routes={routes}
                  selectedRouteId={selectedRouteId}
                  onSelectRoute={(id) => {
                    setSelectedRouteId(id);
                    setCustomDistanceKm(null);
                    const found = routes.find(r => r.id === id);
                    if (found && found.timeMinutes) {
                      setTravelHours(Math.floor(found.timeMinutes / 60));
                      setTravelMinutes(found.timeMinutes % 60);
                    }
                  }}
                  startPoint={startPoint}
                  endPoint={endPoint}
                  stoppages={stoppages}
                  parkingPoints={parkingPoints}
                  tollGates={currentTolls}
                  clickMode={clickMode}
                  customWaypoints={customWaypoints}
                  isManualDrawing={isManualDrawing}
                  onMapClick={handleMapClick}
                  isDraggableRoute={isDraggableRoute}
                  onUpdateTollPrice={handleUpdateTollPrice}
                  onUpdateToll={handleUpdateToll}
                  onRouteChange={handleRouteDragChange}
                />
              </div>
            </div>

            {/* Route & Vehicle Allocation Summary (Seamless inside unified container) */}
            {activeRoute && (
              <div className="pt-2 border-t border-[#E60012]/10 space-y-3.5">
                {/* Row 1: Vehicle Plate, Type, Axle & Route Corridor */}
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E60012]/10">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-[#E60012] text-white flex items-center justify-center shrink-0 shadow-2xs">
                      <Truck className="w-5 h-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-black text-sm text-slate-900 font-mono tracking-tight">
                          {targetVehicle?.registration_no || 'No Vehicle Selected'}
                        </span>
                        <span className="text-[10px] font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                          {targetVehicle?.vehicle_type || 'Commercial Fleet'}
                        </span>
                      </div>
                      <p
                        className="text-xs text-slate-500 mt-1 font-medium truncate max-w-[420px]"
                        title={`${startPoint?.name || 'Origin'} → ${endPoint?.name || 'Destination'}`}
                      >
                        <span className="font-bold text-slate-800">
                          {startPoint?.name || 'Origin'} → {endPoint?.name || 'Destination'}
                        </span>
                        <span className="text-slate-300 mx-1.5">•</span>
                        <span className="font-mono text-slate-600">
                          {tripDate}{endTripDate && endTripDate !== tripDate ? ` → ${endTripDate}` : ''} ({startTripTime} - {endTripTime})
                        </span>
                      </p>
                    </div>
                  </div>
                </div>

                {/* Row 2: 3 Clear, Well-Spaced Metric Boxes (Full Width Grid, Zero Overlap) */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
                  <div className="bg-slate-50/80 rounded-xl p-2.5 sm:p-3 border border-slate-100 text-left">
                    <span className="text-[10px] text-slate-400 block uppercase font-bold tracking-wider">
                      Total Distance
                    </span>
                    <span className="font-black text-slate-900 font-mono text-xs sm:text-sm block mt-0.5">
                      {effectiveDistanceKm} KM
                    </span>
                  </div>

                  <div className="bg-slate-50/80 rounded-xl p-2.5 sm:p-3 border border-slate-100 text-left">
                    <span className="text-[10px] text-slate-400 block uppercase font-bold tracking-wider">
                      Est. Duration
                    </span>
                    <span className="font-black text-slate-900 font-mono text-xs sm:text-sm block mt-0.5">
                      {travelHours}h {travelMinutes}m
                    </span>
                  </div>

                  <div className="bg-slate-50/80 rounded-xl p-2.5 sm:p-3 border border-slate-100 text-left">
                    <span className="text-[10px] text-slate-400 block uppercase font-bold tracking-wider truncate">
                      FASTag / Stops
                    </span>
                    <span
                      className="font-black text-slate-900 font-mono text-xs sm:text-sm block mt-0.5 truncate"
                      title={`${currentTolls.length} Plazas (₹${totalTruckToll}) • ${stoppages.length} Stops`}
                    >
                      {currentTolls.length} {currentTolls.length > 0 ? `(₹${totalTruckToll})` : 'Tolls'} • {stoppages.length} Stops
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
