# GpsTrackX - Modern Vehicle Fleet & Google Maps Route Planning Platform

GpsTrackX is a completely new, independent, production-grade vehicle fleet management and manual Google Maps route planning platform built from scratch.

---

## 🚀 Key Features

### 1. 100% Excel-Free Manual Google Maps Route Planning (Admin Panel)
- **Start Point Selection**: Search box with presets or click directly on the interactive map to place a pin. Automatically captures Location Name, Latitude, Longitude, and Formatted Address.
- **End Point Selection**: Search box with presets or click directly on the map to pin destination.
- **Up to 5 Alternative Routes**: Automatically calculated using genuine road geometries with distinct color coding:
  - **Route 1 (Recommended)**: Light Red (`#EF4444`)
  - **Route 2 (Bypass)**: Blue (`#3B82F6`)
  - **Route 3 (Industrial Corridor)**: Purple (`#8B5CF6`)
  - **Route 4 (Ring Road)**: Emerald (`#10B981`)
  - **Route 5 (Valley Alternate)**: Amber (`#F59E0B`)
- **Route Comparison**: Interactive side-by-side comparison of Distance (KM), Travel Time (Hours & Mins), Stoppages, and Toll Plazas.
- **Stoppage Management**: Add multiple intermediate stops, reorder sequence (up/down), edit names, or remove stops. Routes and travel times recalculate dynamically!
- **Toll Gate Management**:
  - **Automatic Toll Detection**: Highway toll plazas identified along the route corridor with electronic FASTag fees.
  - **Manual Toll Gate Addition**: Click anywhere along the route to place a custom toll marker, assign custom plaza name, and enter charges.
- **Route Assignment**: Saves and binds the route to a specific vehicle and assigned user.

### 2. Vehicle Fleet Management
- **Add Vehicle**: Full registration with Registration Number, Model, Vehicle Type (Truck, Heavy Truck, Mini Truck, Pickup, Cargo, Trailer, Bus, Van, Car), GPS Device ID, IMEI Number, Chassis Number (VIN), Fuel Type, Speed Limit, Initial Status, and Driver/User assignment.
- **Edit & Delete**: Full Admin CRUD permissions.
- **Filtering & Search**: Search by plate/model/device ID/IMEI, filter by driver/user, vehicle type, and status (Active, Moving, Inactive).

### 3. Role-Based Access Control (RBAC)
- **Super Admin (`admin@gpstrackx.com` / `admin123`)**: Full control over fleet assets, user management, Google Maps route planning, toll management, and system settings.
- **Assigned Fleet Users (e.g. `rajesh@logistics.com` / `user123`, `priya@supplychain.in` / `user123`)**:
  - **Strictly VIEW-ONLY access**.
  - Users only see vehicles assigned to their specific account.
  - Can view real-time vehicle telematics, speed, status, and assigned route on Google Maps.
  - Cannot add, edit, or delete vehicles, routes, stoppages, or toll gates.

### 4. Real-time Live Fleet Telemetry Simulation
- Moving vehicles smoothly advance along their actual road coordinates every 15 seconds.
- Speed gauges display dynamic velocities (48–74 km/h) with over-speed limit checks.
- Interactive fleet map renders vehicle position markers with animated radar pulse rings.

### 5. UI/UX Design System
- **Theme**: Light Red and White (`#EF4444`, `#FFFFFF`, `#F8FAFC`).
- Minimal, clean SaaS dashboard with high-contrast typography, rounded cards, subtle shadows, and crisp map overlays.
- Zero dark theme clutter or unnecessary gradients.

---

## 🛠️ Tech Stack

- **Backend**: Node.js, Express, `better-sqlite3` (native high-speed SQLite), JWT Authentication, `bcryptjs`, and Google Maps Directions API proxy with road geometry engines.
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Lucide Icons, `@googlemaps/js-api-loader`, and Leaflet.
- **Database**: `fleet.db` SQLite database with relations for `users`, `vehicles`, `routes`, `stoppages`, `manual_toll_gates`, and `settings`.

---

## 🏃 How to Run GpsTrackX

### 1. Start the Backend Server (Serves API + Built Frontend on Port 5000)
```bash
cd backend
node server.js
```
The application will be live at: **http://localhost:5000**

### 2. Optional: Run Frontend in Development Mode with HMR
```bash
cd frontend
npm run dev
```
Frontend development server runs at: **http://localhost:5173** (proxies `/api` to port 5000).

---

## 🔑 Demo Accounts

| Role | Name | Email | Password | Permissions |
|---|---|---|---|---|
| **Super Admin** | Super Admin | `admin@gpstrackx.com` | `admin123` | **Full Access** (All vehicles, Route Planner, Users, Settings) |
| **Fleet User** | Rajesh Sharma | `rajesh@logistics.com` | `user123` | **View-Only** (Only sees assigned Tata Signa & BharatBenz) |
| **Fleet User** | Priya Nair | `priya@supplychain.in` | `user123` | **View-Only** (Only sees assigned Mahindra Bolero Pickup) |
| **Fleet User** | Amit Kumar | `amit.kumar@express.com` | `user123` | **View-Only** (Only sees assigned Ashok Leyland 2820) |
| **Fleet User** | Sunita Patel | `sunita@fleetops.com` | `user123` | **View-Only** (Only sees assigned Tata Ace Gold) |

*Tip: You can switch between any account with one click using the **Role Switcher** pill in the top header or on the login page!*

