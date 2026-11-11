import React, { createContext, useContext, useState, useEffect } from 'react';
import { User } from '../types';
import { api, getAuthToken, setAuthToken, removeAuthToken } from '../api/client';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  login: (identifier: string, password: string, onBeforeTransition?: (user: User) => Promise<void>) => Promise<void>;
  loginWithOtp: (phone: string, otp: string) => Promise<void>;
  register: (data: { name: string; phone: string; password: string; confirmPassword?: string; company_name?: string; otp?: string; email?: string; role?: string }, onBeforeTransition?: (user: User) => Promise<void>) => Promise<void>;
  logout: () => void;
  quickSwitchUser: (demoUser: any) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Instant synchronous initialization from local storage for sub-second page startup
  const [user, setUser] = useState<User | null>(() => {
    try {
      const savedUser = localStorage.getItem('gpstrackx_user');
      return savedUser ? JSON.parse(savedUser) : null;
    } catch {
      return null;
    }
  });

  // Fast loading determination:
  // - No token? User is a guest, render landing page in 0 ms!
  // - Token & cached user exist? User is authenticated, render in 0 ms!
  // - Token exists but no cached user? Briefly wait (capped at 2.5s)
  const [loading, setLoading] = useState<boolean>(() => {
    const token = getAuthToken();
    if (!token) return false;
    const savedUser = localStorage.getItem('gpstrackx_user');
    if (savedUser) return false;
    return true;
  });

  const fetchCurrentUser = async () => {
    const token = getAuthToken();
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      // Guard against Render.com cold starts: max 2.5s verification wait
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Auth verification timeout')), 2500)
      );

      const data = await Promise.race([api.getMe(), timeoutPromise]) as any;
      if (data?.user) {
        setUser(data.user);
        try {
          localStorage.setItem('gpstrackx_user', JSON.stringify(data.user));
        } catch (_) {}
      }
    } catch (err: any) {
      // If 401 Unauthorized, session is truly invalid
      if (err?.message === 'Unauthorized' || err?.message?.includes('401')) {
        removeAuthToken();
        localStorage.removeItem('gpstrackx_user');
        setUser(null);
      }
      // If network timeout (e.g. Render cold start), keep existing cached user
      // so the page never blocks or buffers for the user!
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCurrentUser();

    const handleUnauthorized = () => {
      localStorage.removeItem('gpstrackx_user');
      setUser(null);
    };

    window.addEventListener('gpstrackx_unauthorized', handleUnauthorized);
    return () => window.removeEventListener('gpstrackx_unauthorized', handleUnauthorized);
  }, []);

  const login = async (identifier: string, password: string, onBeforeTransition?: (user: User) => Promise<void>) => {
    setLoading(true);
    try {
      const res = await api.login(identifier, password);
      setAuthToken(res.token);
      try {
        localStorage.setItem('gpstrackx_user', JSON.stringify(res.user));
      } catch (_) {}
      if (onBeforeTransition) {
        try {
          await onBeforeTransition(res.user);
        } catch (_) {}
      }
      setUser(res.user);
    } finally {
      setLoading(false);
    }
  };

  const loginWithOtp = async (phone: string, otp: string) => {
    setLoading(true);
    try {
      const res = await api.loginWithOtp(phone, otp);
      setAuthToken(res.token);
      try {
        localStorage.setItem('gpstrackx_user', JSON.stringify(res.user));
      } catch (_) {}
      setUser(res.user);
    } finally {
      setLoading(false);
    }
  };

  const register = async (
    data: { name: string; phone: string; password: string; confirmPassword?: string; company_name?: string; otp?: string; email?: string; role?: string },
    onBeforeTransition?: (user: User) => Promise<void>
  ) => {
    setLoading(true);
    try {
      const res = await api.register(data);
      setAuthToken(res.token);
      try {
        localStorage.setItem('gpstrackx_user', JSON.stringify(res.user));
      } catch (_) {}
      if (onBeforeTransition) {
        try {
          await onBeforeTransition(res.user);
        } catch (_) {}
      }
      setUser(res.user);
    } finally {
      setLoading(false);
    }
  };

  const quickSwitchUser = async (demoUser: any) => {
    setLoading(true);
    try {
      const defaultPassword = demoUser.role === 'admin' ? 'admin123' : 'user123';
      const res = await api.login(demoUser.email, defaultPassword);
      setAuthToken(res.token);
      try {
        localStorage.setItem('gpstrackx_user', JSON.stringify(res.user));
      } catch (_) {}
      setUser(res.user);
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    removeAuthToken();
    try {
      localStorage.removeItem('gpstrackx_user');
    } catch (_) {}
    setUser(null);
  };

  const isAdmin = user?.role === 'admin';

  return (
    <AuthContext.Provider value={{ user, loading, isAdmin, login, loginWithOtp, register, logout, quickSwitchUser, refreshUser: fetchCurrentUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};

