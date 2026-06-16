import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Navigation, LocateFixed, X, Search, MapPin } from 'lucide-react';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

function useGeocodeSearch() {
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const timer = useRef(null);

  const search = useCallback(async (q) => {
    if (q.length < 2) { setResults([]); return; }
    setIsSearching(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/geocode?q=${encodeURIComponent(q)}&limit=4`);
      const data = await res.json();
      setResults(Array.isArray(data) ? data : []);
    } catch { setResults([]); }
    finally { setIsSearching(false); }
  }, []);

  const debounced = useCallback((q) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => search(q), 350);
  }, [search]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { results, isSearching, debounced, clearResults: () => setResults([]) };
}

export default function DirectionsPanel({ destination, userLocation, onFetchRoute, onDrive, onClose, isLoading, routeData }) {
  const [useGPS, setUseGPS] = useState(true);
  const [manualStart, setManualStart] = useState('');
  const [manualStartCoords, setManualStartCoords] = useState(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const { results, isSearching, debounced, clearResults } = useGeocodeSearch();

  const canGetDirections = useGPS ? !!userLocation : !!manualStartCoords;
  const canDrive = useGPS && !!userLocation;

  const handleGetDirections = () => {
    if (!destination) return;
    const start = useGPS ? userLocation : manualStartCoords ? [manualStartCoords.lat, manualStartCoords.lon] : null;
    if (!start) return;
    onFetchRoute(start, [destination.lat, destination.lon]);
  };

  const handleManualChange = (e) => {
    const val = e.target.value;
    setManualStart(val);
    setManualStartCoords(null);
    debounced(val);
    setShowDropdown(true);
  };

  const handleSelectResult = (r) => {
    setManualStart(r.display_name);
    setManualStartCoords(r);
    clearResults();
    setShowDropdown(false);
  };

  const switchToGPS = () => {
    setUseGPS(true);
    setManualStart('');
    setManualStartCoords(null);
    clearResults();
    setShowDropdown(false);
  };

  const switchToManual = () => {
    setUseGPS(false);
    setTimeout(() => document.getElementById('manual-start-input')?.focus(), 50);
  };

  const formatDist = (m) => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
  const formatDur = (s) => {
    const m = Math.round(s / 60);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1299, background: 'rgba(0,0,0,0.3)' }} />
      <div style={{
        position: 'fixed', bottom: 'calc(82px + env(safe-area-inset-bottom, 0px))',
        left: 0, right: 0, zIndex: 1300,
        background: 'rgba(28,28,30,0.97)', backdropFilter: 'blur(24px)',
        borderRadius: '20px 20px 0 0', border: '0.5px solid rgba(84,84,88,0.65)',
        boxShadow: '0 -8px 40px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 8px' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(84,84,88,0.65)' }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px 14px' }}>
          <span style={{ fontSize: 17, fontWeight: 600, color: '#fff', fontFamily: 'Inter, sans-serif' }}>Directions</span>
          <button onClick={onClose} style={{ background: 'rgba(84,84,88,0.4)', border: 'none', borderRadius: '50%', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <X size={14} color="rgba(235,235,245,0.8)" />
          </button>
        </div>

        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 16 }}>
          <div style={{ background: 'rgba(44,44,46,0.8)', borderRadius: 14, overflow: 'visible', border: '0.5px solid rgba(84,84,88,0.4)', position: 'relative' }}>
            <div style={{ borderBottom: '0.5px solid rgba(84,84,88,0.4)', overflow: 'visible' }}>
              {useGPS ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px' }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(10,132,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <LocateFixed size={16} color="#0A84FF" />
                  </div>
                  <span style={{ flex: 1, fontSize: 15, color: '#fff', fontFamily: 'Inter, sans-serif' }}>My Location</span>
                  <button
                    onClick={switchToManual}
                    style={{ background: 'rgba(84,84,88,0.35)', border: 'none', borderRadius: 8, padding: '5px 10px', color: 'rgba(235,235,245,0.7)', fontSize: 12, fontFamily: 'Inter, sans-serif', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px' }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,159,10,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {isSearching
                        ? <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid #FF9F0A', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
                        : <Search size={15} color="#FF9F0A" />
                      }
                    </div>
                    <input
                      id="manual-start-input"
                      value={manualStart}
                      onChange={handleManualChange}
                      onFocus={() => results.length > 0 && setShowDropdown(true)}
                      placeholder="Enter start location..."
                      style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: 15, fontFamily: 'Inter, sans-serif' }}
                    />
                    <button
                      onClick={switchToGPS}
                      style={{ background: 'rgba(10,132,255,0.15)', border: 'none', borderRadius: 8, padding: '5px 10px', color: '#0A84FF', fontSize: 12, fontFamily: 'Inter, sans-serif', cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <LocateFixed size={12} /> GPS
                    </button>
                  </div>
                  {showDropdown && results.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'rgba(28,28,30,0.99)', border: '0.5px solid rgba(84,84,88,0.5)', borderRadius: '0 0 12px 12px', zIndex: 10, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                      {results.map((r, i) => (
                        <button
                          key={i}
                          onClick={() => handleSelectResult(r)}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'transparent', border: 'none', borderBottom: i < results.length - 1 ? '0.5px solid rgba(84,84,88,0.3)' : 'none', cursor: 'pointer', textAlign: 'left' }}
                        >
                          <MapPin size={13} color="#FF9F0A" style={{ flexShrink: 0 }} />
                          <span style={{ color: 'rgba(235,235,245,0.9)', fontSize: 13, fontFamily: 'Inter, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.display_name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px' }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(48,209,88,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Navigation size={16} color="#30D158" />
              </div>
              <span style={{ flex: 1, fontSize: 15, color: '#fff', fontFamily: 'Inter, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {destination?.display_name || 'Destination'}
              </span>
            </div>
          </div>

          {!routeData ? (
            <button
              onClick={handleGetDirections}
              disabled={isLoading || !canGetDirections}
              style={{
                width: '100%', padding: 14, borderRadius: 12, border: 'none',
                background: canGetDirections ? '#0A84FF' : 'rgba(84,84,88,0.4)',
                color: 'white', fontSize: 16, fontWeight: 600, fontFamily: 'Inter, sans-serif',
                cursor: canGetDirections ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'background 0.2s ease',
              }}
            >
              {isLoading
                ? <><div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.4)', borderTopColor: 'white', animation: 'spin 0.7s linear infinite' }} /> Calculating...</>
                : <><Navigation size={16} /> Get Directions</>
              }
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, background: 'rgba(44,44,46,0.8)', borderRadius: 12, padding: '12px 14px', border: '0.5px solid rgba(84,84,88,0.4)', textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', fontFamily: 'Inter, sans-serif' }}>{formatDist(routeData.distance)}</div>
                <div style={{ fontSize: 11, color: 'rgba(235,235,245,0.45)', marginTop: 2, fontFamily: 'Inter, sans-serif' }}>distance</div>
              </div>
              <div style={{ flex: 1.4, background: 'rgba(44,44,46,0.8)', borderRadius: 12, padding: '10px 14px', border: '0.5px solid rgba(84,84,88,0.4)', textAlign: 'center' }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: '#fff', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap' }}>
                  {formatDur(routeData.duration_optimistic)} – {formatDur(routeData.duration_pessimistic)}
                </div>
                <div style={{ fontSize: 10, color: 'rgba(235,235,245,0.4)', marginTop: 2, fontFamily: 'Inter, sans-serif' }}>ETA (with traffic)</div>
              </div>
              {canDrive ? (
                <button
                  onClick={onDrive}
                  style={{ flex: 1, borderRadius: 12, border: 'none', background: '#30D158', color: 'white', fontSize: 15, fontWeight: 700, fontFamily: 'Inter, sans-serif', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }}
                >
                  <Navigation size={20} fill="white" strokeWidth={0} />
                  <span style={{ fontSize: 12 }}>Drive</span>
                </button>
              ) : (
                <div style={{ flex: 1, borderRadius: 12, border: '0.5px solid rgba(84,84,88,0.4)', background: 'rgba(44,44,46,0.5)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, padding: 8 }}>
                  <Navigation size={18} color="rgba(235,235,245,0.25)" strokeWidth={1.5} />
                  <span style={{ fontSize: 10, color: 'rgba(235,235,245,0.3)', fontFamily: 'Inter, sans-serif', textAlign: 'center', lineHeight: 1.3 }}>GPS needed</span>
                </div>
              )}
            </div>
          )}
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </>
  );
}
