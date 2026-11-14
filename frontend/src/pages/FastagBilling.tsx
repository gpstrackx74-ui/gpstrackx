import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Vehicle, FastagTransaction, FastagStats } from '../types';
import { DMYDateInput } from '../components/DMYDateInput';
import {
  generateFastagStatementPdf,
  FastagStatementReportData,
  formatDurationDate,
  formatTableDateTime
} from '../utils/generateFastagStatementPdf';
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
  RefreshCw,
  FileText,
  AlertCircle,
  Loader2,
  ChevronRight,
  Filter,
  ArrowRight,
  ChevronDown
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
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // --- Step 1: Vehicle Selection State ---
  // When entering the page, user is prompted to select a vehicle
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('');

  // --- Step 2: Date Range Filter (Start Date to End Date) ---
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // --- Step 3: Statement Receipt Modal State ---
  const [isStatementModalOpen, setIsStatementModalOpen] = useState(false);
  const [statementData, setStatementData] = useState<FastagStatementReportData | null>(null);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  // Form State for Add Manual Toll Bill
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
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

  // Load Vehicles & All Transactions
  const fetchAllData = async () => {
    try {
      setLoading(true);
      const [txRes, vehRes] = await Promise.all([
        api.getFastagTransactions({
          vehicle_id: selectedVehicleId || undefined,
          start_date: startDate || undefined,
          end_date: endDate || undefined,
          search: searchQuery.trim() || undefined
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
  }, [selectedVehicleId, startDate, endDate]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchAllData();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Find currently selected vehicle object
  const selectedVehicle = useMemo(() => {
    if (!selectedVehicleId) return null;
    return vehicles.find(
      v => String(v.id) === selectedVehicleId || v.registration_no === selectedVehicleId
    ) || null;
  }, [vehicles, selectedVehicleId]);

  // Filter transactions for currently selected vehicle and date range
  const vehicleTransactions = useMemo(() => {
    if (!selectedVehicleId) return [];
    return transactions.filter(tx => {
      const matchVehicle =
        String(tx.vehicle_id) === String(selectedVehicleId) ||
        (selectedVehicle && tx.vehicle_registration_no?.toUpperCase().trim() === selectedVehicle.registration_no?.toUpperCase().trim());
      if (!matchVehicle) return false;

      // Filter by search query if any
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const descMatch = (tx.description || '').toLowerCase().includes(q);
        const plazaMatch = (tx.toll_plaza_name || '').toLowerCase().includes(q);
        const txnMatch = (tx.transaction_id || '').toLowerCase().includes(q);
        const netcMatch = (tx.netc_reference_no || '').toLowerCase().includes(q);
        if (!descMatch && !plazaMatch && !txnMatch && !netcMatch) return false;
      }

      return true;
    }).sort((a, b) => {
      // Sort chronologically ascending
      const dtA = a.crossing_time || a.created_at || '';
      const dtB = b.crossing_time || b.created_at || '';
      return dtA.localeCompare(dtB);
    });
  }, [transactions, selectedVehicleId, selectedVehicle, searchQuery]);

  // Total debited amount for selected vehicle in range
  const totalDebitAmount = useMemo(() => {
    return vehicleTransactions.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  }, [vehicleTransactions]);

  // Date range presets
  const handleSetPreset = (preset: 'all' | 'this_month' | 'last_30_days') => {
    if (preset === 'all') {
      setStartDate('');
      setEndDate('');
    } else if (preset === 'this_month') {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
      setStartDate(firstDay);
      setEndDate(lastDay);
    } else if (preset === 'last_30_days') {
      const now = new Date();
      const past = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      setStartDate(past);
      setEndDate(now.toISOString().split('T')[0]);
    }
  };

  // Open Statement / Receipt Modal
  const handleOpenStatement = (txList?: FastagTransaction[]) => {
    const list = txList && txList.length > 0 ? txList : vehicleTransactions;
    if (list.length === 0) {
      alert('No FASTag toll deductions found for this vehicle in the selected date range.');
      return;
    }

    const report: FastagStatementReportData = {
      customerName:
        selectedVehicle?.customer_name ||
        selectedVehicle?.owner_name ||
        list[0]?.customer_name ||
        list[0]?.driver_name ||
        'Ramniwas',
      customerMobile:
        selectedVehicle?.customer_mobile ||
        (selectedVehicle as any)?.owner_phone ||
        list[0]?.customer_mobile ||
        list[0]?.driver_phone ||
        '8094249011',
      truckNumber:
        selectedVehicle?.registration_no ||
        list[0]?.vehicle_registration_no ||
        'RJ22GB7999',
      truckOwnerName:
        selectedVehicle?.truck_owner_name ||
        selectedVehicle?.owner_name ||
        list[0]?.truck_owner_name ||
        'Rajendra Kumar',
      startDateStr: startDate || list[0]?.crossing_time || list[0]?.created_at,
      endDateStr: endDate || list[list.length - 1]?.crossing_time || list[list.length - 1]?.created_at,
      transactions: list
    };

    setStatementData(report);
    setIsStatementModalOpen(true);
  };

  // Download Multi-Page PDF
  const handleDownloadPDF = async () => {
    if (!statementData) return;
    try {
      setIsDownloadingPdf(true);
      const doc = generateFastagStatementPdf(statementData);
      const cleanTruck = statementData.truckNumber.replace(/[^A-Z0-9]/g, '') || 'TRUCK';
      doc.save(`FASTag_Account_Summary_${cleanTruck}.pdf`);
    } catch (err) {
      console.error('PDF export error:', err);
      alert('Failed to generate PDF. Please try again.');
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Auto-estimate tariff for manual bill modal
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
        handleOpenStatement([res.transaction]);
      }
    } catch (err: any) {
      setFormError(err.message || 'Failed to generate FASTag bill');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-7 max-w-7xl mx-auto space-y-4 font-sans">
      {/* MAIN CONTAINER */}
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-xs overflow-hidden">
        {/* Header */}
        <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-[#F1F5F9] text-[#0F172A] flex items-center justify-center border border-slate-200 shadow-2xs">
                <Receipt className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                  FASTag Tolls & Account Statements
                  <span className="text-[10px] font-bold text-red-700 bg-red-50 px-2.5 py-0.5 rounded-full border border-red-200">
                    AXIS BANK • BLACKBUCK LIVE
                  </span>
                </h2>
                <p className="text-xs text-slate-500 font-medium">
                  Electronic toll collection bills, date-wise statement durations & official account summaries
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={fetchAllData}
              className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition shadow-2xs cursor-pointer"
              title="Refresh Data"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-red-600' : ''}`} />
            </button>

            {isAdmin && (
              <button
                type="button"
                onClick={() => setIsAddModalOpen(true)}
                className="px-4 py-2.5 rounded-xl bg-[#E60012] hover:bg-[#CC0010] text-white font-bold text-xs flex items-center gap-2 transition shadow-xs cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>+ Add Manual Toll Bill</span>
              </button>
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-slate-100" />

        {/* ============================================================== */}
        {/* STEP 1: VEHICLE SELECTION SECTION                              */}
        {/* Prompt the user to select a vehicle first                      */}
        {/* ============================================================== */}
        <div className="p-5 sm:p-6 bg-slate-50/50 border-b border-slate-100">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Truck className="w-4 h-4 text-[#E60012]" />
                <span className="text-xs font-black uppercase tracking-wider text-slate-800">
                  Step 1: Select Fleet Vehicle / Truck (गाड़ी चुनें)
                </span>
                {selectedVehicle && (
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    Selected: {selectedVehicle.registration_no}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 font-medium">
                Choose a commercial vehicle to view its individual FASTag toll deductions and generate date-wise receipts
              </p>
            </div>

            {/* Vehicle Selector Dropdown */}
            <div className="flex items-center gap-2 min-w-[280px]">
              <div className="relative flex-1">
                <select
                  value={selectedVehicleId}
                  onChange={(e) => setSelectedVehicleId(e.target.value)}
                  className="w-full bg-white px-3 py-2.5 rounded-xl border border-slate-300 font-bold text-xs text-slate-900 focus:outline-none focus:border-red-600 shadow-2xs cursor-pointer"
                >
                  <option value="">-- Choose Commercial Truck ({vehicles.length}) --</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={String(v.id)}>
                      {v.registration_no} • {v.name_model} {v.owner_name ? `(Owner: ${v.owner_name})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {selectedVehicleId && (
                <button
                  type="button"
                  onClick={() => setSelectedVehicleId('')}
                  className="px-3 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold transition cursor-pointer"
                  title="Clear Vehicle Selection"
                >
                  Change
                </button>
              )}
            </div>
          </div>

          {/* Quick Click Vehicle Cards when no vehicle is selected */}
          {!selectedVehicleId && (
            <div className="mt-4 pt-4 border-t border-slate-200/60">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2.5">
                Quick Select Available Fleet Trucks:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {vehicles.map((v) => (
                  <div
                    key={v.id}
                    onClick={() => setSelectedVehicleId(String(v.id))}
                    className="p-3 bg-white hover:bg-red-50/40 border border-slate-200 hover:border-red-300 rounded-2xl cursor-pointer transition shadow-2xs group flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-xl bg-slate-100 group-hover:bg-[#E60012] group-hover:text-white text-slate-700 flex items-center justify-center shrink-0 transition">
                        <Truck className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-mono font-black text-xs text-slate-900 group-hover:text-[#E60012] transition truncate">
                          {v.registration_no}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">
                          {v.name_model}
                        </div>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-[#E60012] group-hover:translate-x-0.5 transition shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ============================================================== */}
        {/* STEP 2: ACTIVE VEHICLE DETAILS & DATE RANGE FILTER BAR         */}
        {/* Start Date to End Date + Generate Statement Receipt Button     */}
        {/* ============================================================== */}
        {selectedVehicleId && (
          <div className="p-5 sm:p-6 bg-white space-y-4">
            {/* Active Truck Details Banner */}
            <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-50 to-slate-100/60 border border-slate-200 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-12 h-12 rounded-2xl bg-[#E60012] text-white flex items-center justify-center shrink-0 shadow-xs">
                  <Truck className="w-6 h-6 text-white" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-black text-lg text-slate-900 tracking-tight">
                      {selectedVehicle?.registration_no}
                    </span>
                    <span className="text-[10px] font-bold text-slate-700 bg-white px-2.5 py-0.5 rounded-full border border-slate-200">
                      {selectedVehicle?.name_model || 'Commercial Truck'}
                    </span>
                    <span className="text-[10px] font-bold text-slate-500 bg-slate-200/70 px-2 py-0.5 rounded-full">
                      {selectedVehicle?.vehicle_type || 'Heavy Vehicle'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1 flex items-center gap-3 flex-wrap">
                    <span>
                      Customer: <strong className="text-slate-800">{selectedVehicle?.customer_name || selectedVehicle?.owner_name || 'Ramniwas'}</strong>
                    </span>
                    <span>•</span>
                    <span>
                      Mobile: <strong className="text-slate-800">{selectedVehicle?.customer_mobile || (selectedVehicle as any)?.owner_phone || '8094249011'}</strong>
                    </span>
                    <span>•</span>
                    <span>
                      Owner: <strong className="text-slate-800">{selectedVehicle?.truck_owner_name || selectedVehicle?.owner_name || 'Rajendra Kumar'}</strong>
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleOpenStatement()}
                  disabled={vehicleTransactions.length === 0}
                  className="px-4 py-2.5 rounded-xl bg-[#E60012] hover:bg-[#CC0010] text-white font-black text-xs flex items-center gap-2 transition shadow-xs cursor-pointer disabled:opacity-50"
                  title="Generate Official FASTag Statement Receipt"
                >
                  <FileText className="w-4 h-4" />
                  <span>Generate Statement ({vehicleTransactions.length} Tolls • ₹{totalDebitAmount.toLocaleString('en-IN')})</span>
                </button>
              </div>
            </div>

            {/* Date Range Filter Bar */}
            <div className="p-4 rounded-2xl bg-slate-50/70 border border-slate-200/80 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                  <Calendar className="w-4 h-4 text-red-600" />
                  <span>Statement Duration:</span>
                </div>

                {/* Start Date */}
                <div className="flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-xl border border-slate-300 shadow-2xs">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">From:</span>
                  <DMYDateInput
                    value={startDate}
                    onChange={(iso) => setStartDate(iso)}
                    className="bg-transparent text-xs font-bold text-slate-900"
                  />
                  {startDate && (
                    <button
                      type="button"
                      onClick={() => setStartDate('')}
                      className="text-slate-400 hover:text-slate-600 p-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <span className="text-slate-400 font-bold text-xs">to</span>

                {/* End Date */}
                <div className="flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-xl border border-slate-300 shadow-2xs">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">To:</span>
                  <DMYDateInput
                    value={endDate}
                    onChange={(iso) => setEndDate(iso)}
                    className="bg-transparent text-xs font-bold text-slate-900"
                  />
                  {endDate && (
                    <button
                      type="button"
                      onClick={() => setEndDate('')}
                      className="text-slate-400 hover:text-slate-600 p-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Presets */}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleSetPreset('all')}
                    className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-[11px] font-bold text-slate-700 transition cursor-pointer"
                  >
                    All Dates
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSetPreset('this_month')}
                    className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-[11px] font-bold text-slate-700 transition cursor-pointer"
                  >
                    This Month
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSetPreset('last_30_days')}
                    className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-[11px] font-bold text-slate-700 transition cursor-pointer"
                  >
                    Last 30 Days
                  </button>
                </div>
              </div>

              {/* Search Inside Vehicle Transactions */}
              <div className="relative min-w-[220px]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter Toll Plaza or TXN ID..."
                  className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:border-red-600 transition"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* ============================================================== */}
            {/* STEP 3: DETAILED TRANSACTIONS LIST FOR THIS VEHICLE           */}
            {/* Matching the User's PDF layout with "View Bill" action         */}
            {/* ============================================================== */}
            <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-2xs">
              <div className="p-3.5 bg-slate-50/90 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                  <span className="text-xs font-black text-slate-900 uppercase tracking-wider">
                    FASTag Toll Deduction Records ({vehicleTransactions.length} Tolls Found)
                  </span>
                </div>
                <div className="text-xs font-mono font-bold text-slate-700">
                  Total Deducted: <span className="text-emerald-600 font-black">₹{totalDebitAmount.toLocaleString('en-IN')}</span>
                </div>
              </div>

              {vehicleTransactions.length === 0 ? (
                <div className="p-12 text-center text-slate-400 space-y-2">
                  <Receipt className="w-8 h-8 text-slate-300 mx-auto" />
                  <p className="text-xs font-bold text-slate-600">
                    No FASTag toll deductions recorded for {selectedVehicle?.registration_no} in this date range.
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Try selecting "All Dates" or entering a different date range.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#E8EFF7] text-[11px] font-bold text-slate-800 border-b border-slate-300">
                      <tr>
                        <th className="py-2.5 px-3">Transaction Time</th>
                        <th className="py-2.5 px-3 text-center">Nature (C/D)</th>
                        <th className="py-2.5 px-3 text-center">Amount (₹)</th>
                        <th className="py-2.5 px-3 text-center">Closing Balance (₹)</th>
                        <th className="py-2.5 px-3">Description</th>
                        <th className="py-2.5 px-3 text-center">Transaction ID</th>
                        <th className="py-2.5 px-3 text-center">Receipt</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-slate-800 font-medium">
                      {vehicleTransactions.map((tx) => {
                        const dt = formatTableDateTime(tx.crossing_time, tx.created_at);
                        const balStr =
                          tx.wallet_balance_after != null
                            ? Number(tx.wallet_balance_after).toLocaleString('en-IN')
                            : '—';
                        return (
                          <tr key={tx.id} className="hover:bg-blue-50/30 transition">
                            {/* Transaction Time */}
                            <td className="py-3 px-3 whitespace-nowrap">
                              <div className="font-semibold text-slate-900 text-xs">
                                {dt.dateLine}
                              </div>
                              <div className="text-[10px] text-slate-500 font-mono">
                                {dt.timeLine}
                              </div>
                            </td>

                            {/* Nature */}
                            <td className="py-3 px-3 text-center whitespace-nowrap">
                              <span className="font-semibold text-slate-800 text-xs">
                                Debit
                              </span>
                            </td>

                            {/* Amount */}
                            <td className="py-3 px-3 text-center whitespace-nowrap">
                              <span className="font-bold text-slate-900 text-xs">
                                {Number(tx.amount || 0).toLocaleString('en-IN')}
                              </span>
                            </td>

                            {/* Closing Balance */}
                            <td className="py-3 px-3 text-center whitespace-nowrap">
                              <span className="font-semibold text-slate-700 text-xs">
                                {balStr}
                              </span>
                            </td>

                            {/* Description */}
                            <td className="py-3 px-3 min-w-[240px]">
                              <div className="text-xs text-slate-900 font-medium leading-snug">
                                {tx.description || tx.toll_plaza_name || 'Issuer Debit Transaction for toll fare'}
                              </div>
                              {tx.highway_name && (
                                <div className="text-[10px] text-slate-400 mt-0.5">
                                  {tx.highway_name}
                                </div>
                              )}
                            </td>

                            {/* Transaction ID */}
                            <td className="py-3 px-3 text-center whitespace-nowrap">
                              <div className="flex items-center justify-center gap-1 font-mono text-[11px] font-bold text-slate-800">
                                <span>{tx.transaction_id}</span>
                                <button
                                  type="button"
                                  onClick={() => copyToClipboard(tx.transaction_id, `txn-${tx.id}`)}
                                  className="text-slate-400 hover:text-slate-700 p-0.5 cursor-pointer"
                                  title="Copy Transaction ID"
                                >
                                  {copiedId === `txn-${tx.id}` ? (
                                    <Check className="w-3 h-3 text-emerald-500" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                </button>
                              </div>
                            </td>

                            {/* View Bill Button */}
                            <td className="py-3 px-3 text-center whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => handleOpenStatement([tx])}
                                className="px-3 py-1 rounded-lg bg-[#E60012] hover:bg-[#CC0010] text-white text-[11px] font-bold inline-flex items-center gap-1 transition shadow-2xs cursor-pointer"
                                title="View Bill"
                              >
                                <FileText className="w-3 h-3" />
                                <span>View Bill</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ============================================================== */}
      {/* 100% REPLICA FASTAG ACCOUNT SUMMARY STATEMENT MODAL            */}
      {/* Exactly matching User's Multi-Page PDF (Axis Bank | Blackbuck) */}
      {/* ============================================================== */}
      {isStatementModalOpen && statementData && (() => {
        const totalDebit = statementData.transactions.reduce(
          (sum, t) => sum + (Number(t.amount) || 0),
          0
        );

        let startDur = statementData.startDateStr ? formatDurationDate(statementData.startDateStr) : '';
        let endDur = statementData.endDateStr ? formatDurationDate(statementData.endDateStr) : '';
        if (!startDur && statementData.transactions.length > 0) {
          startDur = formatDurationDate(statementData.transactions[0].crossing_time || statementData.transactions[0].created_at);
        }
        if (!endDur && statementData.transactions.length > 0) {
          endDur = formatDurationDate(
            statementData.transactions[statementData.transactions.length - 1].crossing_time ||
            statementData.transactions[statementData.transactions.length - 1].created_at
          );
        }
        const durationText = startDur && endDur ? `${startDur} – ${endDur}` : (startDur || endDur || '03 August 26 – 31 August 26');

        return (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/80 backdrop-blur-xs p-2 sm:p-4 md:p-6 flex justify-center items-start">
            <div className="bg-white rounded-3xl shadow-2xl border border-slate-200/90 max-w-4xl w-full my-3 sm:my-6 overflow-hidden flex flex-col">
              {/* Modal Top Control Bar */}
              <div className="sticky top-0 z-30 px-5 py-3.5 bg-white text-slate-900 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center border border-red-100">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-900">
                      FASTAG ACCOUNT SUMMARY
                    </h3>
                    <p className="text-[10px] text-slate-500 font-mono">
                      Truck: {statementData.truckNumber} • {durationText}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadPDF}
                    disabled={isDownloadingPdf}
                    className="px-4 py-2 rounded-xl bg-[#E60012] hover:bg-[#CC0010] text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-xs disabled:opacity-50"
                    title="Download Exact Statement PDF"
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
                    onClick={() => window.print()}
                    className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer border border-slate-200"
                    title="Print Document"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Print</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsStatementModalOpen(false)}
                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-800 transition cursor-pointer ml-1"
                    title="Close"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Document Pages Container (Exact Replica of User's 6-Page PDF) */}
              <div className="p-4 sm:p-8 space-y-6 overflow-y-auto max-h-[82vh] flex flex-col items-center bg-slate-100/90">
                <div
                  id="fastag-statement-document"
                  className="w-full max-w-[780px] bg-white p-8 sm:p-10 shadow-lg border border-slate-300 text-slate-900 font-sans text-xs space-y-5"
                >
                  {/* Top Header: Title & AXIS BANK | BLACKBUCK Logo Box */}
                  <div className="flex items-center justify-between gap-4 pb-2">
                    <h1 className="text-base sm:text-lg font-black text-slate-950 tracking-tight">
                      FASTAG ACCOUNT SUMMARY
                    </h1>

                    {/* AXIS BANK | BLACKBUCK Logo Container */}
                    <div className="flex items-center gap-3 border border-slate-300 rounded-xl px-3 py-1.5 bg-white shadow-2xs">
                      {/* Axis Bank Logo */}
                      <div className="flex items-center gap-1.5">
                        <svg className="w-4 h-4" viewBox="0 0 40 40">
                          <polygon points="6,34 20,6 34,34" fill="#97144D" />
                          <polygon points="12,32 20,16 28,32" fill="#FFFFFF" />
                        </svg>
                        <span className="text-[11px] font-black text-[#97144D] tracking-wide">
                          AXIS BANK
                        </span>
                      </div>

                      <div className="h-4 w-px bg-slate-300" />

                      {/* BlackBuck Logo */}
                      <div className="flex items-center gap-1.5">
                        <svg className="w-4 h-4" viewBox="0 0 40 40">
                          <path d="M12,32 C14,14 18,6 24,4 C22,12 20,20 22,32 Z" fill="#E63946" />
                          <path d="M26,4 C30,12 30,22 28,32 Z" fill="#E63946" />
                        </svg>
                        <span className="text-[11px] font-black text-slate-900 tracking-wide">
                          BLACKBUCK
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Customer Information Block */}
                  <div className="space-y-1.5 text-xs text-slate-900 font-medium">
                    <div className="flex items-center">
                      <span className="w-36 text-slate-700">Customer Name</span>
                      <span>: <strong className="text-slate-950 ml-1">{statementData.customerName}</strong></span>
                    </div>
                    <div className="flex items-center">
                      <span className="w-36 text-slate-700">Customer Mobile</span>
                      <span>: <strong className="text-slate-950 ml-1">{statementData.customerMobile}</strong></span>
                    </div>
                    <div className="flex items-center">
                      <span className="w-36 text-slate-700">Truck Number</span>
                      <span>: <strong className="text-slate-950 font-mono ml-1">{statementData.truckNumber}</strong></span>
                    </div>
                    <div className="flex items-center">
                      <span className="w-36 text-slate-700">Truck Owner Name</span>
                      <span>: <strong className="text-slate-950 ml-1">{statementData.truckOwnerName}</strong></span>
                    </div>
                    <div className="flex items-center pt-2">
                      <span className="w-36 font-bold text-slate-900">Statement Duration</span>
                      <span>: <strong className="font-bold text-slate-950 ml-1">{durationText}</strong></span>
                    </div>
                  </div>

                  {/* Summary Box (Credit 0 | Debit {totalDebit}) */}
                  <div className="border border-slate-300 overflow-hidden text-xs rounded">
                    <div className="grid grid-cols-2 bg-[#E8EFF7] border-b border-slate-300 font-bold text-slate-800 text-center py-2 px-3">
                      <div>Credit (Recharge) in ₹</div>
                      <div className="border-l border-slate-300">Debit (Swipe) in ₹</div>
                    </div>
                    <div className="grid grid-cols-2 text-center py-2 px-3 font-semibold text-slate-900 bg-white">
                      <div>0</div>
                      <div className="border-l border-slate-300 font-bold">
                        {totalDebit.toLocaleString('en-IN')}
                      </div>
                    </div>
                  </div>

                  {/* Statement Transactions Table */}
                  <div className="border border-slate-300 overflow-hidden text-xs rounded">
                    <table className="w-full text-left">
                      <thead className="bg-[#E8EFF7] text-[10px] font-bold text-slate-800 border-b border-slate-300">
                        <tr>
                          <th className="py-2.5 px-3 border-r border-slate-300">Transaction Time</th>
                          <th className="py-2.5 px-2.5 text-center border-r border-slate-300">Nature (C/D)</th>
                          <th className="py-2.5 px-2.5 text-center border-r border-slate-300">Amount</th>
                          <th className="py-2.5 px-2.5 text-center border-r border-slate-300">Closing Balance</th>
                          <th className="py-2.5 px-3 border-r border-slate-300">Description</th>
                          <th className="py-2.5 px-3 text-center">Transaction ID</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-slate-800 font-medium text-[11px]">
                        {statementData.transactions.map((tx) => {
                          const dt = formatTableDateTime(tx.crossing_time, tx.created_at);
                          const balStr =
                            tx.wallet_balance_after != null
                              ? Number(tx.wallet_balance_after).toLocaleString('en-IN')
                              : '—';
                          return (
                            <tr key={tx.id} className="hover:bg-slate-50/60">
                              {/* Transaction Time */}
                              <td className="py-2 px-3 border-r border-slate-200 whitespace-nowrap">
                                <div className="font-semibold text-slate-900">
                                  {dt.dateLine}
                                </div>
                                <div className="text-[10px] text-slate-500 font-mono">
                                  {dt.timeLine}
                                </div>
                              </td>

                              {/* Nature */}
                              <td className="py-2 px-2.5 text-center border-r border-slate-200 whitespace-nowrap">
                                Debit
                              </td>

                              {/* Amount */}
                              <td className="py-2 px-2.5 text-center border-r border-slate-200 whitespace-nowrap font-semibold">
                                {Number(tx.amount || 0).toLocaleString('en-IN')}
                              </td>

                              {/* Closing Balance */}
                              <td className="py-2 px-2.5 text-center border-r border-slate-200 whitespace-nowrap font-mono">
                                {balStr}
                              </td>

                              {/* Description */}
                              <td className="py-2 px-3 border-r border-slate-200 min-w-[200px] leading-snug">
                                {tx.description || tx.toll_plaza_name || 'Issuer Debit Transaction for toll fare'}
                              </td>

                              {/* Transaction ID */}
                              <td className="py-2 px-3 text-center font-mono text-[10px] whitespace-nowrap">
                                {tx.transaction_id}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Modal Bottom Bar */}
              <div className="p-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
                <span className="text-[11px] font-medium text-slate-500">
                  Showing {statementData.transactions.length} debited toll transactions for {statementData.truckNumber}.
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
                    <span>Download PDF</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsStatementModalOpen(false)}
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
      {/* MODAL: ADD MANUAL FASTAG TOLL BILL                             */}
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
                    Create an extra electronic toll debit with coordinates
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
              </div>

              {/* Date & Time */}
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
