export interface User {
  id: number;
  name: string;
  email: string;
  phone?: string;
  company_name?: string;
  companyName?: string;
  role: 'admin' | 'user';
  status: 'active' | 'inactive';
  avatar_color?: string;
  avatarColor?: string;
  vehicle_count?: number;
  trip_count?: number;
  assigned_vehicles?: Array<{ id: number; registration_no: string }>;
  assigned_reg_nos?: string;
  created_at?: string;
}

export interface Vehicle {
  id: number;
  registration_no: string;
  name_model: string;
  vehicle_type: string;
  device_id: string;
  imei_number: string;
  chassis_number: string;
  fuel_type: string;
  assigned_user_id: number | null;
  status: 'active' | 'inactive' | 'moving' | 'stopped' | 'stop' | 'parking' | 'service';
  operational_status?: string;
  location?: string;
  current_speed: number;
  max_speed_limit: number;
  current_lat: number;
  current_lng: number;
  odometer_km: number;
  axle_type?: string;
  created_at: string;
  updated_at: string;
  owner_name?: string;
  owner_email?: string;
  owner_phone?: string;
  route_id?: number | null;
  route_name?: string;
  start_location_name?: string;
  end_location_name?: string;
  total_distance_km?: number;
  estimated_travel_time_min?: number;
  route_color?: string;
}

export interface Stoppage {
  id?: number;
  sequence_order: number;
  name: string;
  address?: string;
  lat: number;
  lng: number;
  duration?: number;
  stop_duration_mins?: number;
}

export interface TollGate {
  id?: number;
  name: string;
  lat: number;
  lng: number;
  charges: number;
  is_manual: boolean;
  verified?: boolean;
  toll_type?: string;
  highway?: string;
}

export interface AlternativeRoute {
  id: string;
  name: string;
  distanceKm: number;
  timeMinutes: number;
  tollGatesCount: number;
  stopsCount: number;
  summary: string;
  color: string;
  coordinates: [number, number][];
  tollGates?: TollGate[];
  source?: string;
}

export interface RouteDetail {
  id: number;
  vehicle_id: number;
  route_name: string;
  start_location_name: string;
  start_address: string;
  start_lat: number;
  start_lng: number;
  end_location_name: string;
  end_address: string;
  end_lat: number;
  end_lng: number;
  total_distance_km: number;
  estimated_travel_time_min: number;
  overview_polyline: string;
  route_color: string;
  waypoints_json: string;
  toll_gates_json: string;
  alternative_routes_json: string;
  trip_date?: string;
  end_trip_date?: string;
  start_trip_time?: string;
  end_trip_time?: string;
  is_active: number;
  operational_status?: string;
  created_at: string;
}

export interface DashboardStats {
  totalVehicles: number;
  activeVehicles: number;
  inactiveVehicles: number;
  movingVehicles: number;
  avgSpeed: number;
  totalUsers: number;
  totalRoutes: number;
}

export interface FastagTransaction {
  id: number;
  transaction_id: string;
  netc_reference_no: string;
  tag_id: string;
  vehicle_id: number;
  vehicle_registration_no: string;
  vehicle_class: string;
  route_id?: number | null;
  toll_plaza_name: string;
  highway_name?: string;
  lat: number;
  lng: number;
  amount: number;
  base_toll_fee: number;
  gst_amount: number;
  concessionaire_name: string;
  gstin: string;
  lane_direction: string;
  payment_status: 'SUCCESS' | 'PENDING' | 'FAILED';
  crossing_time: string;
  wallet_balance_before: number;
  wallet_balance_after: number;
  created_at: string;
  vehicle_model?: string;
  vehicle_type?: string;
  driver_name?: string;
  driver_phone?: string;
}

export interface FastagStats {
  totalSpent: number;
  totalTolls: number;
  uniqueVehicles: number;
  activeWalletBalance: number;
}


