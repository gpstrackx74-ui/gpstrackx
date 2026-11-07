import React, { useState, useEffect } from 'react';
import { GoogleMapsView } from './GoogleMapsView';
import { LeafletRouteMap } from './LeafletRouteMap';
import { ErrorBoundary } from './ErrorBoundary';
import { AlternativeRoute, Stoppage, TollGate } from '../types';

interface ParkingPoint {
  id?: number;
  name: string;
  lat: number;
  lng: number;
  address?: string;
}

const EMPTY_ROUTES: AlternativeRoute[] = [];
const EMPTY_STOPPAGES: Stoppage[] = [];
const EMPTY_PARKING: ParkingPoint[] = [];
const EMPTY_TOLLS: TollGate[] = [];
const EMPTY_WAYPOINTS: Array<{ lat: number; lng: number; name?: string }> = [];

interface InteractiveMapProps {
  center?: [number, number];
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

export const InteractiveMap: React.FC<InteractiveMapProps> = (props) => {
  const [googleAvailable, setGoogleAvailable] = useState<boolean>(() => {
    return typeof (window as any).google?.maps !== 'undefined';
  });

  useEffect(() => {
    if (googleAvailable) return;
    const interval = setInterval(() => {
      if (typeof (window as any).google?.maps !== 'undefined') {
        setGoogleAvailable(true);
        clearInterval(interval);
      }
    }, 200);
    return () => clearInterval(interval);
  }, [googleAvailable]);

  // Use stable static arrays for any omitted array props to avoid recreation on parent re-renders
  const safeProps = {
    ...props,
    routes: props.routes || EMPTY_ROUTES,
    stoppages: props.stoppages || EMPTY_STOPPAGES,
    parkingPoints: props.parkingPoints || EMPTY_PARKING,
    tollGates: props.tollGates || EMPTY_TOLLS,
    customWaypoints: props.customWaypoints || EMPTY_WAYPOINTS,
  };

  if (googleAvailable) {
    return (
      <ErrorBoundary fallback={<LeafletRouteMap {...safeProps} />}>
        <GoogleMapsView
          {...safeProps}
          center={props.center ? { lat: Number(props.center[0]), lng: Number(props.center[1]) } : undefined}
        />
      </ErrorBoundary>
    );
  }

  // Graceful fallback to Leaflet if Google Maps script fails to load
  return (
    <ErrorBoundary>
      <LeafletRouteMap {...safeProps} />
    </ErrorBoundary>
  );
};
