const API_BASE = (
  import.meta.env.VITE_API_URL 
    ? String(import.meta.env.VITE_API_URL).replace(/\/$/, '') 
    : (import.meta.env.PROD ? 'https://gpstrackx.onrender.com' : '')
) + '/api';

export function getAuthToken(): string | null {
  return localStorage.getItem('gpstrackx_token');
}

export function setAuthToken(token: string) {
  localStorage.setItem('gpstrackx_token', token);
}

export function removeAuthToken() {
  localStorage.removeItem('gpstrackx_token');
}

export async function apiRequest<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers
  });

  if (response.status === 401) {
    removeAuthToken();
    window.dispatchEvent(new Event('gpstrackx_unauthorized'));
    throw new Error('Unauthorized');
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }

  return data;
}

export const api = {
  // Auth
  register: (data: { name: string; email?: string; password: string; confirmPassword?: string; phone: string; company_name?: string; otp?: string; role?: string }) =>
    apiRequest<{ message: string; token: string; user: any }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  login: (identifierOrEmail: string, password: string) => 
    apiRequest<{ token: string; user: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: identifierOrEmail, password })
    }),
  sendOtp: (phone: string) =>
    apiRequest<{ success: boolean; message: string; debugOtp?: string }>('/auth/send-otp', {
      method: 'POST',
      body: JSON.stringify({ phone })
    }),
  verifyOtp: (phone: string, otp: string) =>
    apiRequest<{ success: boolean; message: string }>('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ phone, otp })
    }),
  loginWithOtp: (phone: string, otp: string) =>
    apiRequest<{ token: string; user: any }>('/auth/login-otp', {
      method: 'POST',
      body: JSON.stringify({ phone, otp })
    }),
  getMe: () => apiRequest<{ user: any }>('/auth/me'),
  updateProfile: (data: { name: string; phone?: string }) => 
    apiRequest<{ message: string; user: any }>('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(data)
    }),
  changePassword: (data: { currentPassword: string; newPassword: string }) => 
    apiRequest<{ message: string }>('/auth/change-password', {
      method: 'PUT',
      body: JSON.stringify(data)
    }),
  getDemoUsers: () => apiRequest<any[]>('/auth/demo-users'),

  // Dashboard
  getStats: () => apiRequest<{ stats: any; recentVehicles: any[] }>('/dashboard/stats'),

  // Vehicles
  getVehicles: (params: { search?: string; type?: string; status?: string; userId?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.type) query.set('type', params.type);
    if (params.status) query.set('status', params.status);
    if (params.userId) query.set('userId', params.userId);
    return apiRequest<any[]>(`/vehicles?${query.toString()}`);
  },
  getVehicle: (id: number | string) => apiRequest<any>(`/vehicles/${id}`),
  createVehicle: (data: any) => apiRequest('/vehicles', { method: 'POST', body: JSON.stringify(data) }),
  updateVehicle: (id: number | string, data: any) => apiRequest(`/vehicles/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteVehicle: (id: number | string) => apiRequest(`/vehicles/${id}`, { method: 'DELETE' }),

  // Users
  getUsers: (params: { search?: string; status?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.status) query.set('status', params.status);
    return apiRequest<any[]>(`/users?${query.toString()}`);
  },
  createUser: (data: any) => apiRequest('/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id: number | string, data: any) => apiRequest(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteUser: (id: number | string) => apiRequest(`/users/${id}`, { method: 'DELETE' }),

  // Routes
  calculateRoutes: (data: { origin: any; destination: any; waypoints?: any[]; manualTolls?: any[] }) =>
    apiRequest<{ routes: any[]; meta: any }>('/routes/calculate', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  saveRoute: (data: any) => apiRequest('/routes', { method: 'POST', body: JSON.stringify(data) }),
  saveCorridor: (data: any) => apiRequest('/routes/save-corridor', { method: 'POST', body: JSON.stringify(data) }),
  updateQuickRoute: (vehicleId: number | string, data: any) =>
    apiRequest(`/vehicles/${vehicleId}/quick-route`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRoute: (id: number | string) => apiRequest(`/routes/${id}`, { method: 'DELETE' }),
  getSavedCorridors: () => apiRequest<any[]>('/routes/saved-corridors'),

  // Settings
  getSettings: () => apiRequest<Record<string, string>>('/settings'),
  updateSettings: (data: any) => apiRequest('/settings', { method: 'POST', body: JSON.stringify(data) }),

  // FASTag Tolls & Billing Invoices
  getFastagTransactions: (params: { vehicle_id?: string; search?: string; date?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.vehicle_id) query.set('vehicle_id', params.vehicle_id);
    if (params.search) query.set('search', params.search);
    if (params.date) query.set('date', params.date);
    return apiRequest<{ transactions: any[]; stats: any }>(`/fastag/transactions?${query.toString()}`);
  },
  getFastagTransaction: (id: number | string) => apiRequest<any>(`/fastag/transactions/${id}`),
  createFastagTransaction: (data: any) => apiRequest<{ message: string; transaction: any }>('/fastag/transactions', { method: 'POST', body: JSON.stringify(data) }),
  deleteFastagTransaction: (id: number | string) => apiRequest(`/fastag/transactions/${id}`, { method: 'DELETE' }),
  estimateFastagToll: (data: { lat: number; lng: number; plaza_name?: string }) => apiRequest<any>('/fastag/estimate', { method: 'POST', body: JSON.stringify(data) }),

  // Global Search across all entities
  search: (q: string) => apiRequest<{
    query: string;
    vehicles: any[];
    routes: any[];
    users: any[];
    pages: any[];
    total: number;
  }>(`/search?q=${encodeURIComponent(q)}`),

  // User Login History & Database Audit (Supabase Cloud Sync)
  getLoginHistory: (params: { status?: string; search?: string; limit?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.search) query.set('search', params.search);
    if (params.limit) query.set('limit', String(params.limit));
    return apiRequest<{
      stats: { totalLogins: number; successfulLogins: number; failedLogins: number; activeUsers: number };
      logins: any[];
    }>(`/auth/logins?${query.toString()}`);
  },

  // Vehicle & Route Corridor Allocations Flow
  getAllocationsFlow: (params: { status?: string; search?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.search) query.set('search', params.search);
    return apiRequest<any[]>(`/allocations?${query.toString()}`);
  },
  getMyAllocation: () => apiRequest<{ allocated: boolean; allocation?: any; message?: string }>('/allocations/my'),

  // Vehicle Multi-Trip Management
  getVehicleTrips: (vehicleId: number | string) => apiRequest<any[]>(`/vehicles/${vehicleId}/trips`),
  activateVehicleTrip: (routeId: number | string) => apiRequest<{ success: boolean; message: string }>(`/routes/${routeId}/activate`, { method: 'PUT' }),
  updateRouteOperationalStatus: (routeId: number | string, operational_status: string) =>
    apiRequest<{ success: boolean; operational_status: string }>(`/routes/${routeId}/operational-status`, {
      method: 'PUT',
      body: JSON.stringify({ operational_status })
    }),
  addVehicleTrip: (vehicleId: number | string, data: any) =>
    apiRequest<any>('/routes', {
      method: 'POST',
      body: JSON.stringify({ ...data, vehicle_id: vehicleId })
    })
};

