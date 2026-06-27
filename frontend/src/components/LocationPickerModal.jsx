import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Search, X, LocateFixed, Check, MapPin } from 'lucide-react';

function SearchDropdown({ anchorRef, results, onSelect }) {
  const [rect, setRect] = useState(null);
  useEffect(() => {
    if (!anchorRef.current) return;
    const update = () => setRect(anchorRef.current.getBoundingClientRect());
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchorRef]);
  if (!rect) return null;
  return createPortal(
    <div style={{
      position: 'fixed',
      top: rect.bottom + 6,
      left: rect.left,
      width: rect.width,
      background: 'rgba(28,28,30,0.98)',
      backdropFilter: 'blur(20px)',
      border: '0.5px solid rgba(84,84,88,0.6)',
      borderRadius: 12,
      overflow: 'hidden',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      zIndex: 999999,
    }}>
      {results.map((r, i) => (
        <button
          key={i}
          onMouseDown={(e) => { e.preventDefault(); onSelect(r); }}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 14px', background: 'transparent', border: 'none',
            borderBottom: i < results.length - 1 ? '0.5px solid rgba(84,84,88,0.35)' : 'none',
            cursor: 'pointer', textAlign: 'left',
          }}
        >
          <MapPin size={14} color="#0A84FF" style={{ flexShrink: 0 }} />
          <span style={{ color: '#fff', fontSize: 13, fontFamily: 'Inter, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.display_name}
          </span>
        </button>
      ))}
    </div>,
    document.body
  );
}

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

