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

  if (googleAvailable) {
    return (
      <ErrorBoundary fallback={<LeafletRouteMap {...props} />}>
        <GoogleMapsView
          {...props}
          center={props.center ? { lat: Number(props.center[0]), lng: Number(props.center[1]) } : undefined}
        />
      </ErrorBoundary>
    );
  }

  // Graceful fallback to Leaflet if Google Maps script fails to load
  return (
    <ErrorBoundary>
      <LeafletRouteMap {...props} />
    </ErrorBoundary>
  );
};
