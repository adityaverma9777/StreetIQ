import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, ZoomControl, useMap, LayersControl, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import 'leaflet.heat';
import { useNavigate } from 'react-router-dom';
import { Map as MapIcon, Camera, PlusCircle, LocateFixed, Square, Upload, ChevronRight, Navigation } from 'lucide-react';
import './index.css';
import RecordView from './RecordView';
import SearchBar from './components/SearchBar';
import DirectionsPanel from './components/DirectionsPanel';
import NavigationHUD from './components/NavigationHUD';
import CameraPiP from './components/CameraPiP';
import DriveModal from './components/DriveModal';
import { useNavigation } from './hooks/useNavigation';
import { useGPSLocation } from './hooks/useGPSLocation';
import { supabase, signInAnonymously } from './supabaseClient';
import * as tf from '@tensorflow/tfjs';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const createHazardIcon = (type) => L.divIcon({
  className: '',
  html: `<div class="marker-pin ${type === 'crack' ? 'marker-crack' : type === 'repaired' ? 'marker-repaired' : ''}"></div>`,
  iconSize: [28, 28], iconAnchor: [14, 28],
});

const destIcon = L.divIcon({
  className: '',
  html: '<div style="width:24px;height:24px;border-radius:50%;background:#FF453A;border:3px solid white;box-shadow:0 2px 8px rgba(255,69,58,0.6);"></div>',
  iconSize: [24, 24], iconAnchor: [12, 12],
});

function HeatmapLayer({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points?.length) return;
    const heat = L.heatLayer(points, { radius: 28, blur: 18, maxZoom: 17, gradient: { 0.4: '#30D158', 0.65: '#FF9F0A', 1.0: '#FF453A' } }).addTo(map);
    return () => map.removeLayer(heat);
  }, [map, points]);
  return null;
}

function MapController({ center, isNavigating, heading }) {
  const map = useMap();
  const prevCenter = useRef(null);
  useEffect(() => {
    if (!center || !isNavigating) return;
    const same = prevCenter.current && prevCenter.current[0] === center[0] && prevCenter.current[1] === center[1];
    if (!same) {
      map.panTo(center, { animate: true, duration: 0.5 });
      prevCenter.current = center;
    }
    if (heading !== null && heading !== undefined) {
      map.setBearing ? map.setBearing(heading) : null;
      const container = map.getContainer();
      if (container) {
        const pane = container.querySelector('.leaflet-map-pane');
        if (pane) pane.style.transform = pane.style.transform;
      }
    }
  }, [center, isNavigating, heading, map]);
  return null;
}

const parseLocation = (loc, fallback) => {
  if (typeof loc === 'string' && loc.startsWith('POINT')) {
    const m = loc.match(/POINT\(([-0-9.]+) ([-0-9.]+)\)/);
    if (m) return [parseFloat(m[2]), parseFloat(m[1])];
  }
  return fallback;
};

