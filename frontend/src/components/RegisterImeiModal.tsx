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
  X,
  Server,
  Info,
  Play,
  Square,
  ShieldCheck,
  ExternalLink,
  ChevronRight
} from 'lucide-react';

interface RegisterImeiModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RegisterImeiModal: React.FC<RegisterImeiModalProps> = ({ isOpen, onClose }) => {
  const [devices, setDevices] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [serverInfo, setServerInfo] = useState<any>(null);

  // Form State
  const [imei, setImei] = useState('');
  const [deviceModel, setDeviceModel] = useState('Concox GT06N');
  const [registering, setRegistering] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
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
    if (isOpen) {
      fetchDevices();
      fetchServerInfo();
    }
  }, [isOpen]);

  // Clean up simulator on unmount
  useEffect(() => {
    return () => {
      if (simTimer) clearInterval(simTimer);
    };
  }, [simTimer]);

  if (!isOpen) return null;

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
      setSuccessMessage(null);
      setNewlyRegisteredCode(null);

      const res = await api.registerHardwareDevice({
        imei: clean,
        deviceModel
      });

      setSuccessMessage(`Device registered! 6-Digit Code: ${res.device.pairing_code}`);
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
      setSuccessMessage(`New code generated: ${res.device.pairing_code}`);
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
    let step = 0;

    const timer = setInterval(async () => {
      step++;
      // Move slightly eastward along highway
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

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center p-3 sm:p-5 bg-slate-900/70 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-150 cursor-pointer"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl max-w-4xl w-full p-5 sm:p-7 shadow-2xl border border-slate-100 relative animate-in zoom-in-95 duration-200 cursor-default my-auto max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 flex items-center justify-center font-bold shadow-xs">
              <Radio className="w-6 h-6 text-emerald-600 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                  Register Hardware GPS (IMEI Portal)
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide bg-emerald-50 text-emerald-700 border border-emerald-200">
                  TCP Port 5023 Active
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium">
                Register physical GPS trackers, generate 6-digit user pairing codes & manage hardware telemetry
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition cursor-pointer text-xs font-bold"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="py-4 space-y-6 overflow-y-auto flex-1 pr-1 text-xs">
          {/* Newly Generated Code Alert (Celebration Box) */}
          {newlyRegisteredCode && newlyRegisteredImei && (
            <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 shadow-sm animate-in slide-in-from-top-3">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 font-black text-emerald-900 text-sm">
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span>Device Registered Successfully!</span>
                  </div>
                  <p className="text-[11px] text-emerald-700">
                    Provide this <strong>IMEI</strong> and <strong>6-digit code</strong> to the user to link in their account:
                  </p>
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <span className="font-mono text-xs font-bold bg-white px-2.5 py-1 rounded-lg border border-emerald-200 text-slate-800">
                      IMEI: <strong>{newlyRegisteredImei}</strong>
                    </span>
                    <span className="font-mono text-sm font-black bg-emerald-600 text-white px-3 py-1 rounded-lg shadow-xs tracking-widest">
                      CODE: {newlyRegisteredCode}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => copyToClipboard(`IMEI: ${newlyRegisteredImei}\n6-Digit Code: ${newlyRegisteredCode}`, 'new')}
                  className="px-3.5 py-2 rounded-xl bg-white hover:bg-emerald-100/60 border border-emerald-300 text-emerald-800 font-bold text-xs flex items-center gap-1.5 transition shadow-2xs cursor-pointer shrink-0"
                >
                  {copiedCode === 'new' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedCode === 'new' ? 'Copied Details!' : 'Copy Code & IMEI'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Form: Register IMEI */}
          <div className="bg-slate-50/80 rounded-2xl p-4 sm:p-5 border border-slate-200/80">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5 text-slate-600" />
              <span>Register New IMEI Device</span>
            </h3>

            {errorMessage && (
              <div className="mb-3 p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-700 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handleRegister} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-5 space-y-1">
                <label className="text-[11px] font-bold text-slate-700">
                  IMEI Number *
                </label>
                <input
                  type="text"
                  value={imei}
                  onChange={(e) => setImei(e.target.value.replace(/[^0-9]/g, ''))}
                  maxLength={18}
                  placeholder="e.g. 864201041234567"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white font-mono text-xs font-semibold text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 transition"
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
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white font-semibold text-xs text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 transition cursor-pointer"
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
                  className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs transition shadow-sm cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <Radio className="w-3.5 h-3.5" />
                  <span>{registering ? 'Registering...' : 'Register IMEI'}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Registered Devices List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-2">
                <span>Registered Devices ({devices.length})</span>
                {loading && <RefreshCw className="w-3 h-3 text-slate-400 animate-spin" />}
              </h3>
              <button
                type="button"
                onClick={fetchDevices}
                className="text-[11px] font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1 transition"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Refresh List</span>
              </button>
            </div>

            {devices.length === 0 ? (
              <div className="p-8 text-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50">
                <Radio className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-xs font-bold text-slate-600">No hardware GPS devices registered yet.</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Register an IMEI above to generate a 6-digit pairing code for your users.
                </p>
              </div>
            ) : (
              <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                        <th className="py-2.5 px-3">IMEI Number</th>
                        <th className="py-2.5 px-3">Device Model</th>
                        <th className="py-2.5 px-3">Pairing Code (6 Digit)</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3">Linked User & Vehicle</th>
                        <th className="py-2.5 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {devices.map((dev) => {
                        const isSimulating = simulatingImei === dev.imei;
                        const isLinked = dev.status === 'LINKED';
                        return (
                          <tr key={dev.id} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-3 px-3 font-mono font-bold text-slate-900">
                              <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-ping"></span>
                                <span>{dev.imei}</span>
                              </div>
                            </td>
                            <td className="py-3 px-3 font-medium text-slate-700">
                              <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-semibold text-[11px] border border-slate-200">
                                {dev.device_model}
                              </span>
                            </td>
                            <td className="py-3 px-3">
                              <div className="flex items-center gap-1.5 font-mono">
                                <span className="bg-slate-900 text-emerald-400 px-2.5 py-0.5 rounded-lg text-xs font-black tracking-widest shadow-2xs">
                                  {dev.pairing_code}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => copyToClipboard(dev.pairing_code, dev.imei)}
                                  className="text-slate-400 hover:text-slate-700 p-1 rounded-md transition"
                                  title="Copy Code"
                                >
                                  {copiedCode === dev.imei ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </div>
                            </td>
                            <td className="py-3 px-3">
                              {isLinked ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-blue-50 text-blue-700 border border-blue-200">
                                  <ShieldCheck className="w-3 h-3 text-blue-600" />
                                  <span>LINKED</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-50 text-amber-700 border border-amber-200">
                                  <span>READY TO PAIR</span>
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-3">
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
                            <td className="py-3 px-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                {/* Simulation Button (for immediate testing without physical hardware) */}
                                <button
                                  type="button"
                                  onClick={() => toggleSimulation(dev.imei)}
                                  className={`px-2 py-1 rounded-lg text-[10px] font-extrabold flex items-center gap-1 transition cursor-pointer ${
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
                                    className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
                                    title="Regenerate 6-Digit Code"
                                  >
                                    <RefreshCw className="w-3.5 h-3.5" />
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() => handleDelete(dev.imei)}
                                  className="p-1.5 text-red-400 hover:text-red-700 hover:bg-red-50 rounded-lg transition"
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

          {/* Hardware Connection & IP Configuration Guide */}
          <div className="bg-slate-900 text-slate-100 rounded-2xl p-4 sm:p-5 space-y-3 shadow-lg">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-emerald-400" />
                <h4 className="font-black text-xs uppercase tracking-wider text-white">
                  Physical GPS Hardware Configuration Guide (IP & Port)
                </h4>
              </div>
              <span className="text-[10px] font-mono text-emerald-400 font-bold bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800">
                TCP PORT: {serverInfo?.tcpPort || 5023}
              </span>
            </div>

            <p className="text-[11px] text-slate-300 leading-relaxed">
              Configure your physical GPS tracker (Concox GT06N, V5, PT06, G206, etc.) using SMS commands sent to the tracker's SIM card:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px] font-mono">
              <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 space-y-1">
                <span className="text-slate-400 text-[10px] font-bold block uppercase">
                  1. Server IP & Port SMS Command:
                </span>
                <p className="text-emerald-400 font-bold">
                  SERVER,1,{serverInfo?.preferredLocalIp || '192.168.1.4'},{serverInfo?.tcpPort || 5023},0#
                </p>
                <span className="text-slate-500 text-[10px] block">
                  (Or replace with your public cloud IP/domain for 4G cellular SIM)
                </span>
              </div>

              <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 space-y-1">
                <span className="text-slate-400 text-[10px] font-bold block uppercase">
                  2. Upload Interval (Every 10 Seconds):
                </span>
                <p className="text-emerald-400 font-bold">
                  TIMER,10#
                </p>
                <span className="text-slate-500 text-[10px] block">
                  Tracker sends real-time GPS packet every 10 seconds.
                </span>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-800/60 border border-slate-700 text-[10px] text-slate-300 flex items-center gap-2">
              <Info className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                <strong>Testing in Local Dev:</strong> You can click the <strong>"Test Sim"</strong> button next to any registered IMEI to instantly simulate live moving vehicle GPS updates without physical hardware!
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition shadow-xs cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
