import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Polyline, Polygon, CircleMarker, useMapEvents, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import {
  LogOut, AlertTriangle, CheckCircle, XCircle, ChevronRight, ChevronLeft,
  RefreshCw, Edit3, Trash2, Plus, Shield, Map, Eye, Filter,
  Building2, User, Key, Globe, Check, X, ImageIcon, LocateFixed,
} from 'lucide-react';
import { supabase } from '../supabaseClient';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const HAZARD_EMOJI = { pothole: '🕳️', crack: '⚡', waterlogging: '💧', debris: '🪨' };
const STATUS_COLOR = {
  under_review: { bg: 'rgba(255,159,10,0.15)', border: 'rgba(255,159,10,0.4)', text: '#FF9F0A' },
  verified: { bg: 'rgba(48,209,88,0.15)', border: 'rgba(48,209,88,0.4)', text: '#30D158' },
  rejected: { bg: 'rgba(255,69,58,0.15)', border: 'rgba(255,69,58,0.4)', text: '#FF453A' },
  reported: { bg: 'rgba(10,132,255,0.15)', border: 'rgba(10,132,255,0.4)', text: '#0A84FF' },
  repaired: { bg: 'rgba(99,99,102,0.2)', border: 'rgba(99,99,102,0.4)', text: 'rgba(235,235,245,0.5)' },
};
const MAP_ACCESS_LABEL = { road_only: 'Road Data Only', infrastructure: 'Infrastructure', full: 'Full Access' };

function StatusBadge({ status }) {
  const c = STATUS_COLOR[status] || STATUS_COLOR.reported;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
      letterSpacing: 0.3, textTransform: 'uppercase',
    }}>
      {status?.replace('_', ' ')}
    </span>
  );
}

function ZoomController() {
  const map = useMap();
  return (
    <div style={{
      position: 'absolute', top: 10, right: 10, zIndex: 1000,
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      {['+', '−'].map((sym, i) => (
        <button
          key={sym}
          type="button"
          onClick={() => i === 0 ? map.zoomIn() : map.zoomOut()}
          style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'rgba(28,28,30,0.92)', border: '1px solid rgba(255,255,255,0.15)',
            color: '#fff', fontSize: 18, fontWeight: 400, lineHeight: 1,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          }}
        >{sym}</button>
      ))}
    </div>
  );
}

function DrawHandler({ mode, points, onAddPoint, onClose }) {
  const map = useMap();
  useMapEvents({
    click(e) {
      if (mode !== 'draw') return;
      if (points.length >= 3) {
        const first = map.latLngToContainerPoint(points[0]);
        const clicked = map.latLngToContainerPoint(e.latlng);
        if (first.distanceTo(clicked) < 18) { onClose(); return; }
      }
      onAddPoint(e.latlng);
    },
  });
  return null;
}

