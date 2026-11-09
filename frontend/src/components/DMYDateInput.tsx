import React, { useRef } from 'react';
import { Calendar } from 'lucide-react';

export const normalizeToYMD = (val?: string): string => {
  if (!val) return '';
  const clean = val.trim();
  // If DD/MM/YYYY or DD-MM-YYYY
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/.test(clean)) {
    const parts = clean.split(/[\/\-]/);
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2].slice(0, 4);
    return `${year}-${month}-${day}`;
  }
  // If YYYY-MM-DD
  if (/^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/.test(clean)) {
    const parts = clean.split(/[\/\-]/);
    const year = parts[0];
    const month = parts[1].padStart(2, '0');
    const day = parts[2].slice(0, 2).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return clean.slice(0, 10);
};

export const formatToDMY = (val?: string): string => {
  if (!val) return '';
  const ymd = normalizeToYMD(val);
  if (!ymd || ymd.length < 10) return val;
  const parts = ymd.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return val;
};

interface DMYDateInputProps {
  value: string;
  onChange: (isoDate: string) => void;
  className?: string;
  min?: string;
  max?: string;
}

export const DMYDateInput: React.FC<DMYDateInputProps> = ({
  value,
  onChange,
  className = '',
  min,
  max
}) => {
  const hiddenInputRef = useRef<HTMLInputElement>(null);

  const parseDate = (val?: string) => {
    const ymd = normalizeToYMD(val);
    if (ymd && ymd.length >= 10) {
      const parts = ymd.split('-');
      return {
        year: parts[0],
        month: parts[1],
        day: parts[2]
      };
    }
    const today = new Date();
    return {
      day: String(today.getDate()).padStart(2, '0'),
      month: String(today.getMonth() + 1).padStart(2, '0'),
      year: String(today.getFullYear())
    };
  };

  const { day, month, year } = parseDate(value);

  const days = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));
  const months = [
    { num: '01', label: '01' },
    { num: '02', label: '02' },
    { num: '03', label: '03' },
    { num: '04', label: '04' },
    { num: '05', label: '05' },
    { num: '06', label: '06' },
    { num: '07', label: '07' },
    { num: '08', label: '08' },
    { num: '09', label: '09' },
    { num: '10', label: '10' },
    { num: '11', label: '11' },
    { num: '12', label: '12' }
  ];
  const years = ['2024', '2025', '2026', '2027', '2028', '2029', '2030'];

  const emitDate = (d: string, m: string, y: string) => {
    let numD = parseInt(d, 10);
    const numM = parseInt(m, 10);
    const numY = parseInt(y, 10);
    const maxDays = new Date(numY, numM, 0).getDate();
    if (numD > maxDays) numD = maxDays;
    const cleanD = String(numD).padStart(2, '0');
    const iso = `${y}-${m}-${cleanD}`;
    onChange(iso);
  };

  const isoValue = `${year}-${month}-${day}`;

  return (
    <div className={`inline-flex items-center gap-0.5 font-mono text-xs ${className}`}>
      {/* Hidden native input for calendar picker */}
      <input
        ref={hiddenInputRef}
        type="date"
        value={isoValue}
        min={min}
        max={max}
        onChange={(e) => {
          if (e.target.value) {
            onChange(e.target.value);
          }
        }}
        className="sr-only"
        tabIndex={-1}
      />

      {/* DD (Day) */}
      <select
        value={day}
        onChange={(e) => emitDate(e.target.value, month, year)}
        className="bg-transparent font-bold text-slate-800 focus:outline-none cursor-pointer py-0.5 px-0.5 rounded hover:bg-slate-100"
        title="Day (DD)"
      >
        {days.map(d => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>
      <span className="text-slate-400 font-bold select-none">/</span>

      {/* MM (Month) */}
      <select
        value={month}
        onChange={(e) => emitDate(day, e.target.value, year)}
        className="bg-transparent font-bold text-slate-800 focus:outline-none cursor-pointer py-0.5 px-0.5 rounded hover:bg-slate-100"
        title="Month (MM)"
      >
        {months.map(m => (
          <option key={m.num} value={m.num}>{m.num}</option>
        ))}
      </select>
      <span className="text-slate-400 font-bold select-none">/</span>

      {/* YYYY (Year) */}
      <select
        value={year}
        onChange={(e) => emitDate(day, month, e.target.value)}
        className="bg-transparent font-bold text-slate-800 focus:outline-none cursor-pointer py-0.5 px-0.5 rounded hover:bg-slate-100"
        title="Year (YYYY)"
      >
        {years.map(y => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>

      {/* Calendar Picker Trigger */}
      <button
        type="button"
        onClick={() => {
          try {
            hiddenInputRef.current?.showPicker();
          } catch (_) {
            hiddenInputRef.current?.click();
          }
        }}
        className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
        title="Open Calendar (DD/MM/YYYY)"
      >
        <Calendar className="w-3.5 h-3.5 text-slate-500" />
      </button>
    </div>
  );
};

