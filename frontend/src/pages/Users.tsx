import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { User } from '../types';
import {
  Users as UsersIcon,
  Search,
  Plus,
  Edit3,
  Trash2,
  X,
  Phone,
  Mail,
  Truck,
  CheckCircle,
  AlertCircle,
  ShieldCheck,
  Building2,
  FileSpreadsheet,
  CheckCircle2,
  Loader2,
  ChevronDown
} from 'lucide-react';

export const UsersManagement: React.FC = () => {
  const { user: currentUser } = useAuth();

  // Users State
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [openVehiclePopoverId, setOpenVehiclePopoverId] = useState<number | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isModalOpen) {
        setIsModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen]);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    company_name: '',
    password: '',
    role: 'user',
    status: 'active'
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const data = await api.getUsers({ search: searchTerm, status: statusFilter });
      setUsers(data);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [statusFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchUsers();
  };

  const openAddModal = () => {
    setEditingUser(null);
    setFormData({
      name: '',
      email: '',
      phone: '',
      company_name: '',
      password: '',
      role: 'user',
      status: 'active'
    });
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (u: User) => {
    setEditingUser(u);
    setFormData({
      name: u.name,
      email: u.email,
      phone: u.phone || '',
      company_name: u.company_name || u.companyName || '',
      password: '',
      role: u.role,
      status: u.status
    });
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setFormError('Please enter user name.');
      return;
    }
    if (!formData.email.trim() && !formData.phone.trim()) {
      setFormError('Please enter either Email or Phone Number.');
      return;
    }
    if (!editingUser && !formData.password.trim()) {
      setFormError('Please enter a password for the new user.');
      return;
    }

    const cleanPhone = formData.phone ? formData.phone.replace(/[^0-9]/g, '').slice(-10) : '';
    if (formData.phone.trim() && cleanPhone.length !== 10) {
      setFormError('Please enter a valid 10-digit Indian mobile number.');
      return;
    }

    if (cleanPhone) {
      const existingUserWithPhone = users.find(u => {
        if (editingUser && u.id === editingUser.id) return false;
        if (!u.phone) return false;
        const uClean = u.phone.replace(/[^0-9]/g, '').slice(-10);
        return uClean === cleanPhone;
      });
      if (existingUserWithPhone) {
        setFormError('This phone number is already in use');
        return;
      }
    }

    try {
      setSubmitting(true);
      setFormError(null);

      const payload = {
        name: formData.name.trim(),
        email: formData.email.trim(),
        phone: formData.phone.trim(),
        company_name: formData.company_name.trim(),
        role: formData.role,
        status: formData.status,
        ...(formData.password ? { password: formData.password } : {})
      };
      if (editingUser) {
        await api.updateUser(editingUser.id, payload);
      } else {
        await api.createUser(payload);
      }

      setIsModalOpen(false);
      fetchUsers();
    } catch (err: any) {
      setFormError(err.message || 'Operation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteUser = async (id: number) => {
    if (!confirm('Are you sure you want to delete this fleet user?')) return;
    try {
      await api.deleteUser(id);
      fetchUsers();
    } catch (err: any) {
      alert('Delete failed: ' + err.message);
    }
  };

  const totalUsers = users.length;
  const activeUsers = users.filter(u => u.status === 'active').length;
  const inactiveUsers = totalUsers - activeUsers;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgressText, setImportProgressText] = useState<string | null>(null);
  const [importSuccessMsg, setImportSuccessMsg] = useState<string | null>(null);
  const [importErrorMsg, setImportErrorMsg] = useState<string | null>(null);

  const parseExcelDate = (val: any): string => {
    if (!val) return new Date().toISOString().split('T')[0];
    if (typeof val === 'number') {
      const d = new Date(Math.round((val - 25569) * 86400 * 1000));
      return d.toISOString().split('T')[0];
    }
    const str = String(val).trim();
    if (/^\d{4}-\d{1,2}-\d{1,2}/.test(str)) {
      const parts = str.split('T')[0].split(' ')[0].split('-');
      return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    }
    if (str.includes('/')) {
      const parts = str.split('/');
      if (parts.length === 3) {
        const p1 = parseInt(parts[0], 10);
        const p2 = parseInt(parts[1], 10);
        const y = parts[2].length === 2 ? '20' + parts[2] : parts[2];
        if (p1 > 12) {
          return `${y}-${String(p2).padStart(2, '0')}-${String(p1).padStart(2, '0')}`;
        } else {
          return `${y}-${String(p1).padStart(2, '0')}-${String(p2).padStart(2, '0')}`;
        }
      }
    }
    return str;
  };

  const parseExcelTime = (val: any): string => {
    if (val === undefined || val === null || val === '') return '10:00:00';
    if (typeof val === 'number') {
      const totalSeconds = Math.round(val * 86400);
      const hours = Math.floor(totalSeconds / 3600) % 24;
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    const str = String(val).trim();
    const parts = str.split(':');
    if (parts.length >= 2) {
      const h = String(parseInt(parts[0], 10) || 0).padStart(2, '0');
      const m = String(parseInt(parts[1], 10) || 0).padStart(2, '0');
      const s = parts[2] ? String(parseInt(parts[2], 10) || 0).padStart(2, '0') : '00';
      return `${h}:${m}:${s}`;
    }
    return '10:00:00';
  };

  const parseSingleFleetExcel = async (file: File): Promise<{
    fileName: string;
    customerName: string;
    customerMobile: string;
    truckNumber: string;
    truckOwnerName: string;
    transactions: any[];
  }> => {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error(`File "${file.name}" contains no readable sheets.`);
    }

    // --- SHEET 0: User & Vehicle Details ---
    const s0Name = workbook.SheetNames[0];
    const ws0 = workbook.Sheets[s0Name];
    const rows0: any[][] = XLSX.utils.sheet_to_json(ws0, { header: 1 });

    let customerName = '';
    let customerMobile = '';
    let truckNumber = '';
    let truckOwnerName = '';

    // 1. Scan Key-Value Pairs (Row-by-Row in Column A & B)
    for (const r of rows0) {
      if (!Array.isArray(r) || r.length < 2) continue;
      const k = String(r[0] || '').toLowerCase().trim();
      const v = String(r[1] || '').trim();
      if (k.includes('customer name') || (k.includes('name') && !k.includes('owner') && !k.includes('truck'))) {
        if (v) customerName = v;
      } else if (k.includes('mobile') || k.includes('phone') || k.includes('contact')) {
        if (v) customerMobile = v;
      } else if (k.includes('truck number') || k.includes('vehicle number') || k.includes('truck no') || k.includes('vehicle no')) {
        if (v) truckNumber = v;
      } else if (k.includes('owner') || k.includes('company')) {
        if (v) truckOwnerName = v;
      }
    }

    // 2. Fallback: Check if horizontal table with headers on Row 0
    if (!customerName || !truckNumber || !customerMobile) {
      const json0: any[] = XLSX.utils.sheet_to_json(ws0);
      if (json0.length > 0) {
        const firstRow = json0[0];
        for (const [kRaw, vRaw] of Object.entries(firstRow)) {
          const k = kRaw.toLowerCase();
          const v = String(vRaw || '').trim();
          if (k.includes('customer name') || (k.includes('name') && !k.includes('owner'))) customerName = customerName || v;
          if (k.includes('mobile') || k.includes('phone')) customerMobile = customerMobile || v;
          if (k.includes('truck') && (k.includes('number') || k.includes('no'))) truckNumber = truckNumber || v;
          if (k.includes('owner')) truckOwnerName = truckOwnerName || v;
        }
      }
    }

    if (!customerName) {
      throw new Error(`File "${file.name}": Could not find "Customer Name" in Sheet 0.`);
    }
    if (!customerMobile) {
      throw new Error(`File "${file.name}": Could not find "Customer Mobile" in Sheet 0.`);
    }
    if (!truckNumber) {
      throw new Error(`File "${file.name}": Could not find "Truck Number" in Sheet 0.`);
    }

    // --- SHEET 1: FASTag Transactions & Tolls ---
    let parsedTransactions: any[] = [];
    if (workbook.SheetNames.length > 1) {
      const s1Name = workbook.SheetNames[1];
      const ws1 = workbook.Sheets[s1Name];
      const rows1: any[][] = XLSX.utils.sheet_to_json(ws1, { header: 1 });

      if (rows1.length > 1) {
        const headers = (rows1[0] || []).map((h: any) => String(h || '').toLowerCase().trim());
        const dateIdx = headers.findIndex((h: string) => h.includes('date'));
        const timeIdx = headers.findIndex((h: string) => h.includes('time'));
        const natureIdx = headers.findIndex((h: string) => h.includes('nature') || h.includes('type'));
        const amountIdx = headers.findIndex((h: string) => h.includes('amount') || h.includes('fare') || h.includes('tariff'));
        const balanceIdx = headers.findIndex((h: string) => h.includes('balance') || h.includes('closing'));
        const descIdx = headers.findIndex((h: string) => h.includes('desc') || h.includes('particular') || h.includes('plaza'));
        const txnIdIdx = headers.findIndex((h: string) => h.includes('transaction id') || h.includes('txn id') || (h.includes('id') && !h.includes('date') && !h.includes('time')));

        for (let i = 1; i < rows1.length; i++) {
          const row = rows1[i];
          if (!Array.isArray(row) || row.length === 0) continue;

          const rawDate = dateIdx >= 0 ? row[dateIdx] : row[0];
          const rawTime = timeIdx >= 0 ? row[timeIdx] : row[1];
          const rawNature = natureIdx >= 0 ? row[natureIdx] : row[2];
          const rawAmount = amountIdx >= 0 ? row[amountIdx] : row[3];
          const rawBalance = balanceIdx >= 0 ? row[balanceIdx] : row[4];
          const rawDesc = descIdx >= 0 ? row[descIdx] : row[5];
          const rawTxnId = txnIdIdx >= 0 ? row[txnIdIdx] : row[6];

          if (!rawDate && !rawAmount && !rawDesc) continue;

          const tDate = parseExcelDate(rawDate);
          const tTime = parseExcelTime(rawTime);
          const amount = parseFloat(String(rawAmount || '0').replace(/,/g, '')) || 0;
          const balance = parseFloat(String(rawBalance || '0').replace(/,/g, '')) || 0;
          const desc = String(rawDesc || '').trim();
          const txnId = String(rawTxnId || '').trim();

          parsedTransactions.push({
            transaction_date: tDate,
            transaction_time: tTime,
            crossing_time: `${tDate} ${tTime}`,
            nature: String(rawNature || 'Debit').trim(),
            amount,
            closing_balance: balance,
            description: desc,
            transaction_id: txnId
          });
        }
      }
    }

    return {
      fileName: file.name,
      customerName,
      customerMobile,
      truckNumber,
      truckOwnerName,
      transactions: parsedTransactions
    };
  };

  const handleExcelImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFiles = e.target.files;
    if (!rawFiles || rawFiles.length === 0) return;

    const files = Array.from(rawFiles);

    try {
      setIsImporting(true);
      setImportErrorMsg(null);
      setImportSuccessMsg(null);

      const parsedItems: any[] = [];
      const parseErrors: string[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setImportProgressText(`Reading file ${i + 1} of ${files.length} (${file.name})...`);
        try {
          const item = await parseSingleFleetExcel(file);
          parsedItems.push(item);
        } catch (err: any) {
          parseErrors.push(err.message || `Error reading ${file.name}`);
        }
      }

      if (parsedItems.length === 0) {
        throw new Error(parseErrors.join(' | ') || 'No valid Excel files could be parsed.');
      }

      setImportProgressText(`Saving ${parsedItems.length} file(s) into database...`);

      // Send to Backend API
      const res = await api.importFleetExcel(
        parsedItems.length === 1
          ? parsedItems[0]
          : { items: parsedItems }
      );

      // Refresh Users list immediately
      await fetchUsers();

      let successDetail = '';
      if (res.batch) {
        successDetail = `✅ Successfully imported ${res.filesCount} Excel file(s)! Allocated ${res.vehiclesCreated || parsedItems.length} vehicle(s) (${res.vehicles ? res.vehicles.join(', ') : ''}), and ${res.totalTransactions || 0} FASTag transactions recorded.`;
      } else {
        successDetail = `✅ Successfully imported Excel! User "${res.user?.name}" created, Vehicle "${res.vehicle?.registration_no}" allocated, and ${res.transactionsCount || 0} FASTag toll transactions recorded across dates.`;
      }

      if (parseErrors.length > 0) {
        successDetail += ` (Note: ${parseErrors.length} file(s) skipped due to errors: ${parseErrors.join('; ')})`;
      }

      setImportSuccessMsg(successDetail);
    } catch (err: any) {
      console.error('Import error:', err);
      setImportErrorMsg(err.message || 'Failed to import Excel files. Please verify sheet format.');
    } finally {
      setIsImporting(false);
      setImportProgressText(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const cleanEnteredPhone = formData.phone ? formData.phone.replace(/[^0-9]/g, '').slice(-10) : '';
  const duplicatePhoneUser = cleanEnteredPhone.length === 10
    ? users.find(u => (!editingUser || u.id !== editingUser.id) && u.phone && u.phone.replace(/[^0-9]/g, '').slice(-10) === cleanEnteredPhone)
    : null;

  return (
    <div className="p-4 sm:p-6 lg:p-7 space-y-4 max-w-7xl mx-auto w-full min-w-0 font-sans">
      {/* ONE LARGE UNIFIED MAIN CONTAINER (ALL-IN-ONE ENTERPRISE LAYOUT) */}
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-xs overflow-hidden">
        {/* Section 1: Top Header */}
        <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2.5">
              <UsersIcon className="w-6 h-6 text-[#0F172A]" />
              <span>Fleet User Management</span>
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Manage user accounts, company profiles, and vehicle allotments.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap self-start sm:self-auto">
            {/* Import Excel Files Option (Supports Single or Multi-File Batch Selection: 5, 10, 15+ files) */}
            <label className={`flex items-center gap-2 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer ${isImporting ? 'opacity-70 pointer-events-none' : ''}`}>
              {isImporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-200" />
              )}
              <span>{isImporting ? (importProgressText || 'Importing Excel Files...') : 'Import Excel Files'}</span>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".xlsx, .xls, .csv"
                onChange={handleExcelImport}
                className="hidden"
                disabled={isImporting}
              />
            </label>

            <button
              type="button"
              onClick={openAddModal}
              className="flex items-center gap-2 px-4 py-2 bg-[#E60012] hover:bg-[#CC0010] text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add New User</span>
            </button>
          </div>
        </div>

        {/* Import Feedback Notifications */}
        {importSuccessMsg && (
          <div className="mx-5 sm:mx-6 mb-2 p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{importSuccessMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setImportSuccessMsg(null)}
              className="text-emerald-700 hover:text-emerald-900 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {importErrorMsg && (
          <div className="mx-5 sm:mx-6 mb-2 p-3.5 rounded-2xl bg-red-50 border border-red-200 text-xs font-semibold text-red-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{importErrorMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setImportErrorMsg(null)}
              className="text-red-700 hover:text-red-900 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Thin divider with light red 10% opacity */}
        <div className="border-t border-[#E60012]/10" />

        {/* Section 2: Top Stat Cards (Inside Unified Container) */}
        <div className="p-5 sm:p-6 grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
          <div className="p-4 rounded-2xl bg-slate-50/70 border border-slate-100 flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Users</span>
              <div className="text-2xl font-black text-slate-900 mt-1 font-mono">{totalUsers}</div>
              <p className="text-[10px] text-slate-400 mt-0.5 font-medium">Registered fleet accounts</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center font-bold border border-slate-200 shrink-0">
              <UsersIcon className="w-5 h-5" />
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50/70 border border-slate-100 flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Active Users</span>
              <div className="text-2xl font-black text-emerald-600 mt-1 font-mono">{activeUsers}</div>
              <p className="text-[10px] text-emerald-600/80 mt-0.5 font-medium">Currently active</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100 shrink-0">
              <CheckCircle className="w-5 h-5" />
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50/70 border border-slate-100 flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Inactive Users</span>
              <div className="text-2xl font-black text-slate-700 mt-1 font-mono">{inactiveUsers}</div>
              <p className="text-[10px] text-slate-400 mt-0.5 font-medium">Deactivated accounts</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center border border-slate-200 shrink-0">
              <AlertCircle className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* Thin divider with light red 10% opacity */}
        <div className="border-t border-[#E60012]/10" />

        {/* Section 3: Filter and Search Bar */}
        <div className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50/40">
          <form onSubmit={handleSearchSubmit} className="flex-1 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by name, email, or phone..."
              className="w-full pl-9 pr-4 py-1.5 rounded-xl border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-slate-400 bg-white transition"
            />
          </form>

          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs text-slate-700 bg-white focus:outline-none focus:border-slate-400"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>

            <button
              type="button"
              onClick={fetchUsers}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 text-slate-700 text-xs font-bold rounded-xl border border-slate-200 transition cursor-pointer"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Thin divider with light red 10% opacity */}
        <div className="border-t border-[#E60012]/10" />

        {/* Section 4: Users Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="px-5 py-3.5">User</th>
                <th className="px-5 py-3.5">Role</th>
                <th className="px-5 py-3.5">Contact</th>
                <th className="px-5 py-3.5">Assigned Vehicles</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-slate-400 font-medium">
                    Loading users...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-slate-400 font-medium">
                    No users found matching criteria.
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const isCurrentUser = currentUser?.id === u.id;
                  const assignedList = u.assigned_vehicles || (u.assigned_reg_nos ? u.assigned_reg_nos.split(',').map((reg, idx) => ({ id: idx, registration_no: reg })) : []);
                  const hasAssigned = assignedList.length > 0;

                  return (
                    <tr key={u.id} className="hover:bg-slate-50/70 transition">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-extrabold text-xs shadow-xs"
                            style={{ backgroundColor: u.avatar_color || '#0F172A' }}
                          >
                            {u.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-extrabold text-slate-900 flex items-center gap-1.5">
                              <span>{u.name}</span>
                              {isCurrentUser && (
                                <span className="text-[9px] bg-[#F1F5F9] text-[#0F172A] px-1.5 py-0.5 rounded font-bold">You</span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono flex items-center gap-1">
                              <Mail className="w-3 h-3 text-slate-300" />
                              <span>{u.email}</span>
                            </div>
                            {(u.company_name || u.companyName) && (
                              <div className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                                <Building2 className="w-3 h-3 text-slate-400" />
                                <span>{u.company_name || u.companyName}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="px-5 py-3.5">
                        {u.role === 'admin' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                            <ShieldCheck className="w-3 h-3 text-amber-500" />
                            Super Admin
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-[#F8FAFC] text-slate-700 border border-[#E2E8F0]">
                            Fleet User
                          </span>
                        )}
                      </td>

                      <td className="px-5 py-3.5">
                        <div className="text-slate-700 font-mono text-[11px] flex items-center gap-1">
                          <Phone className="w-3 h-3 text-slate-300" />
                          <span>{u.phone || 'No phone'}</span>
                        </div>
                      </td>

                      <td className="px-5 py-3.5">
                        {hasAssigned ? (
                          <div className="relative inline-flex items-center gap-1.5 flex-nowrap">
                            {/* Always show the first vehicle badge in front */}
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#F1F5F9] text-[#0F172A] font-mono text-[10px] font-bold border border-emerald-200 whitespace-nowrap shadow-2xs"
                              title={assignedList[0].registration_no}
                            >
                              <Truck className="w-2.5 h-2.5 text-emerald-600" />
                              {assignedList[0].registration_no}
                            </span>

                            {/* Show More toggle if multiple vehicles are assigned */}
                            {assignedList.length > 1 && (
                              <div className="relative inline-block">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenVehiclePopoverId(openVehiclePopoverId === u.id ? null : u.id);
                                  }}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 font-mono text-[10px] font-bold border border-blue-200 transition cursor-pointer shadow-2xs whitespace-nowrap"
                                  title={`Click to view all ${assignedList.length} assigned vehicles`}
                                >
                                  <span>+{assignedList.length - 1} more</span>
                                  <ChevronDown className={`w-2.5 h-2.5 transition-transform ${openVehiclePopoverId === u.id ? 'rotate-180' : ''}`} />
                                </button>

                                {openVehiclePopoverId === u.id && (
                                  <>
                                    <div
                                      className="fixed inset-0 z-30 cursor-default"
                                      onClick={() => setOpenVehiclePopoverId(null)}
                                    />
                                    <div
                                      className="absolute left-0 sm:left-auto sm:right-0 top-full mt-1.5 z-40 bg-white rounded-xl shadow-xl border border-slate-200 p-2.5 min-w-[210px] max-w-[280px] animate-in fade-in zoom-in-95 duration-150"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-slate-100 text-[11px] font-bold text-slate-800">
                                        <span className="flex items-center gap-1">
                                          <Truck className="w-3 h-3 text-slate-600" />
                                          Assigned Vehicles ({assignedList.length})
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => setOpenVehiclePopoverId(null)}
                                          className="text-slate-400 hover:text-slate-600 p-0.5 rounded-md hover:bg-slate-100 cursor-pointer"
                                        >
                                          <X className="w-3 h-3" />
                                        </button>
                                      </div>
                                      <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto pr-0.5">
                                        {assignedList.map((v: any, vIdx: number) => (
                                          <span
                                            key={v.registration_no || vIdx}
                                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#F1F5F9] text-[#0F172A] font-mono text-[10px] font-bold border border-emerald-200"
                                          >
                                            <Truck className="w-2.5 h-2.5 text-emerald-600" />
                                            {v.registration_no}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 text-[11px] italic">None assigned</span>
                        )}
                      </td>

                      <td className="px-5 py-3.5">
                        {u.status === 'active' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                            Inactive
                          </span>
                        )}
                      </td>

                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => openEditModal(u)}
                            className="p-1.5 text-slate-500 hover:text-[#0F172A] hover:bg-[#F1F5F9] rounded-lg transition cursor-pointer"
                            title="Edit User"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          {!isCurrentUser && (
                            <button
                              type="button"
                              onClick={() => handleDeleteUser(u.id)}
                              className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition cursor-pointer"
                              title="Delete User"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit User Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  {editingUser ? 'Edit User Profile' : 'Add New Fleet User'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">Manage permissions and contact details</p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-700">
                {formError}
              </div>
            )}

            <form onSubmit={handleFormSubmit} autoComplete="off" className="space-y-4 text-xs">
              {/* Hidden dummy inputs to prevent browser password managers from auto-filling admin credentials */}
              <input type="text" name="prevent_autofill_user" tabIndex={-1} aria-hidden="true" className="hidden" />
              <input type="password" name="prevent_autofill_pwd" tabIndex={-1} aria-hidden="true" className="hidden" />

              <div>
                <label className="block font-bold text-slate-700 mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  name="user_full_name"
                  autoComplete="off"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Rajesh Sharma"
                  className="w-full px-3 py-2 rounded-xl border border-[#E2E8F0] text-slate-900 focus:outline-none focus:border-[#E60012]"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Email Address (Optional if Phone entered)</label>
                <input
                  type="email"
                  name="user_email_address_field"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck="false"
                  data-lpignore="true"
                  data-form-type="other"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="e.g. rajesh@logistics.com"
                  className="w-full px-3 py-2 rounded-xl border border-[#E2E8F0] text-slate-900 focus:outline-none focus:border-[#E60012]"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Company Name</label>
                <input
                  type="text"
                  name="user_company_name"
                  autoComplete="off"
                  value={formData.company_name}
                  onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                  placeholder="e.g. ABC Transports"
                  className="w-full px-3 py-2 rounded-xl border border-[#E2E8F0] text-slate-900 focus:outline-none focus:border-[#E60012]"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Phone Number</label>
                <input
                  type="text"
                  name="user_phone_number"
                  autoComplete="off"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="e.g. +91 98112 34567"
                  className={`w-full px-3 py-2 rounded-xl border text-slate-900 focus:outline-none transition ${duplicatePhoneUser ? 'border-red-500 bg-red-50/40 focus:border-red-600' : 'border-[#E2E8F0] focus:border-[#E60012]'}`}
                />
                {duplicatePhoneUser && (
                  <p className="text-xs text-red-600 font-semibold mt-1 flex items-center gap-1">
                    <span>⚠️ This phone number is already in use</span>
                  </p>
                )}
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {editingUser ? 'Password (Leave blank to keep unchanged)' : 'Password *'}
                </label>
                <input
                  type="password"
                  name="user_new_password_field"
                  autoComplete="new-password"
                  data-lpignore="true"
                  data-form-type="other"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 rounded-xl border border-[#E2E8F0] text-slate-900 focus:outline-none focus:border-[#E60012]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Account Role</label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#E2E8F0] bg-white font-medium text-slate-800 focus:outline-none focus:border-[#E60012]"
                  >
                    <option value="user">Fleet User</option>
                    <option value="admin">Super Admin (Full Access)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#E2E8F0] bg-white font-medium text-slate-800 focus:outline-none focus:border-[#E60012]"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div className="pt-4 border-t border-[#E2E8F0] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-[#E2E8F0] text-slate-600 font-bold hover:bg-[#F8FAFC] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-[#E60012] hover:bg-[#CC0010] text-white font-bold transition shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? 'Saving...' : editingUser ? 'Update User' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