function AreaMapPicker({ onAreaChange }) {
  const [mode, setMode] = useState('hand');
  const [points, setPoints] = useState([]);
  const [closed, setClosed] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchTimer = useRef(null);

  const emitGeoJSON = (pts, isClosed) => {
    if (pts.length < 3 || !isClosed) { onAreaChange(null); return; }
    const coords = [...pts.map(p => [p.lng, p.lat]), [pts[0].lng, pts[0].lat]];
    onAreaChange(JSON.stringify({ type: 'Polygon', coordinates: [coords] }));
  };

  const handleAddPoint = (latlng) => {
    if (closed) return;
    setPoints(prev => { const next = [...prev, latlng]; emitGeoJSON(next, false); return next; });
  };

  const handleClose = () => {
    setClosed(true);
    setPoints(prev => { emitGeoJSON(prev, true); return prev; });
  };

  const clearDrawing = () => {
    setPoints([]); setClosed(false); onAreaChange(null);
  };

  const searchPlace = async (q) => {
    if (!q.trim()) { setResults([]); setShowResults(false); return; }
    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&polygon_geojson=1&limit=6`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const data = await res.json();
      setResults(data);
      setShowResults(true);
    } catch { setResults([]); }
    setSearching(false);
  };

  const handleSearchInput = (e) => {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => searchPlace(val), 420);
  };

  const selectResult = (item) => {
    setShowResults(false);
    setQuery(item.display_name.split(',')[0]);
    const geo = item.geojson;
    if (geo && (geo.type === 'Polygon' || geo.type === 'MultiPolygon')) {
      const ring = geo.type === 'Polygon' ? geo.coordinates[0] : geo.coordinates[0][0];
      const pts = ring.slice(0, -1).map(([lng, lat]) => L.latLng(lat, lng));
      setPoints(pts);
      setClosed(true);
      onAreaChange(JSON.stringify({ type: 'Polygon', coordinates: [ring] }));
    } else {
      const bb = item.boundingbox;
      const sw = L.latLng(parseFloat(bb[0]), parseFloat(bb[2]));
      const ne = L.latLng(parseFloat(bb[1]), parseFloat(bb[3]));
      const pts = [sw, L.latLng(sw.lat, ne.lng), ne, L.latLng(ne.lat, sw.lng)];
      setPoints(pts);
      setClosed(true);
      onAreaChange(JSON.stringify({ type: 'Polygon', coordinates: [[
        [sw.lng, sw.lat], [ne.lng, sw.lat], [ne.lng, ne.lat], [sw.lng, ne.lat], [sw.lng, sw.lat],
      ]] }));
    }
  };

  const polyPositions = points.map(p => [p.lat, p.lng]);
  const previewLine = mode === 'draw' && !closed && points.length > 0
    ? [...polyPositions]
    : [];

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <input
          type="text"
          value={query}
          onChange={handleSearchInput}
          onFocus={() => results.length && setShowResults(true)}
          placeholder="Search city, district, area..."
          style={{
            width: '100%', padding: '10px 14px 10px 36px',
            background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 10, color: '#fff', fontSize: 13,
            fontFamily: "'Inter', sans-serif", outline: 'none', boxSizing: 'border-box',
          }}
        />
        <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 15, opacity: 0.4 }}>🔍</span>
        {searching && <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>...</span>}
        {showResults && results.length > 0 && (
          <div style={{
            position: 'absolute', top: '110%', left: 0, right: 0, zIndex: 9000,
            background: '#2C2C2E', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 10, overflow: 'hidden',
            boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
          }}>
            {results.map((r, i) => (
              <button
                key={r.place_id}
                type="button"
                onMouseDown={() => selectResult(r)}
                style={{
                  width: '100%', padding: '10px 14px', background: 'transparent',
                  border: 'none', borderBottom: i < results.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                  color: '#fff', fontSize: 12, fontFamily: "'Inter', sans-serif",
                  cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 2,
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ fontWeight: 600 }}>{r.display_name.split(',')[0]}</span>
                <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>{r.display_name.split(',').slice(1, 3).join(',').trim()}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {[['hand', '✋ Pan'], ['draw', '✏️ Draw']].map(([m, lbl]) => (
          <button
            key={m}
            type="button"
            onClick={() => { setMode(m); if (m === 'hand' && !closed && points.length > 0) {} }}
            style={{
              flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 600,
              fontFamily: "'Inter', sans-serif", cursor: 'pointer',
              background: mode === m ? (m === 'draw' ? 'rgba(10,132,255,0.2)' : 'rgba(255,255,255,0.1)') : 'rgba(255,255,255,0.04)',
              border: mode === m ? (m === 'draw' ? '1px solid rgba(10,132,255,0.5)' : '1px solid rgba(255,255,255,0.2)') : '1px solid rgba(255,255,255,0.07)',
              color: mode === m ? (m === 'draw' ? '#0A84FF' : '#fff') : 'rgba(255,255,255,0.4)',
            }}
          >{lbl}</button>
        ))}
        {points.length > 0 && (
          <button
            type="button"
            onClick={clearDrawing}
            style={{
              padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              fontFamily: "'Inter', sans-serif", cursor: 'pointer',
              background: 'rgba(255,69,58,0.1)', border: '1px solid rgba(255,69,58,0.3)', color: '#FF453A',
            }}
          >✕ Clear</button>
        )}
      </div>
      {mode === 'draw' && !closed && (
        <div style={{ fontSize: 11, color: 'rgba(255,159,10,0.8)', marginBottom: 6 }}>
          {points.length === 0 ? '🖱 Click on the map to start placing points' : points.length < 3 ? `${points.length} point${points.length > 1 ? 's' : ''} placed — need at least 3` : 'Click near the first point ● to close the shape'}
        </div>
      )}
      {closed && points.length >= 3 && (
        <div style={{ fontSize: 11, color: '#30D158', marginBottom: 6 }}>✓ Area defined — {points.length} vertices</div>
      )}
      <div style={{ height: 300, borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', position: 'relative', cursor: mode === 'draw' ? 'crosshair' : 'grab' }}>
        <MapContainer
          center={[28.6139, 77.2090]}
          zoom={10}
          zoomControl={false}
          scrollWheelZoom={false}
          doubleClickZoom={false}
          touchZoom={false}
          dragging={mode === 'hand'}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" className="osm-dark-tiles" />
          <ZoomController />
          <DrawHandler
            mode={mode}
            points={points}
            onAddPoint={handleAddPoint}
            onClose={handleClose}
          />
          {closed && points.length >= 3 ? (
            <Polygon
              positions={polyPositions}
              pathOptions={{ color: '#0A84FF', weight: 2, fillColor: '#0A84FF', fillOpacity: 0.18 }}
            />
          ) : previewLine.length > 1 ? (
            <Polyline
              positions={previewLine}
              pathOptions={{ color: '#0A84FF', weight: 2, dashArray: '5 4', opacity: 0.8 }}
            />
          ) : null}
          {!closed && points.map((p, i) => (
            <CircleMarker
              key={i}
              center={[p.lat, p.lng]}
              radius={i === 0 ? 7 : 5}
              pathOptions={{
                color: i === 0 ? '#30D158' : '#0A84FF',
                fillColor: i === 0 ? '#30D158' : '#0A84FF',
                fillOpacity: 1, weight: 2,
              }}
            />
          ))}
        </MapContainer>
      </div>
    </div>
  );
}

function HazardEditDrawer({ hazard, onClose, onSave, onApprove, onReject }) {
  const [type, setType] = useState(hazard.type);
  const [severity, setSeverity] = useState(hazard.severity_score);
  const [status, setStatus] = useState(hazard.status);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave(hazard.id, type, severity, status);
    setSaving(false);
    onClose();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'flex-end',
    }} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 600, margin: '0 auto',
          background: '#1C1C1E', borderRadius: '20px 20px 0 0',
          border: '1px solid rgba(255,255,255,0.1)',
          padding: '0 0 calc(env(safe-area-inset-bottom,0px) + 20px)',
          maxHeight: '90dvh', overflowY: 'auto',
        }}
      >
        <div style={{ padding: '20px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>
            {HAZARD_EMOJI[hazard.type]} Edit Hazard
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', padding: 4 }}>
            <X size={20} />
          </button>
        </div>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginBottom: 4 }}>Hazard ID</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>{hazard.id}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <StatusBadge status={hazard.status} />
            {hazard.source && (
              <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 20, background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.45)', border: '1px solid rgba(255,255,255,0.1)' }}>
                {hazard.source}
              </span>
            )}
          </div>
        </div>
        {hazard.image_url && (
          <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.4)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.8 }}>Photo Evidence</div>
            <img
              src={hazard.image_url} alt="Hazard"
              style={{ width: '100%', borderRadius: 12, objectFit: 'cover', maxHeight: 220, display: 'block' }}
            />
          </div>
        )}
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>Type</label>
            <input
              type="text"
              value={type}
              onChange={e => setType(e.target.value.toLowerCase())}
              placeholder="e.g. fallen tree, pothole"
              style={{ width: '100%', padding: '12px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: '#fff', fontSize: 14, fontFamily: "'Inter', sans-serif" }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
              Severity — <span style={{ color: '#fff' }}>{severity}</span>
            </label>
            <input type="range" min="1" max="5" value={severity} onChange={e => setSeverity(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#0A84FF' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>Status</label>
            <select
              value={status}
              onChange={e => setStatus(e.target.value)}
              style={{ width: '100%', padding: '12px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: '#fff', fontSize: 14, fontFamily: "'Inter', sans-serif" }}
            >
              {['reported', 'under_review', 'verified', 'repaired', 'rejected'].map(s => (
                <option key={s} value={s} style={{ background: '#1C1C1E' }}>{s.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              onClick={async () => { await onApprove(hazard.id); onClose(); }}
              style={{ flex: 1, padding: '13px 0', borderRadius: 12, background: 'rgba(48,209,88,0.15)', border: '1px solid rgba(48,209,88,0.35)', color: '#30D158', fontWeight: 700, fontSize: 14, fontFamily: "'Inter', sans-serif", cursor: 'pointer' }}
            >
              ✓ Approve
            </button>
            <button
              onClick={async () => { await onReject(hazard.id); onClose(); }}
              style={{ flex: 1, padding: '13px 0', borderRadius: 12, background: 'rgba(255,69,58,0.12)', border: '1px solid rgba(255,69,58,0.3)', color: '#FF453A', fontWeight: 700, fontSize: 14, fontFamily: "'Inter', sans-serif", cursor: 'pointer' }}
            >
              ✗ Reject
            </button>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ width: '100%', padding: '14px', borderRadius: 12, background: saving ? 'rgba(10,132,255,0.4)' : '#0A84FF', border: 'none', color: '#fff', fontWeight: 700, fontSize: 15, fontFamily: "'Inter', sans-serif", cursor: saving ? 'not-allowed' : 'pointer' }}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function GovFormModal({ initial, onClose, onSubmit }) {
  const [deptName, setDeptName] = useState(initial?.dept_name || '');
  const [username, setUsername] = useState(initial?.username || '');
  const [password, setPassword] = useState('');
  const [mapAccess, setMapAccess] = useState(initial?.map_access || 'road_only');
  const [canEdit, setCanEdit] = useState(initial?.can_edit || false);
  const [canRemove, setCanRemove] = useState(initial?.can_remove || false);
  const [areaLabel, setAreaLabel] = useState(initial?.area_label || '');
  const [areaGeoJSON, setAreaGeoJSON] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isEdit = !!initial;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!deptName.trim() || !username.trim()) { setError('Department name and username are required.'); return; }
    if (!isEdit && !password.trim()) { setError('Password is required for new accounts.'); return; }
    setSaving(true);
    setError('');
    try {
      await onSubmit({
        deptName: deptName.trim(),
        username: username.trim(),
        password,
        mapAccess,
        canEdit,
        canRemove,
        areaLabel: areaLabel.trim() || null,
        areaGeoJSON,
        id: initial?.id,
      });
      onClose();
    } catch (err) {
      setError(err.message || 'Submission failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 4000,
      background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'flex-end', overflow: 'hidden',
    }} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 640, margin: '0 auto',
          background: '#1C1C1E', borderRadius: '20px 20px 0 0',
          border: '1px solid rgba(255,255,255,0.1)',
          padding: '0 0 calc(env(safe-area-inset-bottom,0px) + 24px)',
          maxHeight: '96dvh', overflowY: 'auto',
        }}
      >
        <div style={{ padding: '20px 20px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{isEdit ? 'Edit Gov ID' : 'New Gov ID'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)' }}><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label style={labelStyle}>Department Name</label>
            <input value={deptName} onChange={e => setDeptName(e.target.value)} placeholder="e.g. PWD Delhi" style={inputStyle} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Username</label>
              <input value={username} onChange={e => setUsername(e.target.value)} placeholder="gov_pwd_delhi" autoCapitalize="none" disabled={isEdit} style={{ ...inputStyle, opacity: isEdit ? 0.5 : 1 }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{isEdit ? 'New Password (optional)' : 'Password'}</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" style={inputStyle} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Map Access Level</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {[['road_only', '🛣️ Road Only'], ['infrastructure', '🏗️ Infrastructure'], ['full', '🗺️ Full Access']].map(([val, lbl]) => (
                <button key={val} type="button" onClick={() => setMapAccess(val)} style={{
                  flex: 1, padding: '10px 8px', borderRadius: 10, fontSize: 12, fontWeight: 600,
                  fontFamily: "'Inter', sans-serif", cursor: 'pointer', textAlign: 'center',
                  background: mapAccess === val ? 'rgba(10,132,255,0.2)' : 'rgba(255,255,255,0.04)',
                  border: mapAccess === val ? '1px solid rgba(10,132,255,0.5)' : '1px solid rgba(255,255,255,0.08)',
                  color: mapAccess === val ? '#0A84FF' : 'rgba(255,255,255,0.5)',
                }}>{lbl}</button>
              ))}
            </div>
          </div>
          <div>
            <label style={labelStyle}>Permissions</label>
            <div style={{ display: 'flex', gap: 10 }}>
              {[['canEdit', 'Can Edit Hazards', canEdit, setCanEdit], ['canRemove', 'Can Remove Hazards', canRemove, setCanRemove]].map(([key, lbl, val, setVal]) => (
                <button key={key} type="button" onClick={() => setVal(v => !v)} style={{
                  flex: 1, padding: '12px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                  fontFamily: "'Inter', sans-serif",
                  background: val ? 'rgba(48,209,88,0.1)' : 'rgba(255,255,255,0.04)',
                  border: val ? '1px solid rgba(48,209,88,0.35)' : '1px solid rgba(255,255,255,0.08)',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <div style={{ width: 18, height: 18, borderRadius: 5, background: val ? '#30D158' : 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {val && <Check size={12} color="#000" />}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: val ? '#30D158' : 'rgba(255,255,255,0.45)' }}>{lbl}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label style={labelStyle}>Area Label (optional)</label>
            <input value={areaLabel} onChange={e => setAreaLabel(e.target.value)} placeholder="e.g. South Delhi" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Access Area</label>
            <AreaMapPicker onAreaChange={setAreaGeoJSON} />
          </div>
          {error && (
            <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(255,69,58,0.1)', border: '1px solid rgba(255,69,58,0.25)', color: '#FF453A', fontSize: 13 }}>
              {error}
            </div>
          )}
          <button type="submit" disabled={saving} style={{ width: '100%', padding: '15px', borderRadius: 12, background: saving ? 'rgba(10,132,255,0.4)' : '#0A84FF', border: 'none', color: '#fff', fontWeight: 700, fontSize: 15, fontFamily: "'Inter', sans-serif", cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Saving...' : isEdit ? 'Update Gov ID' : 'Create Gov ID'}
          </button>
        </form>
      </div>
    </div>
  );
}

const labelStyle = {
  display: 'block', fontSize: 12, fontWeight: 600,
  color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase',
  letterSpacing: 0.8, marginBottom: 8,
};
const inputStyle = {
  width: '100%', padding: '12px 14px',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 10, color: '#fff', fontSize: 14,
  fontFamily: "'Inter', sans-serif", outline: 'none',
};

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState('hazards');
  const [hazards, setHazards] = useState([]);
  const [govAccounts, setGovAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [editingHazard, setEditingHazard] = useState(null);
  const [govModal, setGovModal] = useState(null);
  const [toast, setToast] = useState(null);
  const adminInfo = JSON.parse(sessionStorage.getItem('streetiq_admin') || 'null');

  useEffect(() => {
    if (!adminInfo) { navigate('/admin', { replace: true }); return; }
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
  }, [navigate]);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2800);
  };

  const fetchHazards = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_get_all_hazards');
    if (!error && data) setHazards(data);
    setLoading(false);
  }, []);

  const fetchGovAccounts = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_get_all_gov_accounts');
    if (!error && data) setGovAccounts(data);
  }, []);

  useEffect(() => {
    fetchHazards();
    fetchGovAccounts();
  }, [fetchHazards, fetchGovAccounts]);

  const handleApprove = async (id) => {
    await supabase.rpc('admin_approve_hazard', { p_hazard_id: id });
    setHazards(prev => prev.map(h => h.id === id ? { ...h, status: 'verified' } : h));
    showToast('Hazard approved — now visible on map.');
  };

  const handleReject = async (id) => {
    await supabase.rpc('admin_reject_hazard', { p_hazard_id: id });
    setHazards(prev => prev.map(h => h.id === id ? { ...h, status: 'rejected' } : h));
    showToast('Hazard rejected.', 'error');
  };

  const handleSaveHazard = async (id, type, severity, status) => {
    await supabase.rpc('admin_update_hazard', { p_hazard_id: id, p_type: type, p_severity: severity, p_status: status });
    setHazards(prev => prev.map(h => h.id === id ? { ...h, type, severity_score: severity, status } : h));
    showToast('Hazard updated.');
  };

  const handleCreateGov = async ({ deptName, username, password, mapAccess, canEdit, canRemove, areaLabel, areaGeoJSON }) => {
    const { error } = await supabase.rpc('admin_create_gov_account', {
      p_dept_name: deptName, p_username: username, p_password: password,
      p_map_access: mapAccess, p_can_edit: canEdit, p_can_remove: canRemove,
      p_area_label: areaLabel, p_area_geojson: areaGeoJSON,
    });
    if (error) throw error;
    await fetchGovAccounts();
    showToast('Gov ID created successfully.');
  };

  const handleUpdateGov = async ({ id, deptName, mapAccess, canEdit, canRemove, areaLabel, areaGeoJSON }) => {
    const { error } = await supabase.rpc('admin_update_gov_account', {
      p_gov_id: id, p_dept_name: deptName, p_map_access: mapAccess,
      p_can_edit: canEdit, p_can_remove: canRemove,
      p_is_active: true, p_area_label: areaLabel, p_area_geojson: areaGeoJSON,
    });
    if (error) throw error;
    await fetchGovAccounts();
    showToast('Gov ID updated.');
  };

  const handleDeleteGov = async (id) => {
    if (!window.confirm('Delete this gov account permanently?')) return;
    await supabase.rpc('admin_delete_gov_account', { p_gov_id: id });
    setGovAccounts(prev => prev.filter(g => g.id !== id));
    showToast('Gov account deleted.', 'error');
  };

  const handleLogout = () => {
    sessionStorage.removeItem('streetiq_admin');
    navigate('/admin', { replace: true });
  };

  const filteredHazards = hazards.filter(h => {
    if (filter === 'all') return true;
    if (filter === 'pending') return h.status === 'under_review';
    if (filter === 'verified') return h.status === 'verified';
    if (filter === 'rejected') return h.status === 'rejected';
    return true;
  });

  const pendingCount = hazards.filter(h => h.status === 'under_review').length;

  const sidebarItems = [
    { id: 'hazards', icon: <AlertTriangle size={18} />, label: 'Hazards', badge: pendingCount > 0 ? pendingCount : null },
    { id: 'gov', icon: <Building2 size={18} />, label: 'Gov IDs' },
  ];

  return (
    <div style={{
      height: '100dvh', background: '#000',
      fontFamily: "'Inter', -apple-system, sans-serif",
      display: 'flex', flexDirection: 'column',
      color: '#fff',
    }}>
      <div style={{
        padding: 'calc(env(safe-area-inset-top,0px) + 12px) 20px 12px',
        background: 'rgba(28,28,30,0.95)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(10,132,255,0.15)', border: '1px solid rgba(10,132,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Shield size={16} color="#0A84FF" />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Admin Dashboard</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>StreetIQ Internal</div>
          </div>
        </div>
        <button
          onClick={() => (activeSection === 'hazards' ? fetchHazards() : fetchGovAccounts())}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', padding: 6 }}
          title="Refresh"
        >
          <RefreshCw size={17} />
        </button>
        <button
          onClick={handleLogout}
          style={{ background: 'rgba(255,69,58,0.1)', border: '1px solid rgba(255,69,58,0.25)', borderRadius: 8, cursor: 'pointer', color: '#FF453A', padding: '6px 12px', fontSize: 13, fontWeight: 600, fontFamily: "'Inter', sans-serif", display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <LogOut size={14} />
          Sign Out
        </button>
      </div>
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
        {sidebarItems.map(item => (
          <button
            key={item.id}
            onClick={() => setActiveSection(item.id)}
            style={{
              flex: 1, padding: '12px 16px',
              background: activeSection === item.id ? 'rgba(10,132,255,0.1)' : 'transparent',
              border: 'none',
              borderBottom: activeSection === item.id ? '2px solid #0A84FF' : '2px solid transparent',
              cursor: 'pointer', color: activeSection === item.id ? '#0A84FF' : 'rgba(255,255,255,0.4)',
              fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 13,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              transition: 'all 0.15s',
            }}
          >
            {item.icon}
            {item.label}
            {item.badge > 0 && (
              <span style={{ minWidth: 18, height: 18, borderRadius: 9, background: '#FF9F0A', color: '#000', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>
                {item.badge}
              </span>
            )}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {activeSection === 'hazards' && (
          <>
            <div style={{ padding: '14px 16px', display: 'flex', gap: 8, borderBottom: '1px solid rgba(255,255,255,0.06)', flexWrap: 'nowrap', overflowX: 'auto' }}>
              {[['all', 'All'], ['pending', 'Pending'], ['verified', 'Verified'], ['rejected', 'Rejected']].map(([val, lbl]) => (
                <button key={val} onClick={() => setFilter(val)} style={{
                  padding: '7px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                  fontFamily: "'Inter', sans-serif", cursor: 'pointer', whiteSpace: 'nowrap',
                  background: filter === val ? '#0A84FF' : 'rgba(255,255,255,0.05)',
                  border: filter === val ? 'none' : '1px solid rgba(255,255,255,0.1)',
                  color: filter === val ? '#fff' : 'rgba(255,255,255,0.5)',
                }}>
                  {lbl} {val === 'all' ? `(${hazards.length})` : val === 'pending' ? `(${hazards.filter(h => h.status === 'under_review').length})` : val === 'verified' ? `(${hazards.filter(h => h.status === 'verified').length})` : `(${hazards.filter(h => h.status === 'rejected').length})`}
                </button>
              ))}
            </div>
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60, flexDirection: 'column', gap: 14 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', border: '2.5px solid rgba(10,132,255,0.3)', borderTopColor: '#0A84FF', animation: 'spin 0.7s linear infinite' }} />
                <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.35)' }}>Loading hazards...</span>
              </div>
            ) : filteredHazards.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.25)', fontSize: 14 }}>No hazards in this category.</div>
            ) : (
              <div style={{ padding: '8px 0' }}>
                {filteredHazards.map(h => (
                  <div
                    key={h.id}
                    onClick={() => setEditingHazard(h)}
                    style={{
                      padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 18 }}>
                      {HAZARD_EMOJI[h.type] || '⚠️'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, textTransform: 'capitalize' }}>{h.type}</span>
                        <StatusBadge status={h.status} />
                        {h.image_url && <ImageIcon size={12} color="rgba(255,255,255,0.3)" />}
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', display: 'flex', gap: 10 }}>
                        <span>Severity {h.severity_score}/5</span>
                        <span>{h.source || 'sensor'}</span>
                        <span>{h.lat ? `${Number(h.lat).toFixed(4)}, ${Number(h.lon).toFixed(4)}` : ''}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', marginTop: 2 }}>
                        {new Date(h.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                      {h.status === 'under_review' && (
                        <>
                          <button
                            onClick={e => { e.stopPropagation(); handleApprove(h.id); }}
                            style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(48,209,88,0.12)', border: '1px solid rgba(48,209,88,0.3)', cursor: 'pointer', color: '#30D158', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          >
                            <CheckCircle size={15} />
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); handleReject(h.id); }}
                            style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,69,58,0.1)', border: '1px solid rgba(255,69,58,0.25)', cursor: 'pointer', color: '#FF453A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          >
                            <XCircle size={15} />
                          </button>
                        </>
                      )}
                      {h.status !== 'under_review' && (
                        <ChevronRight size={16} color="rgba(255,255,255,0.2)" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {activeSection === 'gov' && (
          <>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <button
                onClick={() => setGovModal({ mode: 'create' })}
                style={{
                  width: '100%', padding: '13px', borderRadius: 12,
                  background: 'rgba(10,132,255,0.12)', border: '1px solid rgba(10,132,255,0.3)',
                  color: '#0A84FF', fontWeight: 700, fontSize: 14,
                  fontFamily: "'Inter', sans-serif", cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                <Plus size={16} />
                Add Government Access ID
              </button>
            </div>
            {govAccounts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.25)', fontSize: 14 }}>No government accounts yet.</div>
            ) : (
              <div style={{ padding: '8px 0' }}>
                {govAccounts.map(g => (
                  <div key={g.id} style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: 12, alignItems: 'center' }}>
                    <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(255,159,10,0.1)', border: '1px solid rgba(255,159,10,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Building2 size={18} color="#FF9F0A" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 3 }}>{g.dept_name}</div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><User size={11} />{g.username}</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Globe size={11} />{MAP_ACCESS_LABEL[g.map_access]}</span>
                        {g.area_label && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><LocateFixed size={11} />{g.area_label}</span>}
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                        {g.can_edit && <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: 'rgba(48,209,88,0.1)', border: '1px solid rgba(48,209,88,0.25)', color: '#30D158' }}>Can Edit</span>}
                        {g.can_remove && <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: 'rgba(255,69,58,0.1)', border: '1px solid rgba(255,69,58,0.25)', color: '#FF453A' }}>Can Remove</span>}
                        <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: g.is_active ? 'rgba(48,209,88,0.08)' : 'rgba(255,255,255,0.05)', border: `1px solid ${g.is_active ? 'rgba(48,209,88,0.2)' : 'rgba(255,255,255,0.1)'}`, color: g.is_active ? '#30D158' : 'rgba(255,255,255,0.3)' }}>
                          {g.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <button
                        onClick={() => setGovModal({ mode: 'edit', data: g })}
                        style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(10,132,255,0.1)', border: '1px solid rgba(10,132,255,0.2)', cursor: 'pointer', color: '#0A84FF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteGov(g.id)}
                        style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,69,58,0.08)', border: '1px solid rgba(255,69,58,0.2)', cursor: 'pointer', color: '#FF453A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      {editingHazard && (
        <HazardEditDrawer
          hazard={editingHazard}
          onClose={() => setEditingHazard(null)}
          onSave={handleSaveHazard}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      )}
      {govModal && (
        <GovFormModal
          initial={govModal.mode === 'edit' ? govModal.data : null}
          onClose={() => setGovModal(null)}
          onSubmit={govModal.mode === 'edit' ? handleUpdateGov : handleCreateGov}
        />
      )}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 'calc(env(safe-area-inset-bottom,0px) + 24px)',
          left: '50%', transform: 'translateX(-50%)',
          background: toast.type === 'error' ? 'rgba(255,69,58,0.95)' : 'rgba(28,28,30,0.97)',
          border: toast.type === 'error' ? '1px solid rgba(255,69,58,0.4)' : '1px solid rgba(48,209,88,0.35)',
          color: '#fff', padding: '12px 20px', borderRadius: 12,
          fontSize: 14, fontWeight: 500,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          zIndex: 9999, whiteSpace: 'nowrap',
          animation: 'fadeIn 0.2s ease',
        }}>
          {toast.msg}
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes fadeIn { from { opacity: 0; transform: translateX(-50%) translateY(6px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }`}</style>
    </div>
  );
}