export default function App() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('map');
  const [hazards, setHazards] = useState([]);
  const initialPosition = [28.6139, 77.2090];
  const currentPositionRef = useRef(initialPosition);
  const [userLocation, setUserLocation] = useState(null);
  const mapRef = useRef(null);
  const hasAutoCentered = useRef(false);
  const [model, setModel] = useState(null);
  const [destination, setDestination] = useState(null);
  const [showDirections, setShowDirections] = useState(false);
  const [showDriveModal, setShowDriveModal] = useState(false);
  const [isDriveRecording, setIsDriveRecording] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [manualType, setManualType] = useState('pothole');
  const [manualSeverity, setManualSeverity] = useState(3);
  const [capturedPhoto, setCapturedPhoto] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const liveCamRef = useRef(null);
  const liveCanvasRef = useRef(null);
  const [camStream, setCamStream] = useState(null);

  const { location: gpsLocation, speedKmh, rawLocationRef } = useGPSLocation();
  const nav = useNavigation(userLocation, speedKmh);

  useEffect(() => {
    tf.ready().then(() => {
      tf.loadGraphModel('/model/model.json')
        .then(m => setModel(m))
        .catch(e => console.error('Model load failed:', e));
    });
  }, []);

  useEffect(() => {
    if (!gpsLocation) return;
    currentPositionRef.current = gpsLocation;
    setUserLocation(gpsLocation);
    if (!hasAutoCentered.current && mapRef.current) {
      mapRef.current.setView(gpsLocation, 15, { animate: false });
      hasAutoCentered.current = true;
    }
  }, [gpsLocation]);

  useEffect(() => {
    async function init() {
      await signInAnonymously();
      const { data } = await supabase.from('hazards').select('*').eq('status', 'verified');
      if (data) setHazards(data);
      const channel = supabase.channel('public:hazards')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hazards' }, p => setHazards(prev => [...prev, p.new]))
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'hazards' }, p => setHazards(prev => prev.map(h => h.id === p.new.id ? p.new : h)))
        .subscribe();
      return () => supabase.removeChannel(channel);
    }
    init();
  }, []);

  const goToLiveLocation = () => {
    const pos = rawLocationRef?.current || currentPositionRef.current;
    if (mapRef.current && pos) mapRef.current.setView(pos, 17, { animate: true, duration: 0.4 });
  };

  const handleDestinationSelect = async (result) => {
    setDestination(result);
    setShowDirections(true);
    if (mapRef.current) mapRef.current.setView([result.lat, result.lon], 14, { animate: true });
  };

  const handleFetchRoute = async (start, end) => {
    await nav.fetchRoute(start, end);
  };

  const handleDrive = () => {
    setShowDirections(false);
    setShowDriveModal(true);
  };

  const handleStartDriveRecord = () => {
    setShowDriveModal(false);
    setIsDriveRecording(true);
    nav.startNavigation();
  };

  const handleSkipRecord = () => {
    setShowDriveModal(false);
    nav.startNavigation();
  };

  const handleStopNav = () => {
    nav.stopNavigation();
    setIsDriveRecording(false);
    setDestination(null);
  };

  const handleHazardDetected = useCallback(async (hazard, imageBlob) => {
    const [lat, lon] = currentPositionRef.current;
    let imageUrl = null;
    if (imageBlob) {
      const fileName = `${Date.now()}_${Math.random().toString(36).slice(7)}.jpg`;
      const { data, error } = await supabase.storage.from('hazard-images').upload(fileName, imageBlob);
      if (!error && data) imageUrl = supabase.storage.from('hazard-images').getPublicUrl(fileName).data.publicUrl;
    }
    await supabase.rpc('report_hazard', {
      p_type: hazard.type, p_lat: lat, p_lon: lon,
      p_severity: hazard.severity, p_confidence: hazard.confidence || 1.0, p_image_url: imageUrl,
    });
  }, []);

  const openLiveCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      setCamStream(stream);
      if (liveCamRef.current) {
        liveCamRef.current.srcObject = stream;
        liveCamRef.current.play();
      }
    } catch (e) {
      alert('Camera access is required for reporting.');
    }
  };

  const capturePhoto = () => {
    if (!liveCamRef.current || !liveCanvasRef.current) return;
    const canvas = liveCanvasRef.current;
    canvas.width = liveCamRef.current.videoWidth;
    canvas.height = liveCamRef.current.videoHeight;
    canvas.getContext('2d').drawImage(liveCamRef.current, 0, 0);
    canvas.toBlob(blob => setCapturedPhoto(blob), 'image/jpeg', 0.85);
  };

  const stopLiveCamera = () => {
    camStream?.getTracks().forEach(t => t.stop());
    setCamStream(null);
    setCapturedPhoto(null);
  };

  useEffect(() => {
    if (activeTab === 'report') openLiveCamera();
    else stopLiveCamera();
  }, [activeTab]);

  const submitReport = async (e) => {
    e.preventDefault();
    if (!capturedPhoto) return alert('Please capture a live photo first.');
    if (!userLocation) return alert('GPS location is required. Please enable location.');
    setIsUploading(true);
    await handleHazardDetected({ type: manualType, severity: parseInt(manualSeverity), confidence: 1.0 }, capturedPhoto);
    setIsUploading(false);
    setCapturedPhoto(null);
    setActiveTab('map');
  };

  const heatmapPoints = hazards.map(h => {
    const [lat, lon] = parseLocation(h.location, initialPosition);
    return [lat, lon, h.severity_score];
  });

  const hazardEmoji = { pothole: '🕳️', crack: '⚡', waterlogging: '💧', debris: '🪨' };

  return (
    <div className="app-container">
      <div className="map-container">
        {activeTab === 'map' && (
          <>
            <SearchBar onDestinationSelect={handleDestinationSelect} onClear={() => { setDestination(null); setShowDirections(false); nav.stopNavigation(); }} />
            {destination && !showDirections && !nav.isNavigating && (
              <button
                onClick={() => setShowDirections(true)}
                style={{ position: 'absolute', bottom: 'calc(82px + env(safe-area-inset-bottom,0px) + 16px)', left: '50%', transform: 'translateX(-50%)', zIndex: 1200, padding: '12px 28px', borderRadius: 999, background: '#0A84FF', color: 'white', border: 'none', fontFamily: 'Inter, sans-serif', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 20px rgba(10,132,255,0.45)', cursor: 'pointer' }}
              >
                <Navigation size={18} /> Directions
              </button>
            )}
          </>
        )}

        <button className="gps-btn" onClick={goToLiveLocation} title="My Location">
          <LocateFixed size={20} strokeWidth={2} />
        </button>

        <button
          onClick={() => navigate('/about')}
          title="About StreetIQ"
          style={{
            position: 'absolute',
            bottom: 'calc(var(--bottom-bar-height) + var(--safe-bottom) + 124px)',
            right: 18,
            zIndex: 1200,
            width: 36, height: 36,
            borderRadius: '50%',
            background: '#fff',
            border: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 0,
            overflow: 'hidden',
          }}
        >
          <img src="/logo.png" alt="StreetIQ" style={{ width: 22, height: 22, objectFit: 'contain', display: 'block' }} />
        </button>

        <MapContainer ref={mapRef} center={initialPosition} zoom={13} zoomControl={false} style={{ height: '100%', width: '100%' }}>
          <MapController center={userLocation} isNavigating={nav.isNavigating} heading={nav.heading} />
          <LayersControl position="bottomright">
            <LayersControl.BaseLayer checked name="Dark">
              <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution="&copy; OpenStreetMap" />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name="Light">
              <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" attribution="&copy; OpenStreetMap" />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name="Satellite">
              <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="Tiles &copy; Esri" />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name="Terrain">
              <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}" attribution="Tiles &copy; Esri" />
            </LayersControl.BaseLayer>
          </LayersControl>
          <ZoomControl position="bottomleft" />
          <HeatmapLayer points={heatmapPoints} />

          {nav.route && (
            <Polyline positions={nav.route} color="#0A84FF" weight={5} opacity={0.85} />
          )}

          {destination && (
            <Marker position={[destination.lat, destination.lon]} icon={destIcon}>
              <Popup><div><strong>{destination.display_name}</strong></div></Popup>
            </Marker>
          )}

          {hazards.map((h, i) => {
            const pos = parseLocation(h.location, initialPosition);
            return (
              <Marker key={h.id || i} position={pos} icon={createHazardIcon(h.type)}>
                <Popup>
                  <div><strong>{hazardEmoji[h.type] || '⚠️'} {h.type}</strong><br />Severity: {h.severity_score} · {h.status}</div>
                </Popup>
              </Marker>
            );
          })}

          {userLocation && (
            <Marker
              position={userLocation}
              icon={L.divIcon({ className: '', html: '<div style="width:18px;height:18px;border-radius:50%;background:#0A84FF;border:3px solid white;box-shadow:0 0 0 4px rgba(10,132,255,0.25),0 2px 8px rgba(0,0,0,0.4);"></div>', iconSize: [18, 18], iconAnchor: [9, 9] })}
            >
              <Popup>Your location</Popup>
            </Marker>
          )}
        </MapContainer>
      </div>

      {nav.isNavigating && (
        <NavigationHUD step={nav.currentStep} maneuverIcon={nav.maneuverIcon} distanceToNext={nav.distanceToNext} eta={nav.eta} heading={nav.heading} speedKmh={speedKmh} onStop={handleStopNav} />
      )}

      {nav.isNavigating && isDriveRecording && model && (
        <CameraPiP userLocation={userLocation} speedKmh={speedKmh} model={model} isRecording={true} onDetection={(d) => handleHazardDetected({ type: d.type, severity: 3, confidence: d.confidence }, d.imageBlob)} />
      )}

      {showDirections && (
        <DirectionsPanel
          destination={destination}
          userLocation={userLocation}
          onFetchRoute={handleFetchRoute}
          onDrive={handleDrive}
          onClose={() => setShowDirections(false)}
          isLoading={nav.isLoading}
          routeData={nav.routeData}
        />
      )}

      {showDriveModal && <DriveModal onRecord={handleStartDriveRecord} onSkip={handleSkipRecord} />}

      {activeTab === 'record' && (
        <RecordView onHazardDetected={handleHazardDetected} isRecording={isRecording} setIsRecording={setIsRecording} userLocation={userLocation} speedKmh={speedKmh} model={model} />
      )}

      {activeTab === 'report' && (
        <div className="report-page">
          <div className="report-header">
            <h2>Report Hazard</h2>
            <p>Stand at the hazard location · Use live camera only</p>
          </div>
          <form onSubmit={submitReport}>
            <div className="report-section">
              <div className="section-label">Live Camera</div>
              <div className="ios-card" style={{ overflow: 'hidden' }}>
                <div style={{ position: 'relative', background: '#000', aspectRatio: '16/9' }}>
                  <video ref={liveCamRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', display: camStream ? 'block' : 'none' }} />
                  {!camStream && (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <Camera size={28} color="rgba(235,235,245,0.3)" />
                      <span style={{ fontSize: 13, color: 'rgba(235,235,245,0.4)', fontFamily: 'Inter, sans-serif' }}>Opening camera...</span>
                    </div>
                  )}
                  {capturedPhoto && (
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(48,209,88,0.15)', border: '2px solid #30D158', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ color: '#30D158', fontSize: 14, fontWeight: 600, fontFamily: 'Inter, sans-serif', background: 'rgba(0,0,0,0.6)', padding: '6px 12px', borderRadius: 20 }}>✓ Photo Captured</span>
                    </div>
                  )}
                  <canvas ref={liveCanvasRef} style={{ display: 'none' }} />
                </div>
                <button
                  type="button"
                  onClick={capturePhoto}
                  style={{ width: '100%', padding: 14, background: 'transparent', border: 'none', borderTop: '0.5px solid rgba(84,84,88,0.4)', color: capturedPhoto ? '#30D158' : '#0A84FF', fontSize: 15, fontWeight: 600, fontFamily: 'Inter, sans-serif', cursor: 'pointer' }}
                >
                  {capturedPhoto ? '↻ Retake Photo' : '📸 Capture Photo'}
                </button>
              </div>
            </div>

            <div className="report-section" style={{ marginTop: 16 }}>
              <div className="section-label">Hazard Type</div>
              <div className="ios-card">
                {[{ value: 'pothole', label: '🕳️  Pothole' }, { value: 'crack', label: '⚡  Road Crack' }, { value: 'waterlogging', label: '💧  Waterlogging' }, { value: 'debris', label: '🪨  Debris' }].map((opt) => (
                  <label key={opt.value} className="ios-row" style={{ cursor: 'pointer' }}>
                    <span className="ios-row-label">{opt.label}</span>
                    <input type="radio" name="type" value={opt.value} checked={manualType === opt.value} onChange={() => setManualType(opt.value)} style={{ accentColor: '#0A84FF', width: 18, height: 18 }} />
                  </label>
                ))}
              </div>
            </div>

            <div className="report-section" style={{ marginTop: 16 }}>
              <div className="section-label">Severity</div>
              <div className="ios-card">
                <div className="ios-row">
                  <span className="ios-row-label">Level</span>
                  <div className="severity-display">
                    <span className="severity-badge">{manualSeverity}</span>
                    <input type="range" className="ios-slider" min="1" max="5" value={manualSeverity} onChange={e => setManualSeverity(e.target.value)} />
                  </div>
                </div>
              </div>
            </div>

            <div className="report-section" style={{ marginTop: 16 }}>
              <div className="section-label">Location</div>
              <div className="ios-card">
                <div className="ios-row">
                  <span className="ios-row-label">📍 GPS</span>
                  <span className="ios-row-value" style={{ fontSize: 12 }}>
                    {userLocation ? `${userLocation[0].toFixed(5)}, ${userLocation[1].toFixed(5)}` : 'Acquiring...'}
                  </span>
                </div>
              </div>
            </div>

            <div className="submit-section">
              <button type="submit" className="btn-submit" disabled={isUploading || !capturedPhoto || !userLocation}>
                {isUploading ? 'Submitting...' : <><Upload size={16} /> Submit Report</>}
              </button>
            </div>
          </form>
        </div>
      )}

      <nav className="bottom-nav">
        <button className={`bottom-nav-btn ${activeTab === 'map' ? 'active' : ''}`} onClick={() => setActiveTab('map')}>
          <MapIcon size={24} strokeWidth={activeTab === 'map' ? 2.5 : 1.8} />
          <span>Map</span>
        </button>
        <div className="bottom-nav-center">
          <button className={`bottom-nav-center-btn ${activeTab === 'record' ? 'active' : ''}`} onClick={() => setActiveTab(activeTab === 'record' ? 'map' : 'record')}>
            {activeTab === 'record' ? <Square size={18} strokeWidth={2.5} /> : <Camera size={18} strokeWidth={1.8} />}
          </button>
          <span className={`bottom-nav-center-label ${activeTab === 'record' ? 'active' : ''}`}>{activeTab === 'record' ? 'Close' : 'AI Scan'}</span>
        </div>
        <button className={`bottom-nav-btn ${activeTab === 'report' ? 'active' : ''}`} onClick={() => setActiveTab('report')}>
          <PlusCircle size={24} strokeWidth={activeTab === 'report' ? 2.5 : 1.8} />
          <span>Report</span>
        </button>
      </nav>
    </div>
  );
}
