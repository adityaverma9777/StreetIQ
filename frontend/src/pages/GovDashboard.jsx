import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, CircleMarker, Tooltip, Polyline, Polygon, useMapEvents, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import {
  LogOut, Map, AlertTriangle, Download, Ruler,
  RefreshCw, Lock, Trash2, X,
} from 'lucide-react';
import { supabase } from '../supabaseClient';

const TYPE_COLOR = {
  pothole: '#FF9F0A',
  crack: '#FFD60A',
  waterlogging: '#0A84FF',
  debris: '#98989D',
};
const TYPE_EMOJI = { pothole: '🕳️', crack: '⚡', waterlogging: '💧', debris: '🪨' };
const STATUS_BADGE = {
  under_review: { bg: 'rgba(255,159,10,0.15)', border: 'rgba(255,159,10,0.4)', text: '#FF9F0A' },
  verified: { bg: 'rgba(48,209,88,0.15)', border: 'rgba(48,209,88,0.4)', text: '#30D158' },
  reported: { bg: 'rgba(10,132,255,0.15)', border: 'rgba(10,132,255,0.4)', text: '#0A84FF' },
  repaired: { bg: 'rgba(99,99,102,0.2)', border: 'rgba(99,99,102,0.4)', text: 'rgba(235,235,245,0.5)' },
};
const ALL_TYPES = ['pothole', 'crack', 'waterlogging', 'debris'];
const ALL_STATUSES = ['reported', 'under_review', 'verified', 'repaired'];
const MAP_ACCESS_TYPES = {
  road_only: ['pothole', 'crack'],
  infrastructure: ['pothole', 'crack', 'waterlogging', 'debris'],
  full: ['pothole', 'crack', 'waterlogging', 'debris'],
};

function calcDistanceM(p1, p2) {
  return L.latLng(p1[0], p1[1]).distanceTo(L.latLng(p2[0], p2[1]));
}
function totalDistanceM(points) {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += calcDistanceM(points[i - 1], points[i]);
  return d;
}
function fmtDistance(meters, unit) {
  if (unit === 'm') return `${Math.round(meters)} m`;
  if (unit === 'km') return `${(meters / 1000).toFixed(3)} km`;
  return `${(meters / 1609.344).toFixed(3)} mi`;
}
function parseAreaPolygon(geojson) {
  if (!geojson) return null;
  try {
    const g = typeof geojson === 'string' ? JSON.parse(geojson) : geojson;
    const ring = g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates[0][0] : null;
    if (!ring) return null;
    return ring.map(([lng, lat]) => [lat, lng]);
  } catch { return null; }
}

function pointInPolygon(lat, lon, polygon) {
  if (!polygon || polygon.length < 3) return true;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [iy, ix] = polygon[i];
    const [jy, jx] = polygon[j];
    if (((iy > lat) !== (jy > lat)) && (lon < ((jx - ix) * (lat - iy)) / (jy - iy) + ix)) {
      inside = !inside;
    }
  }
  return inside;
}

function GovZoomCtrl() {
  const map = useMap();
  return (
    <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {['+', '−'].map((s, i) => (
        <button key={s} type="button" onClick={() => i === 0 ? map.zoomIn() : map.zoomOut()} style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(28,28,30,0.92)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.4)', fontFamily: 'sans-serif' }}>{s}</button>
      ))}
    </div>
  );
}

function RulerHandler({ active, onAddPoint }) {
  useMapEvents({
    click(e) { if (active) onAddPoint([e.latlng.lat, e.latlng.lng]); },
  });
  return null;
}

function FitBoundsToArea({ polygon }) {
  const map = useMap();
  useEffect(() => {
    if (!polygon || polygon.length === 0) return;
    const bounds = L.latLngBounds(polygon);
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 14 });
  }, [map]);
  return null;
}

const WORLD_RING = [
  [-90, -180], [-90, 0], [-90, 180],
  [90, 180], [90, 0], [90, -180], [-90, -180],
];

