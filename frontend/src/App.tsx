import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { api } from './api/client';
import { Sidebar } from './components/Sidebar';
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

const AppContent: React.FC = () => {
  const { user, loading, isAdmin } = useAuth();
  const [currentTab, setCurrentTab] = useState('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const [previousTab, setPreviousTab] = useState<'dashboard' | 'vehicles'>('dashboard');
  const [routePlanVehicleId, setRoutePlanVehicleId] = useState<number | null>(null);
  const [userVehicles, setUserVehicles] = useState<any[]>([]);

  // Automatically fetch accessible vehicles so Map View & Route Telemetry always have a target vehicle
  useEffect(() => {
    if (user) {
      setCurrentTab('dashboard');
      api.getVehicles()
        .then((vehs) => {
          setUserVehicles(vehs || []);
          if (vehs && vehs.length > 0) {
            // Pick vehicle with active route or first vehicle
            const withRoute = vehs.find((v: any) => v.route_name);
            setSelectedVehicleId(prev => prev || (withRoute ? withRoute.id : vehs[0].id));
          }
        })
        .catch(() => {});
    }
  }, [user]);

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

  const handleToggleSidebar = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setMobileMenuOpen(!mobileMenuOpen);
    } else {
      setSidebarCollapsed(!sidebarCollapsed);
    }
  };

  // Handle viewing vehicle details & live tracking
  const handleViewVehicle = (id: number) => {
    setPreviousTab(currentTab === 'vehicles' ? 'vehicles' : 'dashboard');
    setSelectedVehicleId(id);
    setCurrentTab('vehicle-tracking');
  };

  // Handle opening route planner for a specific vehicle
  const handlePlanRouteForVehicle = (id: number) => {
    setRoutePlanVehicleId(id);
    setCurrentTab('routes');
  };

  // Dynamic header titles matching Reference Image 2
  const getHeaderInfo = () => {
    switch (currentTab) {
      case 'dashboard':
        return {
          title: 'Track Vehicles',
          subtitle: 'Have an in-depth look at all the metrics within your dashboard'
        };
      case 'vehicles':
        return {
          title: 'Vehicle Management',
          subtitle: 'Manage commercial vehicle inventory and active drivers'
        };
      case 'routes':
        return {
          title: isAdmin ? 'Route Planning' : 'Route & Live Map View',
          subtitle: isAdmin
            ? 'Select start/end points, compare road routes and allocate to vehicle'
            : 'Live Google Maps path, stoppages, toll plazas and route motion playback'
        };
      case 'vehicle-tracking':
        return {
          title: 'Live User View',
          subtitle: 'Live Google Maps path, speed, stoppage records, tolls and playback simulation'
        };
      case 'fastag':
        return {
          title: 'FASTag Tolls & Invoices',
          subtitle: 'Commercial truck electronic toll collection, tariffs and tax bills'
        };
      case 'users':
        return {
          title: 'User Management',
          subtitle: 'Create, edit and manage system user accounts'
        };
      case 'settings':
        return {
          title: 'Fleet Settings',
          subtitle: 'Configure platform parameters and Google Maps engine'
        };
      default:
        return {
          title: 'Fleet Operations',
          subtitle: 'Commercial vehicle tracking and management'
        };
    }
  };

  const headerInfo = getHeaderInfo();

  return (
    <div className="h-screen bg-[#F8FAFC] flex overflow-hidden">
      {/* Collapsible / Responsive Mobile Drawer Sidebar */}
      <Sidebar 
        currentTab={currentTab} 
        setCurrentTab={setCurrentTab} 
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        isMobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      {/* Main Content Area (Static Sidebar, Content Scrolls) */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto">
        {/* Top Header Bar (Ref: Reference Image 2) */}
        <Header
          title={headerInfo.title}
          subtitle={headerInfo.subtitle}
          isSidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={handleToggleSidebar}
          onNavigateTab={(tab, vehicleId) => {
            if (tab === 'routes' && vehicleId) {
              handlePlanRouteForVehicle(vehicleId);
            } else if (vehicleId) {
              handleViewVehicle(vehicleId);
            } else {
              setCurrentTab(tab);
            }
          }}
        />

        <main className="flex-1 pb-12">
          {currentTab === 'dashboard' && (
            <Dashboard 
              onNavigateTab={(tab) => setCurrentTab(tab)} 
              onViewVehicle={handleViewVehicle}
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
                vehicleId={selectedVehicleId || (userVehicles[0] ? userVehicles[0].id : 1)}
                onBack={() => setCurrentTab('dashboard')}
                onSwitchVehicle={(vId) => setSelectedVehicleId(vId)}
              />
            )
          )}

          {currentTab === 'vehicle-tracking' && (
            <ErrorBoundary title="Vehicle Live Map View">
              <VehicleTracking
                vehicleId={selectedVehicleId || (userVehicles[0] ? userVehicles[0].id : 1)}
                onBack={() => setCurrentTab(previousTab)}
                onPlanRoute={isAdmin ? handlePlanRouteForVehicle : undefined}
                onSwitchVehicle={(vId) => setSelectedVehicleId(vId)}
              />
            </ErrorBoundary>
          )}

          {currentTab === 'users' && isAdmin && <UsersManagement />}

          {currentTab === 'fastag' && <FastagBilling />}

          {currentTab === 'settings' && isAdmin && <SettingsPage />}
        </main>
      </div>
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
