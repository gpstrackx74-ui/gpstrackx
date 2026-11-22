import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import {
  Radio,
  Cpu,
  Check,
  Copy,
  Trash2,
  RefreshCw,
  AlertCircle,
  Server,
  Info,
  Play,
  Square,
  ShieldCheck,
  Search
} from 'lucide-react';

export const RegisterImeiPage: React.FC = () => {
  const [devices, setDevices] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [serverInfo, setServerInfo] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Form State
  const [imei, setImei] = useState('');
  const [deviceModel, setDeviceModel] = useState('Concox GT06N');
  const [registering, setRegistering] = useState(false);
  const [newlyRegisteredCode, setNewlyRegisteredCode] = useState<string | null>(null);
  const [newlyRegisteredImei, setNewlyRegisteredImei] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Simulation State
  const [simulatingImei, setSimulatingImei] = useState<string | null>(null);
  const [simTimer, setSimTimer] = useState<any>(null);

  const GPS_MODELS = [
    { id: 'Concox GT06N', name: 'Concox GT06N', protocol: 'GT06 (Port 5023)' },
    { id: 'V5 GPS Tracker', name: 'V5 GPS Tracker', protocol: 'GT06 / V5 (Port 5023)' },
    { id: 'PT06 GPS Tracker', name: 'PT06 GPS Tracker', protocol: 'GT06 / PT06 (Port 5023)' },
    { id: 'G206 Mini GPS', name: 'G206 / G19 Mini GPS', protocol: 'GT06 (Port 5023)' },
    { id: 'Concox WeTrack2 / ET200', name: 'Concox WeTrack2 / ET200', protocol: 'GT06 (Port 5023)' },
    { id: 'Coban TK103 / TK102', name: 'Coban TK103 / TK102', protocol: 'TK103 (Port 5002)' },
    { id: 'Teltonika FMB920', name: 'Teltonika FMB920', protocol: 'Teltonika (Port 5027)' },
    { id: 'Sinotrack ST-901', name: 'Sinotrack ST-901', protocol: 'H02 (Port 5013)' },
    { id: 'Generic GT06 Compatible', name: 'Generic / Other GT06 Tracker', protocol: 'GT06 (Port 5023)' }
  ];

  const fetchDevices = async () => {
    try {
      setLoading(true);
      const data = await api.getHardwareDevices();
      setDevices(data || []);
    } catch (err: any) {
      console.error('Failed to fetch devices:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchServerInfo = async () => {
    try {
      const data = await api.getHardwareServerInfo();
      setServerInfo(data);
    } catch (err) {
      console.warn('Could not fetch server info:', err);
    }
  };

  useEffect(() => {
    fetchDevices();
    fetchServerInfo();
  }, []);

  // Clean up simulator on unmount
  useEffect(() => {
    return () => {
      if (simTimer) clearInterval(simTimer);
    };
  }, [simTimer]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = imei.trim();
    if (!clean) {
      setErrorMessage('Please enter an IMEI number.');
      return;
    }
    if (!/^\d{10,18}$/.test(clean)) {
      setErrorMessage('IMEI must be between 10 and 18 numeric digits.');
      return;
    }

    try {
      setRegistering(true);
      setErrorMessage(null);
      setNewlyRegisteredCode(null);

      const res = await api.registerHardwareDevice({
        imei: clean,
        deviceModel
      });

      setNewlyRegisteredCode(res.device.pairing_code);
      setNewlyRegisteredImei(res.device.imei);
      setImei('');
      await fetchDevices();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to register device.');
    } finally {
      setRegistering(false);
    }
  };

  const handleDelete = async (devImei: string) => {
    if (!window.confirm(`Are you sure you want to remove IMEI ${devImei}?`)) return;
    try {
      await api.deleteHardwareDevice(devImei);
      if (simulatingImei === devImei) {
        clearInterval(simTimer);
        setSimulatingImei(null);
      }
      await fetchDevices();
    } catch (err: any) {
      alert(err.message || 'Failed to delete device');
    }
  };

  const handleRegenerate = async (devImei: string) => {
    try {
      const res = await api.regenerateHardwareCode(devImei);
      setNewlyRegisteredCode(res.device.pairing_code);
      setNewlyRegisteredImei(res.device.imei);
      await fetchDevices();
    } catch (err: any) {
      alert(err.message || 'Failed to regenerate code');
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2500);
  };

  // Toggle Live Simulation (Testing Tool)
  const toggleSimulation = (devImei: string) => {
    if (simulatingImei === devImei) {
      clearInterval(simTimer);
      setSimTimer(null);
      setSimulatingImei(null);
      return;
    }

    if (simTimer) clearInterval(simTimer);

    setSimulatingImei(devImei);
    let lat = 21.2514;
    let lng = 81.6296;

    const timer = setInterval(async () => {
      lat += (Math.random() - 0.48) * 0.002;
      lng += 0.003;
      const speed = Math.floor(45 + Math.random() * 25);

      try {
        await api.simulateHardwareTelemetry({
          imei: devImei,
          latitude: Number(lat.toFixed(6)),
          longitude: Number(lng.toFixed(6)),
          speed,
          heading: 85,
          ignition: 1
        });
        fetchDevices();
      } catch (e) {
        console.warn('Simulation tick failed:', e);
      }
    }, 4000);

    setSimTimer(timer);
  };

  const filteredDevices = devices.filter((dev) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      dev.imei?.toLowerCase().includes(q) ||
      dev.device_model?.toLowerCase().includes(q) ||
      dev.pairing_code?.toLowerCase().includes(q) ||
      dev.vehicle_number?.toLowerCase().includes(q) ||
      dev.vehicle_name?.toLowerCase().includes(q) ||
      dev.status?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-4 sm:p-6 lg:p-7 max-w-6xl mx-auto space-y-5 w-full min-w-0 font-sans">
      {/* Main Enterprise Container */}
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-xs overflow-hidden">
        {/* Section 1: Header */}
        <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 flex items-center justify-center font-bold shadow-2xs shrink-0">
              <Radio className="w-6 h-6 text-emerald-600 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black text-slate-900 tracking-tight">
                  Register IMEI & GPS Hardware
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                  TCP Port 5023 Active
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                Register physical GPS trackers, generate secure 6-digit user pairing codes, and monitor real-time hardware telemetry.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              type="button"
              onClick={fetchDevices}
              className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs flex items-center gap-1.5 transition shadow-2xs cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh List</span>
            </button>
          </div>
        </div>

        {/* Thin divider */}
        <div className="border-t border-[#E60012]/10" />

        {/* Newly Generated Code Alert Box */}
        {newlyRegisteredCode && newlyRegisteredImei && (
          <div className="p-5 bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-emerald-200 animate-in slide-in-from-top-2">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 font-black text-emerald-900 text-sm">
                  <Check className="w-4 h-4 text-emerald-600" />
                  <span>Device Registered Successfully!</span>
                </div>
                <p className="text-xs text-emerald-700">
                  Share this <strong>IMEI</strong> and <strong>6-digit security code</strong> with your user to link in their account:
                </p>
                <div className="flex flex-wrap items-center gap-3 pt-1.5">
                  <span className="font-mono text-xs font-bold bg-white px-3 py-1 rounded-xl border border-emerald-200 text-slate-900 shadow-2xs">
                    IMEI: <strong>{newlyRegisteredImei}</strong>
                  </span>
                  <span className="font-mono text-sm font-black bg-emerald-600 text-white px-3.5 py-1 rounded-xl shadow-xs tracking-widest">
                    CODE: {newlyRegisteredCode}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => copyToClipboard(`IMEI: ${newlyRegisteredImei}\n6-Digit Code: ${newlyRegisteredCode}`, 'new')}
                className="px-4 py-2.5 rounded-xl bg-white hover:bg-emerald-100/60 border border-emerald-300 text-emerald-800 font-bold text-xs flex items-center gap-1.5 transition shadow-2xs cursor-pointer shrink-0"
              >
                {copiedCode === 'new' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                <span>{copiedCode === 'new' ? 'Copied Details!' : 'Copy Code & IMEI'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Section 2: Registration Form */}
        <div className="p-5 sm:p-6 bg-slate-50/50 border-b border-slate-100">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-700 mb-3.5 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-slate-600" />
            <span>Register New Hardware Tracker</span>
          </h2>

          {errorMessage && (
            <div className="mb-3.5 p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleRegister} className="grid grid-cols-1 sm:grid-cols-12 gap-3.5 items-end">
            <div className="sm:col-span-5 space-y-1">
              <label className="text-[11px] font-bold text-slate-700">
                IMEI Number (15 Digits) *
              </label>
              <input
                type="text"
                value={imei}
                onChange={(e) => setImei(e.target.value.replace(/[^0-9]/g, ''))}
                maxLength={18}
                placeholder="e.g. 864201041234567"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white font-mono text-xs font-semibold text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 transition shadow-2xs"
                required
              />
            </div>

            <div className="sm:col-span-4 space-y-1">
              <label className="text-[11px] font-bold text-slate-700">
                GPS Model / Protocol *
              </label>
              <select
                value={deviceModel}
                onChange={(e) => setDeviceModel(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white font-semibold text-xs text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 transition cursor-pointer shadow-2xs"
              >
                {GPS_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.protocol})
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-3">
              <button
                type="submit"
                disabled={registering}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs transition shadow-xs cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <Radio className="w-3.5 h-3.5" />
                <span>{registering ? 'Registering...' : 'Register IMEI'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Section 3: Registered Devices List */}
        <div className="p-5 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-2">
              <span>Registered Devices ({filteredDevices.length})</span>
            </h2>

            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search IMEI, model, vehicle..."
                className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-900 focus:outline-none focus:border-emerald-500 focus:bg-white transition"
              />
            </div>
          </div>

          {filteredDevices.length === 0 ? (
            <div className="p-12 text-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50">
              <Radio className="w-9 h-9 text-slate-300 mx-auto mb-2" />
              <p className="text-xs font-bold text-slate-700">No hardware GPS devices found.</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {searchQuery ? 'Try matching another search term.' : 'Enter an IMEI number in the form above to register your first device.'}
              </p>
            </div>
          ) : (
            <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                      <th className="py-3 px-4">IMEI Number</th>
                      <th className="py-3 px-4">Device Model</th>
                      <th className="py-3 px-4">Pairing Code (6 Digit)</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Linked User & Vehicle</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {filteredDevices.map((dev) => {
                      const isSimulating = simulatingImei === dev.imei;
                      const isLinked = dev.status === 'LINKED';
                      return (
                        <tr key={dev.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-ping"></span>
                              <span>{dev.imei}</span>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 font-medium text-slate-700">
                            <span className="px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-700 font-semibold text-[11px] border border-slate-200">
                              {dev.device_model}
                            </span>
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-2 font-mono">
                              <span className="bg-slate-900 text-emerald-400 px-3 py-1 rounded-lg text-xs font-black tracking-widest shadow-2xs">
                                {dev.pairing_code}
                              </span>
                              <button
                                type="button"
                                onClick={() => copyToClipboard(dev.pairing_code, dev.imei)}
                                className="text-slate-400 hover:text-slate-700 p-1 rounded-md transition"
                                title="Copy Code"
                              >
                                {copiedCode === dev.imei ? (
                                  <Check className="w-4 h-4 text-emerald-600" />
                                ) : (
                                  <Copy className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          </td>
                          <td className="py-3.5 px-4">
                            {isLinked ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black bg-blue-50 text-blue-700 border border-blue-200">
                                <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                                <span>LINKED</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black bg-amber-50 text-amber-700 border border-amber-200">
                                <span>READY TO PAIR</span>
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4">
                            {isLinked ? (
                              <div className="space-y-0.5">
                                <div className="font-bold text-slate-900">
                                  {dev.vehicle_number} <span className="text-slate-400 font-normal">({dev.vehicle_name})</span>
                                </div>
                                <div className="text-[10px] text-slate-500 font-mono">
                                  User: {dev.assigned_user_name || dev.assigned_user_email || `ID ${dev.assigned_user_id}`}
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-400 italic text-[11px]">Not linked yet</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {/* Simulation Button */}
                              <button
                                type="button"
                                onClick={() => toggleSimulation(dev.imei)}
                                className={`px-2.5 py-1.5 rounded-xl text-[10px] font-extrabold flex items-center gap-1 transition cursor-pointer ${
                                  isSimulating
                                    ? 'bg-amber-500 text-white animate-pulse'
                                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                                }`}
                                title={isSimulating ? 'Stop Test Simulation' : 'Start Test Live Telemetry Simulation'}
                              >
                                {isSimulating ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                                <span>{isSimulating ? 'Simulating...' : 'Test Sim'}</span>
                              </button>

                              {!isLinked && (
                                <button
                                  type="button"
                                  onClick={() => handleRegenerate(dev.imei)}
                                  className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                                  title="Regenerate 6-Digit Code"
                                >
                                  <RefreshCw className="w-3.5 h-3.5" />
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => handleDelete(dev.imei)}
                                className="p-2 text-red-400 hover:text-red-700 hover:bg-red-50 rounded-xl transition cursor-pointer"
                                title="Delete Device"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Section 4: Hardware Connection & IP Configuration Guide */}
        <div className="p-5 sm:p-6 bg-slate-900 text-slate-100 space-y-3.5 border-t border-slate-800">
          <div className="flex items-center justify-between pb-2.5 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-emerald-400" />
              <h3 className="font-black text-xs uppercase tracking-wider text-white">
                Physical GPS Hardware Configuration Guide (IP & Port)
              </h3>
            </div>
            <span className="text-[10px] font-mono text-emerald-400 font-bold bg-emerald-950/80 px-2.5 py-0.5 rounded-lg border border-emerald-800">
              TCP PORT: {serverInfo?.tcpPort || 5023}
            </span>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed">
            Configure your physical GPS tracker (Concox GT06N, V5, PT06, G206, etc.) using SMS commands sent to the tracker's SIM card:
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
            <div className="p-3.5 bg-slate-950/80 rounded-2xl border border-slate-800 space-y-1">
              <span className="text-slate-400 text-[10px] font-bold block uppercase">
                1. Server IP & Port SMS Command:
              </span>
              <p className="text-emerald-400 font-bold text-xs">
                SERVER,1,34.93.96.170,{serverInfo?.tcpPort || 5023},0#
              </p>
              <span className="text-slate-500 text-[10px] block">
                Points tracker directly to your Google Cloud live server.
              </span>
            </div>

            <div className="p-3.5 bg-slate-950/80 rounded-2xl border border-slate-800 space-y-1">
              <span className="text-slate-400 text-[10px] font-bold block uppercase">
                2. Upload Interval (Every 10 Seconds):
              </span>
              <p className="text-emerald-400 font-bold text-xs">
                TIMER,10#
              </p>
              <span className="text-slate-500 text-[10px] block">
                Tracker sends real-time GPS packet every 10 seconds.
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700 text-xs text-slate-300 flex items-center gap-2">
            <Info className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              <strong>Testing in Live Environment:</strong> You can click the <strong>"Test Sim"</strong> button next to any registered IMEI to instantly simulate live moving vehicle GPS updates on the map without needing physical hardware!
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