const pickerIcon = L.divIcon({
  className: '',
  html: `<div style="width:32px;height:32px;border-radius:50% 50% 50% 0;background:#FF453A;transform:rotate(-45deg);box-shadow:0 3px 12px rgba(255,69,58,0.7);border:2px solid white;position:relative;">
    <div style="width:12px;height:12px;background:#fff;border-radius:50%;position:absolute;top:8px;left:8px;"></div>
  </div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
});

function DraggableMarker({ position, onMove }) {
  const markerRef = useRef(null);
  useMapEvents({
    click(e) {
      onMove(e.latlng);
    },
  });
  return (
    <Marker
      position={position}
      icon={pickerIcon}
      draggable
      ref={markerRef}
      eventHandlers={{
        dragend() {
          const m = markerRef.current;
          if (m) onMove(m.getLatLng());
        },
      }}
    />
  );
}

function FlyTo({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, 16, { animate: true, duration: 0.8 });
  }, [target, map]);
  return null;
}

export default function LocationPickerModal({ initialLocation, onConfirm, onClose }) {
  const defaultPos = initialLocation || [28.6139, 77.209];
  const [markerPos, setMarkerPos] = useState(defaultPos);
  const [flyTarget, setFlyTarget] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const debounceRef = useRef(null);
  const searchInputRef = useRef(null);

  const handleSearch = useCallback(async (q) => {
    if (q.length < 2) { setSearchResults([]); setSearchOpen(false); return; }
    setIsSearching(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/geocode?q=${encodeURIComponent(q)}&limit=5`);
      const data = await res.json();
      setSearchResults(Array.isArray(data) ? data : []);
      setSearchOpen(true);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchQuery(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => handleSearch(val), 350);
  };

  const handleResultSelect = (r) => {
    const pos = [parseFloat(r.lat), parseFloat(r.lon)];
    setMarkerPos(pos);
    setFlyTarget(pos);
    setSearchQuery(r.display_name);
    setSearchOpen(false);
    setSearchResults([]);
  };

  const handleGPS = () => {
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = [pos.coords.latitude, pos.coords.longitude];
        setMarkerPos(p);
        setFlyTarget(p);
        setIsLocating(false);
      },
      () => setIsLocating(false),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const isDesktop = window.innerWidth >= 768;

  const modalStyle = isDesktop
    ? {
        position: 'fixed', inset: 0, zIndex: 4000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(12px)',
        animation: 'fadeIn 0.2s ease',
      }
    : {
        position: 'fixed', inset: 0, zIndex: 4000,
        background: 'rgba(0,0,0,0.85)',
        animation: 'fadeIn 0.15s ease',
      };

  const panelStyle = isDesktop
    ? {
        width: 680, height: 540,
        background: 'var(--ios-bg2)',
        borderRadius: 20,
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        border: '0.5px solid rgba(84,84,88,0.5)',
        animation: 'scaleIn 0.25s cubic-bezier(0.34,1.56,0.64,1)',
      }
    : {
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        background: 'var(--ios-bg)',
      };

  return createPortal(
    <div style={modalStyle} onClick={isDesktop ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined}>
      <div style={panelStyle}>
        <div style={{
          padding: '14px 16px 10px',
          background: 'var(--ios-glass)',
          backdropFilter: 'blur(20px)',
          borderBottom: '0.5px solid rgba(84,84,88,0.4)',
          flexShrink: 0,
          zIndex: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#fff', fontFamily: 'Inter, sans-serif' }}>
              📍 Pick Hazard Location
            </span>
            <button
              onClick={onClose}
              style={{ background: 'rgba(84,84,88,0.4)', border: 'none', borderRadius: '50%', width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              <X size={15} color="rgba(235,235,245,0.8)" />
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div ref={searchInputRef} style={{ position: 'relative', flex: 1 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'rgba(44,44,46,0.9)',
                border: '0.5px solid rgba(84,84,88,0.6)',
                borderRadius: 10, padding: '0 12px', height: 40,
              }}>
                {isSearching
                  ? <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid #0A84FF', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
                  : <Search size={15} color="rgba(235,235,245,0.4)" style={{ flexShrink: 0 }} />
                }
                <input
                  value={searchQuery}
                  onChange={handleSearchChange}
                  onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
                  placeholder="Search location..."
                  style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: 14, fontFamily: 'Inter, sans-serif' }}
                />
                {searchQuery && (
                  <button onClick={() => { setSearchQuery(''); setSearchResults([]); setSearchOpen(false); }} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex' }}>
                    <X size={13} color="rgba(235,235,245,0.5)" />
                  </button>
                )}
              </div>
              {searchOpen && searchResults.length > 0 && (
                <SearchDropdown
                  anchorRef={searchInputRef}
                  results={searchResults}
                  onSelect={handleResultSelect}
                />
              )}
            </div>
            <button
              onClick={handleGPS}
              disabled={isLocating}
              title="Use my GPS location"
              style={{
                width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                background: isLocating ? 'rgba(10,132,255,0.2)' : 'rgba(10,132,255,0.15)',
                border: '0.5px solid rgba(10,132,255,0.4)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {isLocating
                ? <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid #0A84FF', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
                : <LocateFixed size={17} color="#0A84FF" />
              }
            </button>
          </div>
        </div>
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          <MapContainer
            center={defaultPos}
            zoom={14}
            zoomControl={false}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
            <FlyTo target={flyTarget} />
            <DraggableMarker position={markerPos} onMove={(ll) => setMarkerPos([ll.lat, ll.lng])} />
          </MapContainer>
          <div style={{
            position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(28,28,30,0.9)', backdropFilter: 'blur(12px)',
            border: '0.5px solid rgba(84,84,88,0.5)',
            borderRadius: 20, padding: '6px 14px',
            fontSize: 12, fontWeight: 500, color: 'rgba(235,235,245,0.75)',
            fontFamily: 'Inter, sans-serif', zIndex: 1000, whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}>
            {markerPos[0].toFixed(5)}, {markerPos[1].toFixed(5)}
          </div>
        </div>
        <div style={{
          flexShrink: 0, padding: '12px 16px',
          paddingBottom: isDesktop ? 12 : 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
          background: 'var(--ios-glass)',
          backdropFilter: 'blur(20px)',
          borderTop: '0.5px solid rgba(84,84,88,0.4)',
          display: 'flex', gap: 10,
        }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: '13px 0', borderRadius: 12, border: '0.5px solid rgba(84,84,88,0.5)',
              background: 'rgba(44,44,46,0.8)', color: 'rgba(235,235,245,0.75)',
              fontSize: 15, fontWeight: 600, fontFamily: 'Inter, sans-serif', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm({ lat: markerPos[0], lon: markerPos[1] })}
            style={{
              flex: 2, padding: '13px 0', borderRadius: 12, border: 'none',
              background: '#0A84FF', color: 'white',
              fontSize: 15, fontWeight: 600, fontFamily: 'Inter, sans-serif', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              boxShadow: '0 4px 16px rgba(10,132,255,0.4)',
            }}
          >
            <Check size={16} /> Confirm Location
          </button>
        </div>
      </div>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scaleIn { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>,
    document.body
  );
}