function PermGate({ allowed, feature, children }) {
  if (allowed) return children;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', textAlign: 'center' }}>
      <div style={{ width: 52, height: 52, borderRadius: 14, background: 'rgba(255,69,58,0.1)', border: '1px solid rgba(255,69,58,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
        <Lock size={22} color="#FF453A" />
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Access Restricted</div>
      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', lineHeight: 1.7, maxWidth: 260 }}>
        Your account does not have permission to <strong style={{ color: 'rgba(255,255,255,0.6)' }}>{feature}</strong>.<br />Contact your administrator for access.
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const c = STATUS_BADGE[status] || STATUS_BADGE.reported;
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: c.bg, border: `1px solid ${c.border}`, color: c.text, textTransform: 'uppercase', letterSpacing: 0.3 }}>
      {status?.replace('_', ' ')}
    </span>
  );
}

function HazardPopup({ hazard, govId, canEdit, canRemove, onStatusChange, onRemove }) {
  const [status, setStatus] = useState(hazard.status);
  const [saving, setSaving] = useState(false);

  const save = async (newStatus) => {
    setSaving(true);
    try {
      await supabase.rpc('gov_update_hazard_status', { p_gov_id: govId, p_hazard_id: hazard.id, p_status: newStatus });
      setStatus(newStatus);
      onStatusChange(hazard.id, newStatus);
    } catch { }
    setSaving(false);
  };

  const remove = async () => {
    if (!window.confirm('Mark this hazard as removed?')) return;
    setSaving(true);
    try {
      await supabase.rpc('gov_remove_hazard', { p_gov_id: govId, p_hazard_id: hazard.id });
      onRemove(hazard.id);
    } catch { }
    setSaving(false);
  };

  return (
    <div style={{ minWidth: 200, fontFamily: "'Inter', sans-serif", padding: '2px 0' }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6, textTransform: 'capitalize' }}>
        {TYPE_EMOJI[hazard.type]} {hazard.type}
      </div>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Severity: {hazard.severity_score}/5 · Confirmations: {hazard.confirmation_count}</div>
      <div style={{ marginBottom: 8 }}><StatusBadge status={status} /></div>
      {canEdit && (
        <select value={status} onChange={e => save(e.target.value)} disabled={saving} style={{ width: '100%', padding: '6px 8px', borderRadius: 6, fontSize: 12, marginBottom: 6, border: '1px solid #ddd', background: '#fff' }}>
          {['reported', 'under_review', 'verified', 'repaired'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      )}
      {canRemove && (
        <button onClick={remove} disabled={saving} style={{ width: '100%', padding: '6px', borderRadius: 6, background: '#fff0f0', border: '1px solid #fcc', color: '#c00', fontSize: 12, cursor: 'pointer', fontFamily: "'Inter', sans-serif" }}>
          {saving ? '...' : '✗ Mark Removed'}
        </button>
      )}
      <div style={{ fontSize: 10, color: '#aaa', marginTop: 6 }}>
        {Number(hazard.lat).toFixed(5)}, {Number(hazard.lon).toFixed(5)}
      </div>
    </div>
  );
}

export default function GovDashboard() {
  const navigate = useNavigate();
  const govInfo = JSON.parse(sessionStorage.getItem('streetiq_gov') || 'null');
  const [activeTab, setActiveTab] = useState('map');
  const [hazards, setHazards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rulerMode, setRulerMode] = useState(false);
  const [rulerPoints, setRulerPoints] = useState([]);
  const [rulerUnit, setRulerUnit] = useState('km');
  const [statusFilter, setStatusFilter] = useState([...ALL_STATUSES]);
  const [typeFilter, setTypeFilter] = useState([...ALL_TYPES]);
  const [exportTypes, setExportTypes] = useState([...ALL_TYPES]);
  const [exportStatuses, setExportStatuses] = useState([...ALL_STATUSES]);
  const [toast, setToast] = useState(null);

  const areaPolygon = govInfo ? parseAreaPolygon(govInfo.area_geojson) : null;
  const allowedTypes = govInfo ? MAP_ACCESS_TYPES[govInfo.map_access] || ALL_TYPES : ALL_TYPES;

  useEffect(() => {
    if (!govInfo) { navigate('/gov', { replace: true }); return; }
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
  }, [navigate]);

  const fetchHazards = useCallback(async () => {
    if (!govInfo?.id) return;
    setLoading(true);
    const { data, error } = await supabase.rpc('gov_get_hazards', { p_gov_id: govInfo.id });
    if (error) {
      console.error('[gov_get_hazards] RPC error:', JSON.stringify(error));
    }
    if (!error && data) {
      const byType = data.filter(h => allowedTypes.includes(h.type));
      const byArea = areaPolygon
        ? byType.filter(h => pointInPolygon(Number(h.lat), Number(h.lon), areaPolygon))
        : byType;
      setHazards(byArea);
    }
    setLoading(false);
  }, [govInfo?.id]);

  useEffect(() => { fetchHazards(); }, [fetchHazards]);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  const handleStatusChange = (id, newStatus) => {
    setHazards(prev => prev.map(h => h.id === id ? { ...h, status: newStatus } : h));
    showToast('Status updated.');
  };

  const handleRemove = (id) => {
    setHazards(prev => prev.filter(h => h.id !== id));
    showToast('Hazard marked removed.', 'error');
  };

  const toggleFilter = (arr, setArr, val) => {
    setArr(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]);
  };

  const filteredHazards = hazards.filter(h => typeFilter.includes(h.type) && statusFilter.includes(h.status));
  const exportCount = hazards.filter(h => exportTypes.includes(h.type) && exportStatuses.includes(h.status)).length;

  const doExportCSV = () => {
    const rows = hazards.filter(h => exportTypes.includes(h.type) && exportStatuses.includes(h.status));
    const header = 'ID,Type,Severity,Status,Source,Latitude,Longitude,Confirmations,Timestamp\n';
    const body = rows.map(h =>
      `${h.id},${h.type},${h.severity_score},${h.status},${h.source || ''},${Number(h.lat).toFixed(6)},${Number(h.lon).toFixed(6)},${h.confirmation_count},"${new Date(h.created_at).toISOString()}"`
    ).join('\n');
    const blob = new Blob(['\ufeff' + header + body], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `streetiq_${govInfo?.dept_name?.replace(/\s+/g, '_')}_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${rows.length} records as CSV.`);
  };

  const doExportJSON = () => {
    const rows = hazards.filter(h => exportTypes.includes(h.type) && exportStatuses.includes(h.status));
    const data = {
      exported_by: govInfo?.dept_name,
      exported_at: new Date().toISOString(),
      area: govInfo?.area_label || 'All areas',
      count: rows.length,
      hazards: rows.map(h => ({
        id: h.id, type: h.type, severity: h.severity_score, status: h.status,
        source: h.source, confirmations: h.confirmation_count,
        coordinates: { lat: Number(h.lat).toFixed(6), lon: Number(h.lon).toFixed(6) },
        timestamp: h.created_at,
      })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `streetiq_${govInfo?.dept_name?.replace(/\s+/g, '_')}_${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${rows.length} records as JSON.`);
  };

  const mapCenter = areaPolygon
    ? areaPolygon.reduce((acc, [lat, lng]) => [acc[0] + lat / areaPolygon.length, acc[1] + lng / areaPolygon.length], [0, 0])
    : [28.6139, 77.209];

  const areaBounds = areaPolygon ? L.latLngBounds(areaPolygon).pad(0.02) : null;

  const rulerTotal = rulerPoints.length > 1 ? totalDistanceM(rulerPoints) : 0;

  const TABS = [
    { id: 'map', icon: <Map size={16} />, label: 'Map' },
    { id: 'hazards', icon: <AlertTriangle size={16} />, label: 'Hazards' },
    { id: 'export', icon: <Download size={16} />, label: 'Export' },
  ];

  if (!govInfo) return null;

  return (
    <div style={{ height: '100dvh', background: '#000', fontFamily: "'Inter', -apple-system, sans-serif", display: 'flex', flexDirection: 'column', color: '#fff' }}>
      <div style={{
        padding: 'calc(env(safe-area-inset-top,0px) + 12px) 16px 12px',
        background: 'rgba(28,28,30,0.95)', backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
      }}>
        <div style={{ width: 36, height: 36, borderRadius: 9, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
          <img src="/logo.png" alt="StreetIQ" style={{ width: 22, height: 22, objectFit: 'contain', filter: 'brightness(0) invert(1)', opacity: 0.7 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{govInfo.dept_name}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span>{govInfo.map_access?.replace('_', ' ')}</span>
            {govInfo.area_label && <span>· {govInfo.area_label}</span>}
            {govInfo.can_edit && <span style={{ color: 'rgba(255,255,255,0.55)' }}>· Edit</span>}
            {govInfo.can_remove && <span style={{ color: 'rgba(255,255,255,0.55)' }}>· Remove</span>}
          </div>
        </div>
        <button onClick={fetchHazards} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', padding: 6 }}>
          <RefreshCw size={16} />
        </button>
        <button
          onClick={() => { sessionStorage.removeItem('streetiq_gov'); navigate('/gov', { replace: true }); }}
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, cursor: 'pointer', color: 'rgba(255,255,255,0.5)', padding: '6px 10px', fontSize: 12, fontWeight: 600, fontFamily: "'Inter', sans-serif", display: 'flex', alignItems: 'center', gap: 5 }}
        >
          <LogOut size={13} />
          Out
        </button>
      </div>
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: 1, padding: '11px 0',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #fff' : '2px solid transparent',
              cursor: 'pointer', color: activeTab === tab.id ? '#fff' : 'rgba(255,255,255,0.35)',
              fontFamily: "'Inter', sans-serif", fontWeight: activeTab === tab.id ? 700 : 500, fontSize: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              transition: 'all 0.15s',
            }}
          >
            {tab.icon}{tab.label}
            {tab.id === 'hazards' && hazards.length > 0 && (
              <span style={{ minWidth: 16, height: 16, borderRadius: 8, background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                {hazards.length}
              </span>
            )}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'map' && (
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <div style={{
              position: 'absolute', top: 12, left: 12, zIndex: 1000,
              display: 'flex', gap: 6,
            }}>
              <button
                onClick={() => { setRulerMode(v => !v); }}
                style={{
                  padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  fontFamily: "'Inter', sans-serif", cursor: 'pointer',
                  background: rulerMode ? 'rgba(255,255,255,0.2)' : 'rgba(28,28,30,0.92)',
                  border: rulerMode ? '1px solid rgba(255,255,255,0.5)' : '1px solid rgba(255,255,255,0.15)',
                  color: rulerMode ? '#fff' : 'rgba(255,255,255,0.7)',
                  display: 'flex', alignItems: 'center', gap: 6,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                }}
              >
                <Ruler size={13} />
                {rulerMode ? 'Measuring...' : 'Ruler'}
              </button>
              {rulerPoints.length > 0 && (
                <button
                  onClick={() => setRulerPoints([])}
                  style={{ padding: '7px 10px', borderRadius: 8, fontSize: 12, fontFamily: "'Inter', sans-serif", cursor: 'pointer', background: 'rgba(28,28,30,0.92)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.5)', boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
            {rulerPoints.length > 1 && (
              <div style={{
                position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
                zIndex: 1000, background: 'rgba(28,28,30,0.96)', border: '1px solid rgba(255,255,255,0.3)',
                borderRadius: 12, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12,
                boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
              }}>
                <Ruler size={14} color="#fff" />
                <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{fmtDistance(rulerTotal, rulerUnit)}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {['m', 'km', 'mi'].map(u => (
                    <button key={u} onClick={() => setRulerUnit(u)} style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, fontFamily: "'Inter', sans-serif", cursor: 'pointer', background: rulerUnit === u ? '#fff' : 'rgba(255,255,255,0.08)', border: 'none', color: rulerUnit === u ? '#000' : 'rgba(255,255,255,0.5)' }}>{u}</button>
                  ))}
                </div>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{rulerPoints.length} pts</span>
              </div>
            )}
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 14 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', border: '2.5px solid rgba(255,255,255,0.12)', borderTopColor: '#fff', animation: 'spin 0.7s linear infinite' }} />
                <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.35)' }}>Loading hazards...</span>
              </div>
            ) : (
              <MapContainer
                center={mapCenter}
                zoom={areaPolygon ? 12 : 10}
                zoomControl={false}
                scrollWheelZoom={false}
                doubleClickZoom={false}
                touchZoom={false}
                maxBounds={areaBounds || undefined}
                maxBoundsViscosity={areaBounds ? 1.0 : 0}
                style={{ height: '100%', width: '100%', cursor: rulerMode ? 'crosshair' : 'grab' }}
              >
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" className="osm-dark-tiles" />
                <GovZoomCtrl />
                <RulerHandler active={rulerMode} onAddPoint={(pt) => setRulerPoints(prev => [...prev, pt])} />
                {areaPolygon && <FitBoundsToArea polygon={areaPolygon} />}
                {areaPolygon && (
                  <>
                    <Polygon
                      positions={[WORLD_RING, areaPolygon]}
                      pathOptions={{ stroke: false, fillColor: '#000', fillOpacity: 0.82 }}
                    />
                    <Polygon
                      positions={areaPolygon}
                      pathOptions={{ color: 'rgba(255,255,255,0.3)', weight: 1.5, fill: false, dashArray: '5 5' }}
                    />
                  </>
                )}
                {filteredHazards.map(h => (
                  <CircleMarker
                    key={h.id}
                    center={[Number(h.lat), Number(h.lon)]}
                    radius={4 + (h.severity_score || 1)}
                    pathOptions={{
                      color: TYPE_COLOR[h.type] || '#fff',
                      fillColor: TYPE_COLOR[h.type] || '#fff',
                      fillOpacity: 0.85, weight: 2,
                    }}
                  >
                    <Tooltip direction="top" offset={[0, -8]} opacity={1}>
                      <HazardPopup
                        hazard={h}
                        govId={govInfo.id}
                        canEdit={govInfo.can_edit}
                        canRemove={govInfo.can_remove}
                        onStatusChange={handleStatusChange}
                        onRemove={handleRemove}
                      />
                    </Tooltip>
                  </CircleMarker>
                ))}
                {rulerPoints.length > 1 && (
                  <Polyline
                    positions={rulerPoints}
                    pathOptions={{ color: '#fff', weight: 2.5, dashArray: '5 4', opacity: 0.9 }}
                  />
                )}
                {rulerPoints.map((p, i) => (
                  <CircleMarker
                    key={`r${i}`}
                    center={p}
                    radius={i === 0 ? 6 : 4}
                    pathOptions={{ color: '#fff', fillColor: '#fff', fillOpacity: 1, weight: 2 }}
                  >
                    {i > 0 && (
                      <Tooltip permanent direction="top" offset={[0, -8]} opacity={0.9}>
                        <span style={{ fontSize: 11, fontWeight: 600, fontFamily: "'Inter', sans-serif" }}>
                          +{fmtDistance(calcDistanceM(rulerPoints[i - 1], p), rulerUnit)}
                        </span>
                      </Tooltip>
                    )}
                  </CircleMarker>
                ))}
              </MapContainer>
            )}
          </div>
        )}
        {activeTab === 'hazards' && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>Filter by Type</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {allowedTypes.map(t => (
                  <button key={t} onClick={() => toggleFilter(typeFilter, setTypeFilter, t)} style={{ padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, fontFamily: "'Inter', sans-serif", cursor: 'pointer', background: typeFilter.includes(t) ? `${TYPE_COLOR[t]}25` : 'rgba(255,255,255,0.04)', border: typeFilter.includes(t) ? `1px solid ${TYPE_COLOR[t]}60` : '1px solid rgba(255,255,255,0.08)', color: typeFilter.includes(t) ? TYPE_COLOR[t] : 'rgba(255,255,255,0.4)' }}>
                    {TYPE_EMOJI[t]} {t}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>Filter by Status</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {ALL_STATUSES.map(s => (
                  <button key={s} onClick={() => toggleFilter(statusFilter, setStatusFilter, s)} style={{ padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, fontFamily: "'Inter', sans-serif", cursor: 'pointer', background: statusFilter.includes(s) ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)', border: statusFilter.includes(s) ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(255,255,255,0.06)', color: statusFilter.includes(s) ? '#fff' : 'rgba(255,255,255,0.3)' }}>
                    {s.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>
            {!govInfo.can_edit && !govInfo.can_remove && (
              <div style={{ margin: '12px 16px', padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Lock size={14} color="rgba(255,255,255,0.35)" />
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>View only — no edit or remove permissions</span>
              </div>
            )}
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48, gap: 12 }}>
                <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.12)', borderTopColor: '#fff', animation: 'spin 0.7s linear infinite' }} />
                <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>Loading...</span>
              </div>
            ) : filteredHazards.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.25)', fontSize: 14 }}>No hazards match the current filters.</div>
            ) : (
              <div>
                {filteredHazards.map(h => (
                  <div key={h.id} style={{ padding: '13px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 9, background: `${TYPE_COLOR[h.type]}18`, border: `1px solid ${TYPE_COLOR[h.type]}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 16 }}>
                      {TYPE_EMOJI[h.type]}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'capitalize', color: TYPE_COLOR[h.type] }}>{h.type}</span>
                        <StatusBadge status={h.status} />
                        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Sev {h.severity_score}/5</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 6 }}>
                        {Number(h.lat).toFixed(5)}, {Number(h.lon).toFixed(5)} · {new Date(h.created_at).toLocaleDateString('en-IN')}
                      </div>
                      {(govInfo.can_edit || govInfo.can_remove) && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          {govInfo.can_edit && (
                            <select
                              value={h.status}
                              onChange={async e => {
                                const newStatus = e.target.value;
                                try {
                                  await supabase.rpc('gov_update_hazard_status', { p_gov_id: govInfo.id, p_hazard_id: h.id, p_status: newStatus });
                                  handleStatusChange(h.id, newStatus);
                                } catch { showToast('Update failed.', 'error'); }
                              }}
                              style={{ padding: '5px 8px', borderRadius: 7, fontSize: 11, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', fontFamily: "'Inter', sans-serif", cursor: 'pointer' }}
                            >
                              {['reported', 'under_review', 'verified', 'repaired'].map(s => <option key={s} value={s} style={{ background: '#1C1C1E' }}>{s.replace('_', ' ')}</option>)}
                            </select>
                          )}
                          {govInfo.can_remove && (
                            <button
                              onClick={async () => {
                                if (!window.confirm('Mark this hazard as removed?')) return;
                                try {
                                  await supabase.rpc('gov_remove_hazard', { p_gov_id: govInfo.id, p_hazard_id: h.id });
                                  handleRemove(h.id);
                                } catch { showToast('Remove failed.', 'error'); }
                              }}
                              style={{ padding: '5px 10px', borderRadius: 7, background: 'rgba(255,69,58,0.1)', border: '1px solid rgba(255,69,58,0.25)', color: '#FF453A', fontSize: 11, fontFamily: "'Inter', sans-serif", cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                            >
                              <Trash2 size={11} /> Remove
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {activeTab === 'export' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px' }}>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 }}>Select Hazard Types</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {allowedTypes.map(t => (
                  <button key={t} onClick={() => toggleFilter(exportTypes, setExportTypes, t)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 10, background: exportTypes.includes(t) ? `${TYPE_COLOR[t]}15` : 'rgba(255,255,255,0.03)', border: exportTypes.includes(t) ? `1px solid ${TYPE_COLOR[t]}45` : '1px solid rgba(255,255,255,0.07)', cursor: 'pointer' }}>
                    <div style={{ width: 18, height: 18, borderRadius: 5, background: exportTypes.includes(t) ? TYPE_COLOR[t] : 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 10 }}>
                      {exportTypes.includes(t) ? '✓' : ''}
                    </div>
                    <span style={{ fontSize: 13, fontFamily: "'Inter', sans-serif", color: exportTypes.includes(t) ? TYPE_COLOR[t] : 'rgba(255,255,255,0.45)', fontWeight: 600 }}>{TYPE_EMOJI[t]} {t}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{hazards.filter(h => h.type === t).length} records</span>
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 }}>Select Statuses</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {ALL_STATUSES.map(s => (
                  <button key={s} onClick={() => toggleFilter(exportStatuses, setExportStatuses, s)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 10, background: exportStatuses.includes(s) ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)', border: exportStatuses.includes(s) ? '1px solid rgba(255,255,255,0.15)' : '1px solid rgba(255,255,255,0.06)', cursor: 'pointer' }}>
                    <div style={{ width: 18, height: 18, borderRadius: 5, background: exportStatuses.includes(s) ? '#fff' : 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 10, color: '#000' }}>
                      {exportStatuses.includes(s) ? '✓' : ''}
                    </div>
                    <span style={{ fontSize: 13, fontFamily: "'Inter', sans-serif", color: exportStatuses.includes(s) ? '#fff' : 'rgba(255,255,255,0.4)', fontWeight: 600, textTransform: 'capitalize' }}>{s.replace('_', ' ')}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{hazards.filter(h => h.status === s).length} records</span>
                  </button>
                ))}
              </div>
            </div>
            <div style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 2 }}>{exportCount} records selected</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
                Fields: ID · Type · Severity · Status · Source · Latitude · Longitude · Confirmations · Timestamp
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                onClick={doExportCSV}
                disabled={exportCount === 0}
                style={{ padding: '15px', borderRadius: 12, background: exportCount === 0 ? 'rgba(255,255,255,0.04)' : '#fff', border: `1px solid ${exportCount === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.15)'}`, color: exportCount === 0 ? 'rgba(255,255,255,0.2)' : '#000', fontWeight: 700, fontSize: 15, fontFamily: "'Inter', sans-serif", cursor: exportCount === 0 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                <Download size={16} /> Export as CSV
              </button>
              <button
                onClick={doExportJSON}
                disabled={exportCount === 0}
                style={{ padding: '15px', borderRadius: 12, background: exportCount === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(10,132,255,0.12)', border: `1px solid ${exportCount === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(10,132,255,0.3)'}`, color: exportCount === 0 ? 'rgba(255,255,255,0.2)' : '#0A84FF', fontWeight: 700, fontSize: 15, fontFamily: "'Inter', sans-serif", cursor: exportCount === 0 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                <Download size={16} /> Export as JSON
              </button>
            </div>
          </div>
        )}
      </div>
      {toast && (
        <div style={{
          position: 'fixed', bottom: 'calc(env(safe-area-inset-bottom,0px) + 24px)',
          left: '50%', transform: 'translateX(-50%)',
          background: toast.type === 'error' ? 'rgba(28,28,30,0.98)' : 'rgba(28,28,30,0.98)',
          border: '1px solid rgba(255,255,255,0.12)',
          color: '#fff', padding: '11px 18px', borderRadius: 12, fontSize: 13, fontWeight: 500,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)', zIndex: 9999, whiteSpace: 'nowrap',
          animation: 'fadeIn 0.2s ease',
        }}>
          {toast.msg}
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes fadeIn { from { opacity: 0; transform: translateX(-50%) translateY(6px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }`}</style>
    </div>
  );
}
