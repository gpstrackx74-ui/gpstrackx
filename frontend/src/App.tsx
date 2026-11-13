import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { api } from './api/client';
import { Header } from './components/Header';
import { LandingPage } from './pages/LandingPage';
import { AuthPage } from './pages/AuthPage';
import { Dashboard } from './pages/Dashboard';
import { Vehicles } from './pages/Vehicles';
import { RoutePlanning } from './pages/RoutePlanning';
import { VehicleTracking } from './pages/VehicleTracking';
import { UsersManagement } from './pages/Users';
import { SettingsPage } from './pages/Settings';
import { FastagBilling } from './pages/FastagBilling';
import { ErrorBoundary } from './components/ErrorBoundary';
import { checkAndApplyPendingSearch } from './utils/searchHighlighter';

const AppContent: React.FC = () => {
  const { user, loading, isAdmin } = useAuth();
  const [currentTab, setCurrentTab] = useState('vehicle-tracking');
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const [previousTab, setPreviousTab] = useState<'dashboard' | 'vehicles' | 'history'>('vehicles');
  const [routePlanVehicleId, setRoutePlanVehicleId] = useState<number | null>(null);
  const [userVehicles, setUserVehicles] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem('gpstrackx_cached_vehicles');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [adminMapViewVehicleId, setAdminMapViewVehicleId] = useState<number | null>(null);
  const [selectedHistoricalTrip, setSelectedHistoricalTrip] = useState<any | null>(null);
  const [viewSource, setViewSource] = useState<'assigned-vehicle' | 'trip-history'>('assigned-vehicle');

  // Automatically fetch accessible vehicles so Map View & Route Telemetry always have a target vehicle
  useEffect(() => {
    if (user) {
      // Admin defaults to 'vehicle-tracking' (Live User View), regular users default to 'dashboard'
      setCurrentTab(user.role === 'admin' ? 'vehicle-tracking' : 'dashboard');
      api.getVehicles()
        .then((vehs) => {
          if (vehs && Array.isArray(vehs)) {
            setUserVehicles(vehs);
            try {
              localStorage.setItem('gpstrackx_cached_vehicles', JSON.stringify(vehs));
            } catch (_) {}
            if (vehs.length > 0) {
              // Pick vehicle with active route or first vehicle
              const withRoute = vehs.find((v: any) => v.route_name);
              setSelectedVehicleId(prev => prev || (withRoute ? withRoute.id : vehs[0].id));
            }
          }
        })
        .catch(() => {});
    }
  }, [user]);

  // If admin is on dashboard tab, redirect directly to vehicle-tracking
  useEffect(() => {
    if (isAdmin && currentTab === 'dashboard') {
      setCurrentTab('vehicle-tracking');
    }
  }, [isAdmin, currentTab]);

  // Highlight and focus pending search terms across tab transitions
  useEffect(() => {
    checkAndApplyPendingSearch();
  }, [currentTab, selectedVehicleId, adminMapViewVehicleId]);

  const [authView, setAuthView] = useState<'landing' | 'login' | 'signup'>('landing');

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center">
        <div className="w-10 h-10 border-3 border-slate-900 border-t-transparent rounded-full animate-spin mb-3"></div>
        <p className="text-xs font-bold text-slate-600 tracking-wider uppercase">Loading GpsTrackX...</p>
      </div>
    );
  }

  // If user is not authenticated: Show Landing Page or Auth Page (Sign In / Sign Up)
  if (!user) {
    if (authView === 'login' || authView === 'signup') {
      return (
        <AuthPage 
          initialTab={authView} 
          onBackToHome={() => setAuthView('landing')} 
        />
      );
    }
    return (
      <LandingPage 
        onSignIn={() => setAuthView('login')} 
        onSignUp={() => setAuthView('signup')} 
      />
    );
  }

  // Handle viewing vehicle details & live tracking
  const handleViewVehicle = (id: number, trip?: any, source?: 'assigned-vehicle' | 'trip-history') => {
    setPreviousTab(currentTab === 'vehicles' ? 'vehicles' : currentTab === 'history' ? 'history' : 'dashboard');
    setSelectedVehicleId(id);
    setSelectedHistoricalTrip(trip || null);
    setViewSource(source || (trip ? 'trip-history' : 'assigned-vehicle'));
    setCurrentTab('vehicle-tracking');
  };

  // Handle opening route planner for a specific vehicle
  const handlePlanRouteForVehicle = (id: number) => {
    setRoutePlanVehicleId(id);
    setCurrentTab('routes');
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col font-sans">
      {/* Top Header Bar with Side-by-Side Navigation Links */}
      <Header
        currentTab={currentTab}
        onNavigateTab={(tab, vehicleId) => {
          if (tab === 'routes' && vehicleId) {
            handlePlanRouteForVehicle(vehicleId);
          } else if (tab === 'vehicle-tracking') {
            setAdminMapViewVehicleId(vehicleId || null);
            setCurrentTab('vehicle-tracking');
          } else if (vehicleId) {
            handleViewVehicle(vehicleId);
          } else {
            setAdminMapViewVehicleId(null);
            setCurrentTab(tab);
          }
        }}
      />

      {/* Main Content Area (Full Width, Enterprise Modern Layout) */}
      <main className="flex-1 pb-12">
        {currentTab === 'dashboard' && (
          <Dashboard 
            onNavigateTab={(tab) => setCurrentTab(tab)} 
            onViewVehicle={handleViewVehicle}
            initialUserTab="vehicle"
          />
        )}

        {currentTab === 'history' && !isAdmin && (
          <Dashboard 
            onNavigateTab={(tab) => setCurrentTab(tab)} 
            onViewVehicle={handleViewVehicle}
            initialUserTab="history"
          />
        )}

        {currentTab === 'vehicles' && (
          <Vehicles 
            onViewVehicle={handleViewVehicle}
            onPlanRouteForVehicle={isAdmin ? handlePlanRouteForVehicle : undefined}
          />
        )}

        {currentTab === 'routes' && (
          isAdmin ? (
            <RoutePlanning
              initialVehicleId={routePlanVehicleId}
              onSavedRouteSuccess={(vId) => handleViewVehicle(vId)}
            />
          ) : (
            <VehicleTracking
              vehicleId={selectedVehicleId || (userVehicles[0] ? userVehicles[0].id : 0)}
              viewSource={viewSource}
              onBack={() => setCurrentTab('dashboard')}
              onSwitchVehicle={(vId) => setSelectedVehicleId(vId)}
            />
          )
        )}

        {currentTab === 'vehicle-tracking' && (
          isAdmin ? (
            adminMapViewVehicleId ? (
              <ErrorBoundary title="Vehicle Live Map View">
                <VehicleTracking
                  vehicleId={adminMapViewVehicleId}
                  historicalTrip={selectedHistoricalTrip}
                  viewSource={viewSource}
                  onBack={() => {
                    setAdminMapViewVehicleId(null);
                    setSelectedHistoricalTrip(null);
                  }}
                  onPlanRoute={handlePlanRouteForVehicle}
                  onSwitchVehicle={(vId) => setAdminMapViewVehicleId(vId)}
                />
              </ErrorBoundary>
            ) : (
              <Dashboard
                onNavigateTab={(tab) => setCurrentTab(tab)}
                onViewVehicle={(vId, trip, source) => {
                  setAdminMapViewVehicleId(vId);
                  setSelectedHistoricalTrip(trip || null);
                  setViewSource(source || (trip ? 'trip-history' : 'assigned-vehicle'));
                }}
                initialUserTab="vehicle"
                isLiveUserView={true}
              />
            )
          ) : (
            <ErrorBoundary title="Vehicle Live Map View">
              <VehicleTracking
                vehicleId={selectedVehicleId || (userVehicles[0] ? userVehicles[0].id : 0)}
                historicalTrip={selectedHistoricalTrip}
                viewSource={viewSource}
                onBack={() => {
                  setSelectedHistoricalTrip(null);
                  setCurrentTab(previousTab);
                }}
                onSwitchVehicle={(vId) => setSelectedVehicleId(vId)}
              />
            </ErrorBoundary>
          )
        )}

        {currentTab === 'users' && isAdmin && <UsersManagement />}

        {currentTab === 'fastag' && <FastagBilling />}

        {currentTab === 'settings' && isAdmin && <SettingsPage />}
      </main>
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
