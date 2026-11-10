import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Vehicle, FastagTransaction, FastagStats } from '../types';
import { DMYDateInput } from '../components/DMYDateInput';
import { AUTHORIZED_SIGNATURE_BASE64 } from '../assets/signatureBase64';
import {
  Receipt,
  Truck,
  MapPin,
  Calendar,
  Clock,
  Search,
  Plus,
  Download,
  Printer,
  X,
  CheckCircle2,
  ExternalLink,
  Copy,
  Check,
  ShieldCheck,
  RefreshCw,
  CreditCard,
  Building2,
  FileText,
  AlertCircle,
  Loader2
} from 'lucide-react';

export const FastagBilling: React.FC = () => {
  const { isAdmin } = useAuth();
  const [transactions, setTransactions] = useState<FastagTransaction[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [stats, setStats] = useState<FastagStats>({
    totalSpent: 0,
    totalTolls: 0,
    uniqueVehicles: 0,
    activeWalletBalance: 18450.0
  });
  const [loading, setLoading] = useState(true);
  const [selectedTxForInvoice, setSelectedTxForInvoice] = useState<FastagTransaction | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  // Filters
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState('');

  // Form State for Add Manual Toll Bill
  const [formVehicleId, setFormVehicleId] = useState<string>('');
  const [formPlazaName, setFormPlazaName] = useState('');
  const [formHighway, setFormHighway] = useState('');
  const [formLat, setFormLat] = useState('21.6241');
  const [formLng, setFormLng] = useState('81.6983');
  const [formAmount, setFormAmount] = useState('340');
  const [formDate, setFormDate] = useState(new Date().toISOString().split('T')[0]);
  const [formTime, setFormTime] = useState('10:30');
  const [formLane, setFormLane] = useState('Lane 04 - Heavy Commercial Truck (FASTag ETC)');
  const [isEstimating, setIsEstimating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Load Vehicles & Transactions
  const fetchAllData = async () => {
    try {
      setLoading(true);
      const [txRes, vehRes] = await Promise.all([
        api.getFastagTransactions({
          vehicle_id: selectedVehicleId !== 'all' ? selectedVehicleId : undefined,
          search: searchQuery.trim() || undefined,
          date: selectedDate || undefined
        }),
        api.getVehicles()
      ]);

      setTransactions(txRes.transactions || []);
      if (txRes.stats) {
        setStats(txRes.stats);
      }
      setVehicles(vehRes || []);
      if (!formVehicleId && vehRes && vehRes.length > 0) {
        setFormVehicleId(String(vehRes[0].id));
      }
    } catch (err) {
      console.error('Failed to load FASTag data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, [selectedVehicleId, selectedDate]);

  // Debounced Search filter
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchAllData();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Auto-estimate tariff when plaza or coordinates change in modal
  const handleAutoEstimate = async () => {
    if (!formLat || !formLng) return;
    try {
      setIsEstimating(true);
      const res = await api.estimateFastagToll({
        lat: parseFloat(formLat),
        lng: parseFloat(formLng),
        plaza_name: formPlazaName
      });
      if (res) {
        setFormAmount(String(res.truckRate || 340));
        if (res.highway && !formHighway) setFormHighway(res.highway);
        if (res.officialName && !formPlazaName) setFormPlazaName(res.officialName);
      }
    } catch (err) {
      console.error('Estimate error:', err);
    } finally {
      setIsEstimating(false);
    }
  };

  // Submit Manual FASTag Toll Bill
  const handleCreateManualBill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formVehicleId || !formPlazaName || !formLat || !formLng || !formAmount) {
      setFormError('Please fill in all required fields (Vehicle, Plaza Name, Coordinates & Amount).');
      return;
    }

    try {
      setIsSubmitting(true);
      setFormError(null);

      const crossingTime = `${formDate} ${formTime}:00`;
      const res = await api.createFastagTransaction({
        vehicle_id: parseInt(formVehicleId),
        toll_plaza_name: formPlazaName,
        highway_name: formHighway,
        lat: parseFloat(formLat),
        lng: parseFloat(formLng),
        amount: parseFloat(formAmount),
        crossing_time: crossingTime,
        lane_direction: formLane
      });

      setIsAddModalOpen(false);
      await fetchAllData();
      if (res.transaction) {
        setSelectedTxForInvoice(res.transaction);
      }
    } catch (err: any) {
      setFormError(err.message || 'Failed to generate FASTag bill');
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handlePrintInvoice = () => {
    window.print();
  };

  // Direct 2-Page Official ICICI Bank FASTag Statement PDF Generator
  const handleDownloadPDF = async () => {
    if (!selectedTxForInvoice) return;
    try {
      setIsDownloadingPdf(true);
      const html2canvas = (await import('html2canvas')).default;
      const { jsPDF } = await import('jspdf');

      const p1 = document.getElementById('icici-fastag-page-1');
      const p2 = document.getElementById('icici-fastag-page-2');

      if (!p1) {
        window.print();
        return;
      }

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      // Capture Page 1
      const canvas1 = await html2canvas(p1, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
      });
      const imgData1 = canvas1.toDataURL('image/png');
      pdf.addImage(imgData1, 'PNG', 0, 0, 210, 297);

      // Capture Page 2 if present
      if (p2) {
        pdf.addPage();
        const canvas2 = await html2canvas(p2, {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff'
        });
        const imgData2 = canvas2.toDataURL('image/png');
        pdf.addImage(imgData2, 'PNG', 0, 0, 210, 297);
      }

      const reg = selectedTxForInvoice.vehicle_registration_no?.replace(/[^A-Z0-9]/g, '') || 'VEH';
      pdf.save(`ICICI_Bank_FASTag_Statement_${reg}.pdf`);
    } catch (err) {
      console.error('PDF export error:', err);
      window.print();
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-7 max-w-7xl mx-auto space-y-4 font-sans">
      {/* ONE LARGE UNIFIED MAIN CONTAINER (ALL-IN-ONE ENTERPRISE LAYOUT) */}
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-xs overflow-hidden">
        {/* Section 1: Page Header */}
        <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-[#F1F5F9] text-[#0F172A] flex items-center justify-center border border-emerald-100 shadow-2xs">
                <Receipt className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                  FASTag Tolls & Invoices
                  <span className="text-[10px] font-bold text-[#0F172A] bg-[#F1F5F9] px-2.5 py-0.5 rounded-full border border-emerald-200">
                    NPCI NETC LIVE
                  </span>
                </h2>
                <p className="text-xs text-slate-500 font-medium">
                  National Highway & Expressway Commercial Truck Electronic Toll Collection Bills
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={fetchAllData}
              className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition shadow-2xs cursor-pointer"
              title="Refresh Transactions"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-[#0F172A]' : ''}`} />
            </button>

            {isAdmin && (
              <button
                type="button"
                onClick={() => setIsAddModalOpen(true)}
                className="px-4 py-2.5 rounded-xl bg-[#E60012] hover:bg-[#CC0010] text-white font-bold text-xs flex items-center gap-2 transition shadow-xs cursor-pointer"
              >
                <Plus className="w-4 h-4 text-emerald-200" />
                <span>+ Add FASTag Toll Bill</span>
              </button>
            )}
          </div>
        </div>

        {/* Thin divider with light red 10% opacity */}
        <div className="border-t border-[#E60012]/10" />

        {/* Section 2: Top 4 KPI Metrics (Inside Unified Container) */}
        <div className="p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {/* 1. Total FASTag Spent */}
          <div className="p-4 rounded-2xl bg-slate-50/70 border border-slate-100 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Total Fleet Tolls Paid
              </span>
              <div className="text-2xl font-black text-slate-900 font-mono mt-1 tracking-tight">
                ₹{stats.totalSpent.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <p className="text-[11px] font-medium text-slate-500 mt-0.5">
                Across {stats.totalTolls} toll debits
              </p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-slate-100 text-[#0F172A] flex items-center justify-center border border-slate-200 shrink-0">
              <Receipt className="w-6 h-6" />
            </div>
          </div>

          {/* 2. Tolls Crossed */}
          <div className="p-4 rounded-2xl bg-slate-50/70 border border-slate-100 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Plazas Cleared
              </span>
              <div className="text-2xl font-black text-emerald-600 font-mono mt-1 tracking-tight">
                {stats.totalTolls}
              </div>
              <p className="text-[11px] font-medium text-emerald-600/80 mt-0.5">
                100% Automatic RFID Clearance
              </p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100 shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
          </div>

          {/* 3. FASTag Fleet Wallet Balance */}
          <div className="p-4 rounded-2xl bg-slate-50/70 border border-slate-100 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Prepaid Wallet Balance
              </span>
              <div className="text-2xl font-black text-blue-600 font-mono mt-1 tracking-tight">
                ₹{stats.activeWalletBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <p className="text-[11px] font-medium text-slate-500 mt-0.5">
                Active FASTag linked
              </p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100 shrink-0">
              <CreditCard className="w-6 h-6" />
            </div>
          </div>

          {/* 4. Active Commercial Vehicles */}
          <div className="p-4 rounded-2xl bg-slate-50/70 border border-slate-100 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Registered Trucks
              </span>
              <div className="text-2xl font-black text-slate-800 font-mono mt-1 tracking-tight">
                {stats.uniqueVehicles || vehicles.length}
              </div>
              <p className="text-[11px] font-medium text-slate-500 mt-0.5">
                Commercial Class 4 & 5 Tags
              </p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center border border-slate-200 shrink-0">
              <Truck className="w-6 h-6" />
            </div>
          </div>
        </div>

        {/* Thin divider with light red 10% opacity */}
        <div className="border-t border-[#E60012]/10" />

        {/* Section 3: Filter & Search Bar */}
        <div className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50/40">
          <div className="flex flex-wrap items-center gap-3 flex-1">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[240px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Toll Plaza, Highway, TXN ID, or Truck Plate..."
                className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:border-slate-400 transition"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Vehicle Dropdown Filter */}
            <div className="flex items-center gap-1.5 bg-white px-3 py-2 rounded-xl border border-slate-200 text-xs">
              <Truck className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <select
                value={selectedVehicleId}
                onChange={(e) => setSelectedVehicleId(e.target.value)}
                className="bg-transparent text-xs font-bold text-slate-800 focus:outline-none cursor-pointer"
              >
                <option value="all">All Fleet Trucks ({vehicles.length})</option>
                {vehicles.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.registration_no} • {v.name_model}
                  </option>
                ))}
              </select>
            </div>

            {/* Date Filter (Strict DD/MM/YYYY Format) */}
            <div className="flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-xl border border-slate-200 text-xs shadow-2xs">
              <Calendar className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <DMYDateInput
                value={selectedDate}
                onChange={(iso) => setSelectedDate(iso)}
                className="bg-transparent"
              />
              {selectedDate && (
                <button
                  type="button"
                  onClick={() => setSelectedDate('')}
                  className="text-slate-400 hover:text-slate-600 ml-1 p-0.5"
                  title="Clear date"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          <div className="text-right text-[11px] font-bold text-slate-400 font-mono">
            Showing {transactions.length} Transactions
          </div>
        </div>

        {/* Thin divider with light red 10% opacity */}
        <div className="border-t border-[#E60012]/10" />

        {/* Section 4: Transactions Table & Toll Bills List */}
        <div>
          <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-900">
                Electronic Toll Clearance & Tax Invoice Records
              </h3>
            </div>
            <span className="text-[10px] font-mono text-slate-400">
              NHAI FASTag NETC Clearing Format
            </span>
          </div>

          {transactions.length === 0 ? (
            <div className="p-12 text-center text-slate-400 space-y-2">
              <Receipt className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-xs font-bold text-slate-600">No FASTag toll transactions found.</p>
              <p className="text-[11px] text-slate-400">
                {isAdmin ? 'Plan a route with tolls in Route Planner or click "+ Add FASTag Toll Bill" above.' : 'No toll transactions recorded for your vehicle yet.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  <tr>
                    <th className="py-3 px-4">Toll Plaza & Highway</th>
                    <th className="py-3 px-4">GPS Coordinates</th>
                    <th className="py-3 px-4">Vehicle / User</th>
                    <th className="py-3 px-4">Transaction ID & NETC Ref</th>
                    <th className="py-3 px-4">Crossing Time</th>
                    <th className="py-3 px-4 text-right">Truck Tariff (₹)</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-center">Tax Invoice</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                  {transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-50/70 transition">
                      {/* Toll Plaza Name & Highway */}
                      <td className="py-3.5 px-4 min-w-[200px]">
                        <div className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{tx.toll_plaza_name}</span>
                        </div>
                        <p className="text-[10px] text-slate-400 font-medium mt-0.5 truncate max-w-[230px]" title={tx.highway_name || ''}>
                          {tx.highway_name || 'National Highway Expressway'}
                        </p>
                      </td>

                      {/* Coordinates */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <a
                          href={`https://www.google.com/maps?q=${tx.lat},${tx.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-mono font-semibold transition"
                          title="View location on Google Maps"
                        >
                          <MapPin className="w-3 h-3 text-red-500 shrink-0" />
                          <span>{Number(tx.lat).toFixed(4)}, {Number(tx.lng).toFixed(4)}</span>
                          <ExternalLink className="w-2.5 h-2.5 text-slate-400" />
                        </a>
                      </td>

                      {/* Vehicle */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Truck className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <span className="font-mono font-black text-slate-900 text-xs">
                            {tx.vehicle_registration_no}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                          {tx.vehicle_model || tx.vehicle_class || 'Commercial Truck'}
                        </p>
                      </td>

                      {/* Transaction ID & NETC */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1 font-mono text-[11px] font-bold text-slate-800">
                          <span>{tx.transaction_id}</span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(tx.transaction_id, `txn-${tx.id}`)}
                            className="text-slate-400 hover:text-slate-700 p-0.5 cursor-pointer"
                            title="Copy Transaction ID"
                          >
                            {copiedId === `txn-${tx.id}` ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                        <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                          Ref: {tx.netc_reference_no}
                        </p>
                      </td>

                      {/* Crossing Time */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1 text-[11px] text-slate-800 font-medium">
                          <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>{tx.crossing_time}</span>
                        </div>
                        <span className="text-[9px] text-slate-400 uppercase font-mono block mt-0.5">
                          {tx.lane_direction || 'Lane 04'}
                        </span>
                      </td>

                      {/* Truck Tariff */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="text-sm font-black text-slate-900 font-mono">
                          ₹{Number(tx.amount).toFixed(2)}
                        </div>
                        <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded-full border border-emerald-200">
                          Exempt GST (NHAI)
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>PAID</span>
                        </span>
                      </td>

                      {/* Tax Invoice View */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setSelectedTxForInvoice(tx)}
                          className="px-3 py-1.5 rounded-xl bg-[#E60012] hover:bg-[#CC0010] text-white text-[11px] font-bold flex items-center justify-center gap-1.5 transition shadow-2xs mx-auto cursor-pointer"
                        >
                          <FileText className="w-3.5 h-3.5 text-emerald-200" />
                          <span>View Bill</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ============================================================== */}
      {/* 100% REPLICA ICICI BANK FASTag E-STATEMENT MODAL (2 PAGES)     */}
      {/* Exactly matching User Images 1 & 2                             */}
      {/* ============================================================== */}
      {selectedTxForInvoice && (() => {
        const plate = selectedTxForInvoice.vehicle_registration_no || 'KL10AL5697';
        const tagAcc = selectedTxForInvoice.tag_id?.slice(-8) || '27358917';
        const refNo = `100222/${selectedTxForInvoice.id ? String(184100 + selectedTxForInvoice.id) : '184102'}/84`;
        const customerId = selectedTxForInvoice.id ? String(16469000 + selectedTxForInvoice.id) : '16469495';
        const amount = Number(selectedTxForInvoice.amount) || 80.0;
        const openingBal = selectedTxForInvoice.wallet_balance_before || (amount + 305.0);
        const closingBal = openingBal - amount;

        let datePart = '24-01-2022';
        let timePart = '07:00:09';
        if (selectedTxForInvoice.crossing_time) {
          const parts = selectedTxForInvoice.crossing_time.split(' ');
          if (parts[0]) {
            const dp = parts[0].split('-');
            if (dp.length === 3) datePart = `${dp[2]}-${dp[1]}-${dp[0]}`;
          }
          if (parts[1]) timePart = parts[1];
        }

        const laneNum = selectedTxForInvoice.lane_direction?.replace(/[^0-9]/g, '').slice(0, 2) || '03';
        const plazaStr = selectedTxForInvoice.toll_plaza_name || 'Paliyekkara Toll plaza';
        const txnIdStr = selectedTxForInvoice.transaction_id && selectedTxForInvoice.transaction_id.length > 8
          ? selectedTxForInvoice.transaction_id
          : '0010012201240701279180 / 1390415023';

        return (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/80 backdrop-blur-xs p-2 sm:p-4 md:p-6 flex justify-center items-start">
            <div className="bg-white rounded-3xl shadow-2xl border border-slate-200/90 max-w-4xl w-full my-3 sm:my-6 overflow-hidden flex flex-col">
              {/* Modal Top Bar - Clean Light Enterprise Theme */}
              <div className="sticky top-0 z-30 px-5 py-3.5 bg-white text-slate-900 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
                <div className="flex items-center gap-3">
                  <img
                    src="/icici-bank-logo.jpg"
                    alt="ICICI Bank"
                    className="h-7 sm:h-8 object-contain rounded"
                  />
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 font-mono">
                      ICICI Bank FASTag Official Statement
                    </h3>
                    <p className="text-[10px] text-slate-500 font-mono">
                      Ref: {refNo} • Electronic Clearance Statement
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadPDF}
                    disabled={isDownloadingPdf}
                    className="px-3.5 py-1.5 rounded-xl bg-[#E60012] hover:bg-[#CC0010] text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-xs disabled:opacity-50"
                    title="Download Official 2-Page PDF"
                  >
                    {isDownloadingPdf ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    <span>{isDownloadingPdf ? 'Generating PDF...' : 'Download PDF'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handlePrintInvoice}
                    className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer border border-slate-200"
                    title="Print Document"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Print</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedTxForInvoice(null)}
                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-800 transition cursor-pointer ml-1"
                    title="Close"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Document Pages Container - Authentic Continuous Document Viewer */}
              <div className="p-4 sm:p-8 space-y-8 overflow-y-auto max-h-[82vh] flex flex-col items-center bg-slate-100/90">
                {/* PAGE 1: EXACT REPLICA OF USER IMAGE 1 */}
                <div
                  id="icici-fastag-page-1"
                  className="w-full max-w-[760px] bg-white p-6 sm:p-8 shadow-md border border-slate-300 text-slate-900 font-sans text-xs space-y-4"
                  style={{ minHeight: '1020px' }}
                >
                  {/* Top Header: FASTag E-Statement & ICICI Bank Logo */}
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                    <div className="flex items-center gap-2">
                      <div
                        style={{
                          width: '18px',
                          height: '16px',
                          backgroundColor: '#F58220',
                          transform: 'skewX(-20deg)'
                        }}
                      />
                      <span className="text-base sm:text-lg font-bold text-[#801B1C] tracking-tight">
                        FASTag E-Statement
                      </span>
                    </div>

                    {/* ICICI Bank Logo (Official Uploaded Asset) */}
                    <div className="flex items-center">
                      <img
                        src="/icici-bank-logo.jpg"
                        alt="ICICI Bank"
                        className="h-8 sm:h-9 object-contain"
                      />
                    </div>
                  </div>

                  {/* Table 1: Bank Details & Customer Details (Grey Header Bar) */}
                  <div className="border border-slate-300 overflow-hidden text-[10px] leading-tight">
                    <div className="grid grid-cols-12 bg-[#A6A6A6] text-white font-bold py-1 px-2">
                      <div className="col-span-5 border-r border-slate-400 pr-2">Bank Details</div>
                      <div className="col-span-7 pl-2">Customer Details</div>
                    </div>

                    <div className="grid grid-cols-12 bg-white">
                      {/* Left: Bank Details */}
                      <div className="col-span-5 p-2 border-r border-slate-300 space-y-1">
                        <div>
                          <span className="font-bold text-slate-800">Statement Reference Number:</span>
                          <p className="font-mono text-slate-900">{refNo}</p>
                        </div>
                        <div>
                          <span className="font-bold text-slate-800">Name of ICICI Bank Branch making the supply:</span>
                          <p className="text-slate-700">ICICI Bank Limited BKC</p>
                        </div>
                        <div>
                          <span className="font-bold text-slate-800">Bill From Address of ICICI:</span>
                          <p className="text-slate-700">ICICI Bank Towers, Bandra Kurla Complex, Mumbai 400051</p>
                        </div>
                        <div>
                          <span className="font-bold text-slate-800">GSTIN of ICICI:</span>
                          <p className="font-mono text-slate-900">27AAACI1195H5ZR</p>
                        </div>
                        <div className="grid grid-cols-2 gap-1 pt-1 border-t border-slate-100">
                          <div>
                            <span className="font-bold text-slate-800">Place of Supply:</span>
                            <p className="text-slate-700">Kerala</p>
                          </div>
                          <div>
                            <span className="font-bold text-slate-800">State Code:</span>
                            <p className="font-mono text-slate-900">32</p>
                          </div>
                        </div>
                      </div>

                      {/* Right: Customer Details */}
                      <div className="col-span-7 p-2 grid grid-cols-12 gap-2">
                        <div className="col-span-7 space-y-1">
                          <div>
                            <span className="font-bold text-slate-800">Customer ID:</span>
                            <span className="font-mono text-slate-900 ml-1.5">{customerId}</span>
                          </div>
                          <div>
                            <span className="font-bold text-slate-800">Name:</span>
                            <span className="font-bold text-slate-900 uppercase ml-1.5">MUHAMMED KUTTY P</span>
                          </div>
                          <div>
                            <span className="font-bold text-slate-800">Statement Period:</span>
                            <span className="text-slate-700 ml-1.5">10-01-2022 to 07-02-2022</span>
                          </div>
                          <div>
                            <span className="font-bold text-slate-800">Statement Date:</span>
                            <span className="text-slate-700 ml-1.5">10-02-2022</span>
                          </div>
                          <div>
                            <span className="font-bold text-slate-800">Type of address:</span>
                            <span className="text-slate-700 ml-1.5">Permanent</span>
                          </div>
                          <div>
                            <span className="font-bold text-slate-800">GSTIN Number:</span>
                            <span className="text-slate-700 ml-1.5">N/A</span>
                          </div>
                        </div>

                        <div className="col-span-5 border-l border-slate-200 pl-2 text-[9.5px] leading-tight space-y-0.5 text-slate-700">
                          <span className="font-bold text-slate-800 block">Address:</span>
                          <p className="font-semibold text-slate-800">MUHAMMED KUTTY P</p>
                          <p>KAIPPARAMBA</p>
                          <p>EKKAPARAMBA,KUZHIMANNA PO,</p>
                          <p>KUZHIMANNA,</p>
                          <p>MALAPPURAM - 673641,</p>
                          <p>Kerala,</p>
                          <p>INDIA</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Table 2: Vehicle Summary (Solid Orange Header Bar #F58220) */}
                  <div className="border border-slate-300 overflow-hidden text-[9.5px]">
                    <div className="bg-[#F58220] text-white font-bold py-1 px-2.5 text-[11px]">
                      Vehicle Summary
                    </div>
                    <table className="w-full text-left">
                      <thead className="bg-[#E6E6E6] text-slate-800 font-bold border-b border-slate-300 text-[9px]">
                        <tr>
                          <th className="py-1 px-1.5 border-r border-slate-300">Tag Account No.</th>
                          <th className="py-1 px-1.5 border-r border-slate-300">Licence Plate No.</th>
                          <th className="py-1 px-1.5 border-r border-slate-300">Group</th>
                          <th className="py-1 px-1.5 border-r border-slate-300 text-center">Trip Count</th>
                          <th className="py-1 px-1.5 border-r border-slate-300 text-right">Opening Balance (Rs.)</th>
                          <th className="py-1 px-1.5 border-r border-slate-300 text-right">Credit (Rs.)</th>
                          <th className="py-1 px-1.5 border-r border-slate-300 text-right">Debit (Rs.)</th>
                          <th className="py-1 px-1.5 text-right">Closing Balance (Rs.)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        <tr>
                          <td className="py-1.5 px-1.5 border-r border-slate-300 font-mono">{tagAcc}</td>
                          <td className="py-1.5 px-1.5 border-r border-slate-300 font-mono font-bold">{plate}</td>
                          <td className="py-1.5 px-1.5 border-r border-slate-300">Default</td>
                          <td className="py-1.5 px-1.5 border-r border-slate-300 text-center">1</td>
                          <td className="py-1.5 px-1.5 border-r border-slate-300 text-right font-mono">{openingBal.toFixed(2)}</td>
                          <td className="py-1.5 px-1.5 border-r border-slate-300 text-right font-mono">0.00</td>
                          <td className="py-1.5 px-1.5 border-r border-slate-300 text-right font-mono">- {amount.toFixed(2)}</td>
                          <td className="py-1.5 px-1.5 text-right font-mono font-bold">{closingBal.toFixed(2)}</td>
                        </tr>
                      </tbody>
                      <tfoot className="bg-slate-50 font-bold border-t border-slate-300">
                        <tr>
                          <td colSpan={3} className="py-1 px-1.5 border-r border-slate-300 text-right">Total</td>
                          <td className="py-1 px-1.5 border-r border-slate-300 text-center">1</td>
                          <td className="py-1 px-1.5 border-r border-slate-300 text-right font-mono">{openingBal.toFixed(2)}</td>
                          <td className="py-1 px-1.5 border-r border-slate-300 text-right font-mono">0.00</td>
                          <td className="py-1 px-1.5 border-r border-slate-300 text-right font-mono">- {amount.toFixed(2)}</td>
                          <td className="py-1 px-1.5 text-right font-mono">{closingBal.toFixed(2)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Table 3: Transaction Details (Solid Maroon Header Bar #9B1B1E & Orange Sub-bar) */}
                  <div className="border border-slate-300 overflow-hidden text-[9px]">
                    <div className="bg-[#9B1B1E] text-white font-bold py-1 px-2.5 text-[11px]">
                      Transaction Details
                    </div>
                    <div className="bg-[#F58220] text-slate-900 font-bold py-0.5 px-2.5 text-[10px]">
                      {plate} - {tagAcc}
                    </div>
                    <table className="w-full text-left">
                      <thead className="bg-[#E6E6E6] text-slate-800 font-bold border-b border-slate-300 text-[8.5px]">
                        <tr>
                          <th className="py-1 px-1.5 border-r border-slate-300">Date & Time</th>
                          <th className="py-1 px-1.5 border-r border-slate-300">Activity</th>
                          <th className="py-1 px-1.5 border-r border-slate-300">Unique Transaction ID</th>
                          <th className="py-1 px-1.5 border-r border-slate-300">Transaction Description</th>
                          <th className="py-1 px-1.5 border-r border-slate-300 text-right">Amount (Rs.) [CR]</th>
                          <th className="py-1 px-1.5 text-right">Amount (Rs.) [DR]</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="hover:bg-slate-50">
                          <td className="py-1.5 px-1.5 border-r border-slate-300 font-mono whitespace-nowrap">{datePart} {timePart}</td>
                          <td className="py-1.5 px-1.5 border-r border-slate-300">Trip (RRN No: / Trip No)</td>
                          <td className="py-1.5 px-1.5 border-r border-slate-300 font-mono text-[8px] max-w-[130px] break-all">{txnIdStr}</td>
                          <td className="py-1.5 px-1.5 border-r border-slate-300 font-medium">Plaza Name {plazaStr} - Lane ID:{laneNum}</td>
                          <td className="py-1.5 px-1.5 border-r border-slate-300 text-right font-mono">0.00</td>
                          <td className="py-1.5 px-1.5 text-right font-mono font-bold text-red-700">{amount.toFixed(2)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Section 4: CUG Payment Details */}
                  <div className="border border-slate-300 overflow-hidden text-[10px]">
                    <div className="bg-[#F58220] text-white font-bold py-0.5 px-2.5 text-[10.5px]">
                      CUG Payment Details
                    </div>
                    <div className="py-2 px-3 text-center text-amber-600 font-semibold bg-white">
                      No transaction details to display
                    </div>
                  </div>

                  {/* Section 5: GSTIN Details */}
                  <div className="border border-slate-300 overflow-hidden text-[10px]">
                    <div className="bg-[#9B1B1E] text-white font-bold py-0.5 px-2.5 text-[10.5px]">
                      GSTIN Details
                    </div>
                    <div className="py-2 px-3 text-center text-red-600 font-semibold bg-white">
                      No transaction details to display
                    </div>
                  </div>

                  {/* Section 6: Load by UPI */}
                  <div className="border border-slate-300 overflow-hidden text-[10px]">
                    <div className="bg-[#F58220] text-white font-bold py-0.5 px-2.5 text-[10.5px]">
                      Load by UPI
                    </div>
                    <div className="py-2 px-3 text-center text-amber-600 font-semibold bg-white">
                      No transaction details to display
                    </div>
                  </div>

                  {/* Page 1 Footer */}
                  <div className="pt-6 flex justify-end text-[10px] text-slate-500 font-mono">
                    <span>1 of 2</span>
                  </div>
                </div>

                {/* PAGE 2: EXACT REPLICA OF USER IMAGE 2 */}
                <div
                  id="icici-fastag-page-2"
                  className="w-full max-w-[760px] bg-white p-6 sm:p-8 shadow-md border border-slate-300 text-slate-900 font-sans text-xs space-y-5 flex flex-col justify-between"
                  style={{ minHeight: '1020px' }}
                >
                  <div className="space-y-4">
                    {/* Top Header: FASTag E-Statement & ICICI Bank Logo */}
                    <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                      <div className="flex items-center gap-2">
                        <div
                          style={{
                            width: '18px',
                            height: '16px',
                            backgroundColor: '#F58220',
                            transform: 'skewX(-20deg)'
                          }}
                        />
                        <span className="text-base sm:text-lg font-bold text-[#801B1C] tracking-tight">
                          FASTag E-Statement
                        </span>
                      </div>

                      {/* ICICI Bank Logo (Official Uploaded Asset) */}
                      <div className="flex items-center">
                        <img
                          src="/icici-bank-logo.jpg"
                          alt="ICICI Bank"
                          className="h-8 sm:h-9 object-contain"
                        />
                      </div>
                    </div>

                    {/* Important Messages Heading & Red Divider */}
                    <div>
                      <h2 className="text-sm font-bold text-[#9B1B1E] tracking-tight">
                        Important Messages
                      </h2>
                      <div className="h-0.5 bg-[#DC2626] w-full mt-1" />
                    </div>

                    {/* Disclaimer Body Paragraphs */}
                    <div className="space-y-2 text-[10px] leading-relaxed text-slate-800">
                      <p>
                        The Agency does not guarantee the accuracy of this information. For up-to-date account information, please contact our Customer Care at 18002670104.
                      </p>

                      <p className="text-[#DC2626] font-medium">
                        * Date and Time for Activity type: Trip is the Trip Date & Time, not the Transaction Posting Date & Time
                      </p>

                      <ul className="list-disc pl-5 space-y-1.5 text-slate-700">
                        <li>
                          With effect from 01/07/2017, Goods and Services Tax will be applicable on the services which include IGST @ 18%, CGST @ 9% and SGST @ 9%.
                        </li>
                        <li>
                          Our registered office address : ICICI Bank Limited, "Landmark", Race Course Circle, Vadodara - 390 007, Gujarat, India.
                        </li>
                      </ul>
                    </div>

                    {/* Declaration & Signatory (Exact Alignment with Image 2) */}
                    <div className="pt-10 border-t border-slate-200 mt-8">
                      <div className="flex items-start justify-between">
                        <div className="text-xs font-semibold text-slate-800">
                          Declaration
                        </div>

                        <div className="text-center space-y-1">
                          <span className="text-xs font-bold text-slate-800 block">
                            For ICICI Bank Limited
                          </span>

                          {/* Transparent Authorized Signatory Signature */}
                          <div className="flex justify-center py-1">
                            <img
                              src={AUTHORIZED_SIGNATURE_BASE64}
                              alt="Authorized Signatory"
                              className="h-12 w-auto max-w-[155px] object-contain select-none"
                            />
                          </div>

                          <span className="text-[11px] font-bold text-slate-800 block">
                            Authorized Signatory
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Page 2 Footer */}
                  <div className="pt-8 flex justify-end text-[10px] text-slate-500 font-mono">
                    <span>2 of 2</span>
                  </div>
                </div>
              </div>

              {/* Modal Bottom Bar - Clean Light Enterprise Theme */}
              <div className="p-3.5 bg-slate-50 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
                <span className="text-[11px] font-medium text-slate-500">
                  Standard 2-page ICICI Bank statement with encrypted ETC clearing records.
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadPDF}
                    disabled={isDownloadingPdf}
                    className="px-4 py-2 rounded-xl bg-[#E60012] hover:bg-[#CC0010] text-white font-bold text-xs flex items-center gap-1.5 transition shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    {isDownloadingPdf ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    <span>Download 2-Page PDF</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedTxForInvoice(null)}
                    className="px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-bold text-xs transition cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ============================================================== */}
      {/* MODAL: ADD MANUAL FASTAG TOLL BILL / TRANSACTION               */}
      {/* ============================================================== */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/70 backdrop-blur-xs p-3 sm:p-6 flex justify-center items-start">
          <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-200 max-w-lg w-full my-4 sm:my-8 overflow-hidden flex flex-col">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center border border-red-100">
                  <Plus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900">
                    Generate FASTag Toll Bill
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Create an extra or custom electronic toll debit with coordinates
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateManualBill} className="p-5 space-y-4 text-xs">
              {formError && (
                <div className="p-3 rounded-2xl bg-red-50 border border-red-200 text-xs font-semibold text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Vehicle Picker */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Select Fleet Commercial Truck *
                </label>
                <select
                  value={formVehicleId}
                  onChange={(e) => setFormVehicleId(e.target.value)}
                  className="w-full bg-slate-50 px-3 py-2.5 rounded-xl border border-slate-200 font-bold text-slate-900 focus:outline-none focus:border-slate-800"
                  required
                >
                  <option value="">-- Choose Commercial Vehicle --</option>
                  {vehicles.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.registration_no} • {v.name_model} ({v.vehicle_type})
                    </option>
                  ))}
                </select>
              </div>

              {/* Toll Plaza Name */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Toll Plaza Name *
                  </label>
                  <span className="text-[10px] text-slate-400">e.g. Simga Toll Plaza</span>
                </div>
                <input
                  type="text"
                  value={formPlazaName}
                  onChange={(e) => setFormPlazaName(e.target.value)}
                  placeholder="Enter Toll Plaza Name..."
                  className="w-full bg-white px-3 py-2 rounded-xl border border-slate-200 font-semibold text-slate-900 focus:outline-none focus:border-slate-800"
                  required
                />
              </div>

              {/* Highway Name */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Highway / Corridor Name
                </label>
                <input
                  type="text"
                  value={formHighway}
                  onChange={(e) => setFormHighway(e.target.value)}
                  placeholder="e.g. NH-30 Raipur - Bilaspur Expressway"
                  className="w-full bg-white px-3 py-2 rounded-xl border border-slate-200 font-semibold text-slate-900 focus:outline-none focus:border-slate-800"
                />
              </div>

              {/* Coordinates (Lat / Lng) with Auto-Calculate Pricing Trigger */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Toll GPS Coordinates (Lat, Lng) *
                  </label>
                  <button
                    type="button"
                    onClick={handleAutoEstimate}
                    disabled={isEstimating}
                    className="text-[10px] font-bold text-red-600 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${isEstimating ? 'animate-spin' : ''}`} />
                    <span>Auto-Calculate Truck Tariff</span>
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="relative">
                    <input
                      type="number"
                      step="any"
                      value={formLat}
                      onChange={(e) => setFormLat(e.target.value)}
                      placeholder="Latitude (e.g. 21.6241)"
                      className="w-full bg-white px-3 py-2 rounded-xl border border-slate-200 font-mono text-xs font-bold text-slate-900 focus:outline-none focus:border-slate-800"
                      required
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">°N</span>
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      step="any"
                      value={formLng}
                      onChange={(e) => setFormLng(e.target.value)}
                      placeholder="Longitude (e.g. 81.6983)"
                      className="w-full bg-white px-3 py-2 rounded-xl border border-slate-200 font-mono text-xs font-bold text-slate-900 focus:outline-none focus:border-slate-800"
                      required
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">°E</span>
                  </div>
                </div>
              </div>

              {/* Truck Tariff Amount */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Commercial Truck Toll Tariff (₹) *
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-slate-400">₹</span>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    placeholder="340.00"
                    className="w-full bg-white pl-7 pr-3 py-2 rounded-xl border border-slate-200 font-mono text-xs font-black text-slate-900 focus:outline-none focus:border-slate-800"
                    required
                  />
                </div>
                <p className="text-[10px] text-slate-400">
                  Standard NHAI Commercial 3-Axle Truck tariff for this toll zone.
                </p>
              </div>

              {/* Date & Time (Strict DD/MM/YYYY Format) */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Crossing Date
                  </label>
                  <DMYDateInput
                    value={formDate}
                    onChange={(iso) => setFormDate(iso)}
                    className="w-full justify-between bg-white px-2.5 py-1.5 rounded-xl border border-slate-200 font-bold text-slate-900 shadow-2xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Crossing Time
                  </label>
                  <input
                    type="time"
                    value={formTime}
                    onChange={(e) => setFormTime(e.target.value)}
                    className="w-full bg-white px-3 py-2 rounded-xl border border-slate-200 font-bold text-slate-900 focus:outline-none focus:border-slate-800"
                    required
                  />
                </div>
              </div>

              {/* Lane */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  ETC Lane / Gate
                </label>
                <input
                  type="text"
                  value={formLane}
                  onChange={(e) => setFormLane(e.target.value)}
                  placeholder="Lane 04 - Heavy Commercial FASTag"
                  className="w-full bg-white px-3 py-2 rounded-xl border border-slate-200 font-medium text-slate-900 focus:outline-none focus:border-slate-800"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-bold text-xs hover:bg-slate-50 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-[#E60012] hover:bg-[#CC0010] text-white font-bold text-xs flex items-center gap-1.5 transition shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>{isSubmitting ? 'Generating Tax Bill...' : 'Generate FASTag Bill'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
