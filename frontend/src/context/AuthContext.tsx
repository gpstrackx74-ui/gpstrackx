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
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchCurrentUser = async () => {
    try {
      const token = getAuthToken();
      if (!token) {
        setLoading(false);
        return;
      }
      const data = await api.getMe();
      setUser(data.user);
    } catch (err) {
      removeAuthToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCurrentUser();

    const handleUnauthorized = () => {
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
      setUser(res.user);
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    removeAuthToken();
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

