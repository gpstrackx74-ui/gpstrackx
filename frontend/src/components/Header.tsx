import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { 
  Search, 
  ChevronDown, 
  LogOut, 
  Shield, 
  UserCheck, 
  X,
  Truck,
  Route,
  Users as UsersIcon,
  Compass,
  ArrowRight,
  Loader2,
  Receipt,
  LayoutDashboard,
  Settings,
  History,
  ChevronUp
} from 'lucide-react';
import { 
  highlightInPage, 
  clearHighlights, 
  setPendingSearchFocus 
} from '../utils/searchHighlighter';

interface HeaderProps {
  title?: string;
  subtitle?: string;
  currentTab?: string;
  onNavigateTab?: (tab: string, vehicleId?: number) => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ 
  currentTab = 'dashboard', 
  onNavigateTab
}) => {
  const { user, isAdmin, logout } = useAuth();

  const [demoUsers, setDemoUsers] = useState<any[]>([]);
  const [showUserDropdown, setShowUserDropdown] = useState(false);

  // Strictly reordered admin tabs per specification (No Dashboard tab for admin):
  // 1. Live User View, 2. Users, 3. Vehicles, 4. Route Planner, 5. FASTag Toll, 6. Settings
  const adminNavItems = [
    { id: 'vehicle-tracking', label: 'Live User View', icon: Compass },
    { id: 'users', label: 'Users', icon: UsersIcon },
    { id: 'vehicles', label: 'Vehicles', icon: Truck },
    { id: 'routes', label: 'Route Planner', icon: Route },
    { id: 'fastag', label: 'FASTag Toll', icon: Receipt },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const userNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'vehicle-tracking', label: 'Live User View', icon: Compass },
    { id: 'history', label: 'Trip History', icon: History },
    { id: 'fastag', label: 'FASTag Toll', icon: Receipt },
  ];

  const currentNavItems = isAdmin ? adminNavItems : userNavItems;

  // Global & In-Page Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [inPageMatchStats, setInPageMatchStats] = useState<{ total: number; current: number }>({ total: 0, current: 0 });
  const [searchResults, setSearchResults] = useState<{
    vehicles: any[];
    routes: any[];
    users: any[];
    pages: any[];
    total: number;
  } | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const userMenuRef = useRef<HTMLDivElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Outside click & escape listeners
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserDropdown(false);
      }
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsSearchOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowUserDropdown(false);
        setIsSearchOpen(false);
      }
    };

    const handleShortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    window.addEventListener('keydown', handleEscape);
    window.addEventListener('keydown', handleShortcut);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
      window.removeEventListener('keydown', handleEscape);
      window.removeEventListener('keydown', handleShortcut);
    };
  }, []);

  // Fetch demo users for easy role testing
  useEffect(() => {
    api.getDemoUsers().then(users => setDemoUsers(users)).catch(() => {});
  }, []);

  // In-page search highlight and server fleet search query
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed || trimmed.length < 2) {
      clearHighlights();
      setInPageMatchStats({ total: 0, current: 0 });
      setSearchResults(null);
      setIsSearching(false);
      return;
    }

    // Immediately highlight on the active page and focus first match
    const stats = highlightInPage(trimmed, false);
    setInPageMatchStats(stats);

    setIsSearching(true);
    const timer = setTimeout(() => {
      api.search(trimmed)
        .then(res => {
          setSearchResults(res);
        })
        .catch(() => {
          setSearchResults(null);
        })
        .finally(() => {
          setIsSearching(false);
        });
    }, 180);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSelectNav = (tab: string, vehicleId?: number) => {
    if (searchQuery.trim().length >= 2) {
      setPendingSearchFocus(searchQuery.trim());
    }
    if (onNavigateTab) {
      onNavigateTab(tab, vehicleId);
    }
    setIsSearchOpen(false);
  };

  const handleCycleInPageMatch = (advanceNext = true) => {
    if (searchQuery.trim().length >= 2) {
      const stats = highlightInPage(searchQuery.trim(), advanceNext);
      setInPageMatchStats(stats);
    }
  };

  return (
    <header className="bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-3 sm:px-6 py-2 sticky top-0 z-40 select-none transition-colors shadow-2xs">
      <div className="flex items-center justify-between gap-3 max-w-[1700px] mx-auto w-full">
        {/* Left: Brand Logo */}
        <div className="flex items-center gap-2 shrink-0">
          <div 
            onClick={() => onNavigateTab?.(isAdmin ? 'vehicle-tracking' : 'dashboard')}
            className="flex items-center gap-2 shrink-0 cursor-pointer hover:opacity-90 transition py-0.5"
            title="GpsTrackX Fleet Platform"
          >
            <img 
              src="/gpstrackx-brand.png" 
              alt="GpsTrackX" 
              className="h-8 w-auto object-contain hidden sm:block" 
            />
            <div className="flex items-center gap-1.5 sm:hidden">
              <img 
                src="/gpstrackx-icon.png" 
                alt="GpsTrackX" 
                className="h-7 w-7 object-contain" 
              />
              <span className="font-mono font-black text-slate-900 text-sm tracking-tight">GpsTrack<span className="text-[#E60012]">X</span></span>
            </div>
          </div>
        </div>

        {/* Center: Top Navigation Bar (Fixed in the Center) */}
        <div className="flex-1 flex items-center justify-center min-w-0 px-2">
          <nav className="flex items-center justify-center gap-1 sm:gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            {currentNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigateTab?.(item.id)}
                  className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
                    isActive
                      ? 'bg-[#E60012] text-white shadow-2xs font-black'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/90'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                  <span className="whitespace-nowrap">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right: Compact Search & User Profile */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Compact Global Search Bar */}
          <div ref={searchContainerRef} className="relative">
            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (!isSearchOpen) setIsSearchOpen(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    // If matches exist on the current page, cycle to next match and focus it!
                    if (inPageMatchStats.total > 0) {
                      handleCycleInPageMatch(true);
                      return;
                    }
                    if (searchResults) {
                      if (searchResults.vehicles && searchResults.vehicles.length > 0) {
                        handleSelectNav('vehicle-tracking', searchResults.vehicles[0].id);
                      } else if (searchResults.routes && searchResults.routes.length > 0) {
                        handleSelectNav('routes', searchResults.routes[0].vehicle_id);
                      } else if (searchResults.pages && searchResults.pages.length > 0) {
                        handleSelectNav(searchResults.pages[0].tab || (isAdmin ? 'vehicle-tracking' : 'dashboard'));
                      } else if (searchResults.users && searchResults.users.length > 0) {
                        handleSelectNav('users');
                      } else if ((searchResults as any).fastag && (searchResults as any).fastag.length > 0) {
                        handleSelectNav('fastag');
                      }
                    }
                  }
                }}
                onFocus={() => setIsSearchOpen(true)}
                placeholder="Search..."
                className="w-28 sm:w-40 md:w-48 lg:w-56 pl-7.5 pr-14 py-1 text-xs bg-slate-100 hover:bg-slate-100/90 focus:bg-white text-slate-900 placeholder:text-slate-400 rounded-xl border border-slate-200/90 focus:border-slate-400 focus:ring-1 focus:ring-slate-200 transition shadow-2xs outline-none"
              />

              {/* In-Page Match Counter & Next Button */}
              {inPageMatchStats.total > 0 && (
                <button
                  type="button"
                  onClick={() => handleCycleInPageMatch(true)}
                  className="absolute right-6 px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-mono font-bold hover:bg-amber-200 transition cursor-pointer"
                  title="Click or press Enter to focus next match on page"
                >
                  {inPageMatchStats.current}/{inPageMatchStats.total}
                </button>
              )}

              {isSearching ? (
                <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin absolute right-2 pointer-events-none" />
              ) : searchQuery ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    clearHighlights();
                    setInPageMatchStats({ total: 0, current: 0 });
                    setSearchResults(null);
                  }}
                  className="absolute right-1.5 p-0.5 rounded-full text-slate-400 hover:text-slate-700 transition cursor-pointer"
                  title="Clear Search"
                >
                  <X className="w-3 h-3" />
                </button>
              ) : (
                <span className="hidden sm:inline-flex items-center absolute right-1.5 text-[9px] font-mono text-slate-400 bg-white border border-slate-200 rounded px-1 py-0.2 pointer-events-none shadow-2xs">
                  ⌘K
                </span>
              )}
            </div>

          {/* Global Search Results Dropdown / Popover */}
          {isSearchOpen && (searchQuery.trim().length > 0 || searchResults) && (
            <div className="absolute right-0 sm:right-0 mt-2 w-[88vw] sm:w-[460px] md:w-[500px] max-h-[460px] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-slate-200/90 p-3 z-50 animate-in fade-in zoom-in-95 duration-150 divide-y divide-slate-100">
              {/* Search Header Summary */}
              <div className="flex items-center justify-between pb-2 text-[11px] font-semibold text-slate-500">
                <span>
                  {inPageMatchStats.total > 0
                    ? `Found ${inPageMatchStats.total} match(es) on this page (Press Enter to jump)`
                    : searchResults && searchResults.total > 0
                    ? `Found ${searchResults.total} fleet records for "${searchQuery}"`
                    : isSearching ? `Searching across all pages...` : `Search Results for "${searchQuery}"`}
                </span>
                <span className="text-[10px] font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-400">
                  ESC to close
                </span>
              </div>

              {/* 1. Vehicles Section */}
              {searchResults && searchResults.vehicles && searchResults.vehicles.length > 0 && (
                <div className="py-2 space-y-1">
                  <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                    <Truck className="w-3 h-3 text-red-500" />
                    <span>Vehicles ({searchResults.vehicles.length})</span>
                  </div>
                  {searchResults.vehicles.map((v) => (
                    <div
                      key={v.id}
                      onMouseDown={(e) => { e.preventDefault(); handleSelectNav('vehicle-tracking', v.id); }}
                      onClick={() => handleSelectNav('vehicle-tracking', v.id)}
                      className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 border border-transparent hover:border-slate-100 transition cursor-pointer group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                          <Truck className="w-4 h-4" />
                        </div>
                        <div className="truncate">
                          <p className="text-xs font-black text-slate-900 font-mono group-hover:text-red-600 transition truncate">
                            {v.registration_no}
                          </p>
                          <p className="text-[10px] text-slate-400 truncate">
                            {v.name_model} • {v.vehicle_type} {v.driver_name ? `• User: ${v.driver_name}` : ''}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${
                          v.status === 'moving'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : v.status === 'active'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'bg-slate-100 text-slate-600'
                        }`}>
                          {v.status}
                        </span>
                        <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-600 transition" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 2. Routes Section */}
              {searchResults && searchResults.routes && searchResults.routes.length > 0 && (
                <div className="py-2 space-y-1">
                  <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                    <Route className="w-3 h-3 text-blue-500" />
                    <span>Routes ({searchResults.routes.length})</span>
                  </div>
                  {searchResults.routes.map((r) => (
                    <div
                      key={r.id}
                      onMouseDown={(e) => { e.preventDefault(); handleSelectNav('routes', r.vehicle_id); }}
                      onClick={() => handleSelectNav('routes', r.vehicle_id)}
                      className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 border border-transparent hover:border-slate-100 transition cursor-pointer group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                          <Route className="w-4 h-4" />
                        </div>
                        <div className="truncate">
                          <p className="text-xs font-bold text-slate-900 group-hover:text-blue-600 transition truncate">
                            {r.route_name}
                          </p>
                          <p className="text-[10px] text-slate-400 truncate">
                            {r.start_location_name} → {r.end_location_name}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-xs font-mono font-bold text-slate-800">
                          {r.total_distance_km} KM
                        </span>
                        <p className="text-[10px] text-slate-400">
                          ~{Math.floor(r.estimated_travel_time_min / 60)}h {r.estimated_travel_time_min % 60}m
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 3. Users Section */}
              {searchResults && searchResults.users && searchResults.users.length > 0 && (
                <div className="py-2 space-y-1">
                  <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                    <UsersIcon className="w-3 h-3 text-purple-500" />
                    <span>Users ({searchResults.users.length})</span>
                  </div>
                  {searchResults.users.map((u) => (
                    <div
                      key={u.id}
                      onMouseDown={(e) => { e.preventDefault(); handleSelectNav('users'); }}
                      onClick={() => handleSelectNav('users')}
                      className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 border border-transparent hover:border-slate-100 transition cursor-pointer group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div 
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[11px] font-black shrink-0"
                          style={{ backgroundColor: u.avatar_color || '#8B5CF6' }}
                        >
                          {u.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="truncate">
                          <p className="text-xs font-bold text-slate-900 group-hover:text-purple-600 transition truncate">
                            {u.name}
                          </p>
                          <p className="text-[10px] text-slate-400 truncate">
                            {u.email} {u.phone ? `• ${u.phone}` : ''}
                          </p>
                        </div>
                      </div>
                      <span className={`text-[9px] font-mono font-bold uppercase px-2 py-0.5 rounded ${
                        u.role === 'admin' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'
                      }`}>
                        {u.role}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* FASTag Toll Invoices Section */}
              {searchResults && (searchResults as any).fastag && (searchResults as any).fastag.length > 0 && (
                <div className="py-2 space-y-1">
                  <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                    <Receipt className="w-3 h-3 text-red-500" />
                    <span>FASTag Toll Invoices ({(searchResults as any).fastag.length})</span>
                  </div>
                  {(searchResults as any).fastag.map((ft: any) => (
                    <div
                      key={ft.id}
                      onMouseDown={(e) => { e.preventDefault(); handleSelectNav('fastag'); }}
                      onClick={() => handleSelectNav('fastag')}
                      className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 border border-transparent hover:border-slate-100 transition cursor-pointer group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                          <Receipt className="w-3.5 h-3.5" />
                        </div>
                        <div className="truncate">
                          <p className="text-xs font-bold text-slate-900 group-hover:text-red-600 transition truncate">
                            {ft.toll_plaza_name} (₹{ft.amount})
                          </p>
                          <p className="text-[10px] text-slate-400 truncate">
                            {ft.vehicle_registration_no} • {ft.transaction_id}
                          </p>
                        </div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-600 transition shrink-0" />
                    </div>
                  ))}
                </div>
              )}

              {/* 4. System Pages Section */}
              {searchResults && searchResults.pages && searchResults.pages.length > 0 && (
                <div className="py-2 space-y-1">
                  <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                    <Compass className="w-3 h-3 text-emerald-500" />
                    <span>Pages & Views ({searchResults.pages.length})</span>
                  </div>
                  {searchResults.pages.map((p) => (
                    <div
                      key={p.tab || p.title}
                      onMouseDown={(e) => { e.preventDefault(); handleSelectNav(p.tab || 'dashboard'); }}
                      onClick={() => handleSelectNav(p.tab || 'dashboard')}
                      className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 border border-transparent hover:border-slate-100 transition cursor-pointer group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                          <Compass className="w-4 h-4" />
                        </div>
                        <div className="truncate">
                          <p className="text-xs font-bold text-slate-900 group-hover:text-emerald-600 transition truncate">
                            {p.title}
                          </p>
                          <p className="text-[10px] text-slate-400 truncate">
                            {p.desc}
                          </p>
                        </div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-600 transition shrink-0" />
                    </div>
                  ))}
                </div>
              )}

              {/* Empty State */}
              {searchResults && searchResults.total === 0 && !isSearching && (
                <div className="py-6 text-center space-y-1.5">
                  <Search className="w-6 h-6 text-slate-300 mx-auto" />
                  <p className="text-xs font-bold text-slate-700">
                    No fleet data found for &quot;{searchQuery}&quot;
                  </p>
                  <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                    Try searching by vehicle registration number (e.g. WB19), driver name, city (e.g. Raipur, Bilaspur), or page title.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>



        {/* User Profile Capsule (Ref: Reference Image 2 "Jhontosan" Style) */}
        <div ref={userMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setShowUserDropdown(!showUserDropdown)}
            className="flex items-center gap-2.5 pl-1.5 pr-3 py-1 rounded-full hover:bg-slate-100 border border-slate-200/80 transition cursor-pointer"
          >
            <div 
              className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-black shrink-0 shadow-xs"
              style={{ backgroundColor: user?.avatar_color || user?.avatarColor || '#0F172A' }}
            >
              {user?.name ? user.name.slice(0, 2).toUpperCase() : 'U'}
            </div>
            <div className="text-left hidden md:block">
              <p className="text-xs font-extrabold text-slate-900 leading-tight">
                {user?.name || 'User'}
              </p>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-0.5" />
          </button>

          {showUserDropdown && (
            <div className="absolute right-0 mt-2 w-72 bg-white rounded-2xl shadow-xl border border-slate-200 p-2.5 z-50 animate-in fade-in zoom-in-95 duration-150">
              {/* User Bio Header */}
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 mb-2">
                <div className="flex items-center gap-2">
                  {isAdmin ? (
                    <Shield className="w-4 h-4 text-slate-900 shrink-0" />
                  ) : (
                    <UserCheck className="w-4 h-4 text-slate-600 shrink-0" />
                  )}
                  <div className="truncate">
                    <p className="text-xs font-black text-slate-900 truncate">{user?.name}</p>
                    <p className="text-[10px] text-slate-400 truncate">{user?.email}</p>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between text-[10px]">
                  <span className="text-slate-500 font-medium">Access Permission:</span>
                  <span className="font-bold uppercase px-1.5 py-0.2 rounded bg-white border border-slate-200 text-slate-800">
                    {isAdmin ? 'Super Admin' : 'Fleet User'}
                  </span>
                </div>
              </div>

              {/* Logout Button */}
              <div className="pt-2 mt-1 border-t border-slate-100">
                <button
                  type="button"
                  onClick={logout}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left text-xs font-bold text-red-600 hover:bg-red-50 transition cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Log Out of Account</span>
                </button>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>
    </header>
  );
};
