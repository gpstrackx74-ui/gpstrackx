import React, { useState, useEffect, useRef } from 'react';
import { Search, MapPin, X, Loader2 } from 'lucide-react';

interface LocationResult {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

interface LocationSearchInputProps {
  label: string;
  placeholder: string;
  value: string;
  onSelectLocation: (loc: LocationResult) => void;
  onClear?: () => void;
  onPinOnMapClick?: () => void;
  isPinModeActive?: boolean;
  pinBadgeColor?: string;
  pinBadgeText?: string;
}

export const LocationSearchInput: React.FC<LocationSearchInputProps> = ({
  label,
  placeholder,
  value,
  onSelectLocation,
  onClear,
  onPinOnMapClick,
  isPinModeActive = false,
  pinBadgeColor = '#EF4444',
  pinBadgeText = 'Pin'
}) => {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<LocationResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isUserTypingRef = useRef(false);

  useEffect(() => {
    isUserTypingRef.current = false;
    setQuery(value);
    setIsOpen(false);
  }, [value]);

  // Click or touch outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        isUserTypingRef.current = false;
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        isUserTypingRef.current = false;
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      window.removeEventListener('keydown', handleEscape);
    };
  }, []);

  // Debounced search query - ONLY triggers when the user is actively typing!
  useEffect(() => {
    if (!isUserTypingRef.current || !query || query.trim().length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/locations/search?q=${encodeURIComponent(query.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data);
          // Only pop open if the user is currently focused and typing in this input
          if (isUserTypingRef.current && document.activeElement === inputRef.current) {
            setIsOpen(true);
          }
        }
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  const handleSelect = (item: LocationResult) => {
    isUserTypingRef.current = false;
    setQuery(item.name);
    setResults([]);
    setIsOpen(false);
    onSelectLocation(item);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (results.length > 0) {
        handleSelect(results[0]);
      }
    }
  };

  return (
    <div ref={wrapperRef} className="relative w-full space-y-1">
      <div className="flex items-center justify-between text-xs">
        <label className="font-bold text-slate-800 flex items-center gap-1.5">
          <span 
            className="w-2.5 h-2.5 rounded-full inline-block shrink-0" 
            style={{ backgroundColor: pinBadgeColor }} 
          />
          <span>{label}</span>
        </label>

        {onPinOnMapClick && (
          <button
            type="button"
            onClick={onPinOnMapClick}
            className={`px-2.5 py-0.5 rounded-lg text-[10px] font-bold transition flex items-center gap-1 ${
              isPinModeActive 
                ? 'bg-slate-900 text-white shadow-xs' 
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
            title="Click to place pin anywhere on Google Maps"
          >
            <MapPin className="w-3 h-3" />
            <span>{isPinModeActive ? 'Click on Map...' : 'Pin on Map'}</span>
          </button>
        )}
      </div>

      <div className="relative flex items-center">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            const val = e.target.value;
            isUserTypingRef.current = true;
            setQuery(val);
            if (val.trim().length === 0) {
              setIsOpen(false);
              setResults([]);
              if (onClear) onClear();
            } else if (val.trim().length < 2) {
              setIsOpen(false);
            }
          }}
          onFocus={() => {
            if (isUserTypingRef.current && results.length > 0) {
              setIsOpen(true);
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full pl-9 pr-8 py-2 rounded-xl border border-slate-200 font-medium text-xs text-slate-900 bg-white placeholder:text-slate-400 focus:outline-none focus:border-slate-800 focus:ring-1 focus:ring-slate-100 transition shadow-xs"
        />

        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setResults([]);
              setIsOpen(false);
              if (onClear) onClear();
              inputRef.current?.focus();
            }}
            className="absolute right-2.5 text-slate-400 hover:text-slate-600 p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Real-Time Dropdown Suggestions */}
      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1.5 bg-white rounded-2xl shadow-xl border border-slate-200 max-h-64 overflow-y-auto z-50 p-1.5 space-y-1">
          {loading && (
            <div className="flex items-center justify-center p-3 text-xs text-slate-400 gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-700" />
              <span>Searching real-time locations...</span>
            </div>
          )}

          {!loading && results.length === 0 && (
            <div className="p-3 text-center text-xs text-slate-400">
              No matching locations found for "{query}". You can click "Pin on Map" to choose directly.
            </div>
          )}

          {!loading && results.map((item, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleSelect(item)}
              className="w-full text-left p-2.5 rounded-xl hover:bg-slate-50 flex items-start gap-2.5 transition group"
            >
              <div className="w-6 h-6 rounded-lg bg-slate-100 group-hover:bg-slate-200 flex items-center justify-center text-slate-500 shrink-0 mt-0.5">
                <MapPin className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <p className="font-extrabold text-xs text-slate-900 truncate">
                    {item.name}
                  </p>
                  <div className="flex items-center gap-1.5 shrink-0 ml-1">
                    <span className="px-1.5 py-0.2 rounded-md bg-emerald-50 text-[9px] font-bold text-emerald-700 border border-emerald-200/60">
                      India
                    </span>
                    <span className="font-mono text-[10px] text-slate-400">
                      {item.lat.toFixed(2)}, {item.lng.toFixed(2)}
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5 leading-snug">
                  {item.address}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

