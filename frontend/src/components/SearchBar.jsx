import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Search, X, MapPin } from 'lucide-react';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

export default function SearchBar({ onDestinationSelect, onClear }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const debounceTimer = useRef(null);
  const inputRef = useRef(null);

  const search = useCallback(async (q) => {
    if (q.length < 2) { setResults([]); setIsOpen(false); return; }
    setIsLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/geocode?q=${encodeURIComponent(q)}&limit=5`);
      const data = await res.json();
      setResults(Array.isArray(data) ? data : []);
      setIsOpen(true);
    } catch {
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => search(val), 350);
  };

  const handleSelect = (result) => {
    setQuery(result.display_name);
    setIsOpen(false);
    setResults([]);
    onDestinationSelect(result);
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setIsOpen(false);
    onClear?.();
    inputRef.current?.focus();
  };

  useEffect(() => () => clearTimeout(debounceTimer.current), []);

  return (
    <div style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 16px)', left: 16, right: 16, zIndex: 1200 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        background: 'rgba(28,28,30,0.92)', backdropFilter: 'blur(20px)',
        border: '0.5px solid rgba(84,84,88,0.65)', borderRadius: 14,
        padding: '0 14px', height: 48,
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
      }}>
        {isLoading
          ? <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid #0A84FF', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
          : <Search size={18} color="rgba(235,235,245,0.4)" style={{ flexShrink: 0 }} />
        }
        <input
          ref={inputRef}
          value={query}
          onChange={handleChange}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          placeholder="Search destination..."
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: '#fff', fontSize: 16, fontFamily: 'Inter, sans-serif',
            fontWeight: 400,
          }}
        />
        {query.length > 0 && (
          <button onClick={handleClear} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(84,84,88,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={12} color="rgba(235,235,245,0.8)" />
            </div>
          </button>
        )}
      </div>

      {isOpen && results.length > 0 && (
        <div style={{
          marginTop: 8, background: 'rgba(28,28,30,0.96)', backdropFilter: 'blur(20px)',
          border: '0.5px solid rgba(84,84,88,0.65)', borderRadius: 14,
          overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}>
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => handleSelect(r)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 16px', background: 'transparent', border: 'none',
                borderBottom: i < results.length - 1 ? '0.5px solid rgba(84,84,88,0.4)' : 'none',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(10,132,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <MapPin size={16} color="#0A84FF" />
              </div>
              <span style={{ color: '#fff', fontSize: 14, fontFamily: 'Inter, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.display_name}
              </span>
            </button>
          ))}
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
