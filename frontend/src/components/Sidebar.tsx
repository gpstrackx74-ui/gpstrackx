import React from 'react';
import { useAuth } from '../context/AuthContext';
import { 
  LayoutDashboard, 
  Truck, 
  Map, 
  Users, 
  Settings, 
  LogOut, 
  ChevronLeft,
  ChevronRight,
  Shield,
  UserCheck,
  X,
  Receipt,
  MapPin
} from 'lucide-react';

interface SidebarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ 
  currentTab, 
  setCurrentTab, 
  isCollapsed = false, 
  onToggleCollapse,
  isMobileOpen = false,
  onCloseMobile
}) => {
  const { user, isAdmin, logout } = useAuth();

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, adminOnly: false },
    { id: 'vehicles', label: 'Vehicles', icon: Truck, adminOnly: false },
    { id: 'vehicle-tracking', label: 'Live User View', icon: MapPin, adminOnly: true },
    { 
      id: 'routes', 
      label: 'Route Planner', 
      icon: Map, 
      adminOnly: true 
    },
    { id: 'fastag', label: 'FASTag Tolls', icon: Receipt, adminOnly: false },
    { id: 'users', label: 'Users', icon: Users, adminOnly: true },
    { id: 'settings', label: 'Settings', icon: Settings, adminOnly: true },
  ];

  const handleNavClick = (id: string) => {
    setCurrentTab(id);
    if (onCloseMobile) {
      onCloseMobile();
    }
  };

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      {isMobileOpen && (
        <div 
          onClick={onCloseMobile}
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-40 md:hidden transition-opacity"
        />
      )}

      <aside 
        className={`
          fixed md:sticky top-0 left-0 h-screen bg-white border-r border-slate-200/80 flex flex-col select-none z-50
          transition-all duration-300 ease-in-out shrink-0
          ${isMobileOpen ? 'translate-x-0 w-64 shadow-2xl' : '-translate-x-full md:translate-x-0'}
          ${isCollapsed ? 'md:w-20' : 'md:w-64'}
        `}
      >
        {/* Brand Header */}
        {isCollapsed ? (
          /* Collapsed View (Desktop Rail): Clean Centered Logo with Expand Trigger */
          <div className="py-3.5 px-2 border-b border-slate-100 flex flex-col items-center gap-2.5">
            <div className="w-10 h-10 flex items-center justify-center">
              <img 
                src="/gpstrackx-icon.png" 
                alt="GpsTrackX Logo" 
                className="w-8 h-8 object-contain" 
              />
            </div>
            {onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition cursor-pointer"
                title="Expand Sidebar"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : (
          /* Expanded View (Desktop & Mobile Drawer): Full Brand Logo */
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center overflow-hidden">
              <img 
                src="/gpstrackx-brand.png" 
                alt="GpsTrackX Brand Logo" 
                className="h-8 w-auto object-contain" 
              />
            </div>

            <div className="flex items-center">
              {/* Close button on mobile */}
              <button
                type="button"
                onClick={onCloseMobile}
                className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex md:hidden items-center justify-center transition cursor-pointer"
                title="Close Menu"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Collapse button on desktop */}
              {onToggleCollapse && (
                <button
                  type="button"
                  onClick={onToggleCollapse}
                  className="hidden md:flex w-7 h-7 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 items-center justify-center transition shrink-0 cursor-pointer"
                  title="Collapse Sidebar"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Navigation Menu */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {navItems.map((item) => {
            if (item.adminOnly && !isAdmin) return null;
            const isActive = currentTab === item.id;
            const Icon = item.icon;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                className={`w-full flex items-center ${
                  isCollapsed ? 'justify-center px-2 py-3' : 'justify-between px-3.5 py-2.5'
                } rounded-2xl font-bold text-xs transition-all cursor-pointer ${
                  isActive
                    ? 'bg-[#E60012] text-white shadow-sm shadow-red-500/20'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
                }`}
                title={isCollapsed ? item.label : undefined}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                  {!isCollapsed && <span>{item.label}</span>}
                </div>
                {!isCollapsed && isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-white" />
                )}
              </button>
            );
          })}
        </div>

        {/* User Footer Profile */}
        <div className="p-3 border-t border-slate-100 bg-slate-50/70">
          <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'} gap-2`}>
            <div className="flex items-center gap-2.5 overflow-hidden min-w-0">
              <div 
                className="w-8 h-8 rounded-xl flex items-center justify-center text-white font-extrabold text-xs shrink-0 shadow-xs"
                style={{ backgroundColor: user?.avatar_color || user?.avatarColor || '#0F172A' }}
              >
                {user?.name ? user.name.slice(0, 2).toUpperCase() : 'U'}
              </div>
              {!isCollapsed && (
                <div className="truncate min-w-0">
                  <p className="text-xs font-extrabold text-slate-900 truncate leading-snug">{user?.name || 'User'}</p>
                  <p className="text-[10px] text-slate-400 truncate font-medium">{user?.email || ''}</p>
                </div>
              )}
            </div>
            {!isCollapsed && (
              <button
                type="button"
                onClick={logout}
                title="Log out"
                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-white rounded-lg transition border border-transparent hover:border-slate-200 shrink-0 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
};
