import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, ZoomControl, useMap, LayersControl, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import 'leaflet.heat';
import { useNavigate } from 'react-router-dom';
import { Map as MapIcon, Camera, PlusCircle, LocateFixed, Square, Upload, ChevronRight, Navigation, ImagePlus, Sparkles, MapPinned, AlertTriangle, Check } from 'lucide-react';
import './index.css';
import RecordView from './RecordView';
import SearchBar from './components/SearchBar';
import DirectionsPanel from './components/DirectionsPanel';
import NavigationHUD from './components/NavigationHUD';
import CameraPiP from './components/CameraPiP';
import DriveModal from './components/DriveModal';
import LocationPickerModal from './components/LocationPickerModal';
import { useNavigation } from './hooks/useNavigation';
import { useGPSLocation } from './hooks/useGPSLocation';
import { supabase, signInAnonymously } from './supabaseClient';
import * as tf from '@tensorflow/tfjs';
import { parseYoloOutput } from './utils/tfjsParser';
import { analyzeImageWithGemini } from './utils/geminiAnalyzer';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const createHazardIcon = (type, isPhotoReport = false) => L.divIcon({
  className: '',
  html: isPhotoReport
    ? `<div class="marker-pin marker-photo ${type === 'crack' ? 'marker-crack' : type === 'waterlogging' ? 'marker-water' : type === 'debris' ? 'marker-debris' : ''}"><span class="marker-unverified-dot">?</span></div>`
    : `<div class="marker-pin ${type === 'crack' ? 'marker-crack' : type === 'repaired' ? 'marker-repaired' : ''}"></div>`,
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
  if (!loc) return fallback;
  if (typeof loc === 'string') {
    const m = loc.match(/POINT\(([-0-9.]+) ([-0-9.]+)\)/);
    if (m) return [parseFloat(m[2]), parseFloat(m[1])];
    try {
      const geo = JSON.parse(loc);
      if (geo?.type === 'Point' && Array.isArray(geo.coordinates)) {
        return [geo.coordinates[1], geo.coordinates[0]];
      }
    } catch {}
  }
  if (loc?.type === 'Point' && Array.isArray(loc.coordinates)) {
    return [loc.coordinates[1], loc.coordinates[0]];
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
  const [reportStep, setReportStep] = useState(1);
  const [selectedImage, setSelectedImage] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);
  const [geminiResult, setGeminiResult] = useState(null);
  const [geminiLoading, setGeminiLoading] = useState(false);
  const [pickedLocation, setPickedLocation] = useState(null);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const fileInputRef = useRef(null);
  const reportBoundingCanvasRef = useRef(null);

  const { location: gpsLocation, speedKmh, rawLocationRef } = useGPSLocation();
  const nav = useNavigation(userLocation, speedKmh);

  useEffect(() => {
    async function loadModel() {
      try {
        await tf.setBackend('webgl');
        await tf.ready();
      } catch {
        await tf.setBackend('wasm');
        await tf.ready();
      }
      try {
        const m = await tf.loadGraphModel('/model/model.json');
        const warmup = tf.zeros([1, 640, 640, 3]);
        const out = m.execute(warmup);
        if (Array.isArray(out)) out.forEach(t => t.dispose()); else out.dispose();
        warmup.dispose();
        setModel(m);
      } catch (e) {
        console.error('Model load failed:', e);
      }
    }
    loadModel();
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
      const { data } = await supabase.from('hazards').select('*');
      if (data) setHazards(data.filter(h => h.status === 'verified' || (h.source === 'photo' && h.status === 'under_review')));
      const channel = supabase.channel(`hazards_channel_${Date.now()}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hazards' }, p => {
          const h = p.new;
          if (h.status === 'verified' || (h.source === 'photo' && h.status === 'under_review')) {
            setHazards(prev => [...prev, h]);
          }
        })
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
    } catch {
      alert('Camera access is required for live capture.');
    }
  };

  const stopLiveCamera = () => {
    camStream?.getTracks().forEach(t => t.stop());
    setCamStream(null);
  };

  const captureFromLiveCamera = () => {
    if (!liveCamRef.current || !liveCanvasRef.current) return;
    const canvas = liveCanvasRef.current;
    canvas.width = liveCamRef.current.videoWidth;
    canvas.height = liveCamRef.current.videoHeight;
    canvas.getContext('2d').drawImage(liveCamRef.current, 0, 0);
    canvas.toBlob(blob => {
      if (blob) handleImageSelected(blob);
    }, 'image/jpeg', 0.9);
  };

  const handleImageSelected = async (blob) => {
    stopLiveCamera();
    const url = URL.createObjectURL(blob);
    setSelectedImage(blob);
    setImagePreviewUrl(url);
    setGeminiResult(null);
    setReportStep(2);
    setGeminiLoading(true);
    try {
      const result = await analyzeImageWithGemini(blob);
      setGeminiResult(result);
      if (result.detected) {
        setManualType(result.type || 'pothole');
        setManualSeverity(result.severity || 3);
      }
    } catch {
      setGeminiResult({ detected: false, error: true });
    } finally {
      setGeminiLoading(false);
    }
  };

  const resetReportForm = () => {
    setReportStep(1);
    setSelectedImage(null);
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    setImagePreviewUrl(null);
    setGeminiResult(null);
    setGeminiLoading(false);
    setPickedLocation(null);
    setManualType('pothole');
    setManualSeverity(3);
    setSubmitSuccess(false);
    setCapturedPhoto(null);
  };

  useEffect(() => {
    if (activeTab === 'report') {
      resetReportForm();
      openLiveCamera();
    } else {
      stopLiveCamera();
    }
  }, [activeTab]);

  const submitPhotoReport = async () => {
    if (!selectedImage) return;
    const loc = pickedLocation || (userLocation ? { lat: userLocation[0], lon: userLocation[1] } : null);
    if (!loc) return alert('Please pick a location on the map.');
    setIsUploading(true);
    const optimisticId = `optimistic_${Date.now()}`;
    const optimisticHazard = {
      id: optimisticId,
      type: manualType,
      severity_score: parseInt(manualSeverity),
      confidence_score: geminiResult?.confidence || 0.5,
      status: 'under_review',
      source: 'photo',
      location: `POINT(${loc.lon} ${loc.lat})`,
      image_url: null,
      created_at: new Date().toISOString(),
    };
    setHazards(prev => [...prev, optimisticHazard]);
    try {
      let imageUrl = null;
      const fileName = `photo_${Date.now()}_${Math.random().toString(36).slice(7)}.jpg`;
      const { data: uploadData, error: uploadErr } = await supabase.storage.from('hazard-images').upload(fileName, selectedImage);
      if (!uploadErr && uploadData) {
        imageUrl = supabase.storage.from('hazard-images').getPublicUrl(fileName).data.publicUrl;
      }
      const { data: rpcData, error: rpcErr } = await supabase.rpc('report_hazard_photo', {
        p_type: manualType,
        p_lat: loc.lat,
        p_lon: loc.lon,
        p_severity: parseInt(manualSeverity),
        p_confidence: geminiResult?.confidence || 0.5,
        p_image_url: imageUrl,
      });
      if (rpcErr) throw rpcErr;
      if (rpcData) {
        setHazards(prev => prev.map(h => h.id === optimisticId ? { ...optimisticHazard, id: rpcData, image_url: imageUrl } : h));
      }
      setSubmitSuccess(true);
      setTimeout(() => {
        resetReportForm();
        setActiveTab('map');
      }, 1800);
    } catch (err) {
      console.error('Report submission error:', err);
      setHazards(prev => prev.filter(h => h.id !== optimisticId));
      alert(`Submission failed: ${err?.message || err}`);
    } finally {
      setIsUploading(false);
    }
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
            const isPhotoReport = h.source === 'photo' && h.status === 'under_review';
            return (
              <Marker key={h.id || i} position={pos} icon={createHazardIcon(h.type, isPhotoReport)}>
                <Popup>
                  <div style={{ fontFamily: 'Inter, sans-serif' }}>
                    <strong>{hazardEmoji[h.type] || '⚠️'} {h.type}</strong>
                    {isPhotoReport && (
                      <span style={{ display: 'inline-block', marginLeft: 6, fontSize: 10, fontWeight: 600, background: 'rgba(255,159,10,0.2)', color: '#FF9F0A', border: '1px solid rgba(255,159,10,0.4)', borderRadius: 10, padding: '1px 7px' }}>
                        ⚠ Unverified
                      </span>
                    )}
                    <br />
                    Severity: {h.severity_score}
                    {isPhotoReport && <><br /><span style={{ fontSize: 11, color: 'rgba(235,235,245,0.55)' }}>Photo report · Pending sensor confirmation</span></>}
                  </div>
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h2>Report Hazard</h2>
                <p>Photo-based · AI-verified · Community powered</p>
              </div>
              <div className="report-step-indicator">
                {[1, 2, 3].map(s => (
                  <div key={s} className={`step-dot ${reportStep === s ? 'active' : reportStep > s ? 'done' : ''}`} />
                ))}
              </div>
            </div>
          </div>

          {submitSuccess && (
            <div className="submit-success-overlay">
              <div className="submit-success-card">
                <div className="success-icon">✓</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: '#fff', marginTop: 12 }}>Reported!</div>
                <div style={{ fontSize: 13, color: 'rgba(235,235,245,0.6)', marginTop: 6 }}>Appearing on the map now</div>
              </div>
            </div>
          )}

          {reportStep === 1 && (
            <div style={{ padding: '20px' }}>
              <div className="section-label">Choose Photo Source</div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="photo-source-btn"
                >
                  <ImagePlus size={20} />
                  <span>Upload from Gallery</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handleImageSelected(file);
                    e.target.value = '';
                  }}
                />
              </div>

              <div className="section-label" style={{ marginTop: 16 }}>Or Take a Live Photo</div>
              <div className="ios-card" style={{ overflow: 'hidden' }}>
                <div style={{ position: 'relative', background: '#000', aspectRatio: '16/9' }}>
                  <video ref={liveCamRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', display: camStream ? 'block' : 'none' }} />
                  {!camStream && (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <Camera size={28} color="rgba(235,235,245,0.3)" />
                      <span style={{ fontSize: 13, color: 'rgba(235,235,245,0.4)', fontFamily: 'Inter, sans-serif' }}>Opening camera...</span>
                    </div>
                  )}
                  <canvas ref={liveCanvasRef} style={{ display: 'none' }} />
                </div>
                <button
                  type="button"
                  onClick={captureFromLiveCamera}
                  disabled={!camStream}
                  style={{ width: '100%', padding: 14, background: 'transparent', border: 'none', borderTop: '0.5px solid rgba(84,84,88,0.4)', color: camStream ? '#0A84FF' : 'rgba(84,84,88,0.6)', fontSize: 15, fontWeight: 600, fontFamily: 'Inter, sans-serif', cursor: camStream ? 'pointer' : 'not-allowed' }}
                >
                  📸 Capture Photo
                </button>
              </div>
            </div>
          )}

          {reportStep === 2 && (
            <div style={{ padding: '20px' }}>
              <div className="section-label">AI Analysis</div>
              <div className="ios-card" style={{ overflow: 'hidden', marginBottom: 16 }}>
                <div style={{ position: 'relative', aspectRatio: '16/9', background: '#000' }}>
                  {imagePreviewUrl && (
                    <img src={imagePreviewUrl} alt="Hazard" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  )}
                  {geminiLoading && (
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                      <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid rgba(10,132,255,0.3)', borderTopColor: '#0A84FF', animation: 'spin 0.8s linear infinite' }} />
                      <span style={{ fontSize: 13, color: 'rgba(235,235,245,0.7)', fontFamily: 'Inter, sans-serif' }}>Analysing image...</span>
                    </div>
                  )}
                  {!geminiLoading && geminiResult && (
                    <div style={{ position: 'absolute', top: 10, right: 10 }}>
                      {geminiResult.detected
                        ? <span className="gemini-badge gemini-badge-detected">✨ Hazard Detected</span>
                        : <span className="gemini-badge gemini-badge-none">No hazard detected</span>
                      }
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => { setReportStep(1); openLiveCamera(); }}
                  style={{ width: '100%', padding: 12, background: 'transparent', border: 'none', borderTop: '0.5px solid rgba(84,84,88,0.4)', color: 'rgba(235,235,245,0.5)', fontSize: 13, fontWeight: 500, fontFamily: 'Inter, sans-serif', cursor: 'pointer' }}
                >
                  ↩ Choose different photo
                </button>
              </div>

              {!geminiLoading && geminiResult && !geminiResult.detected && (
                <div className="gemini-warning-card">
                  <AlertTriangle size={16} color="#FF9F0A" />
                  <span>{geminiResult.unavailable ? 'AI analysis unavailable — select type manually' : 'No hazard detected by AI — you can still submit manually'}</span>
                </div>
              )}

              <div className="section-label" style={{ marginTop: 16 }}>
                Hazard Type
                {!geminiLoading && geminiResult?.detected && (
                  <span className="autofill-badge">✦ Auto-detected & filled by AI</span>
                )}
              </div>
              <div className="ios-card">
                {[{ value: 'pothole', label: '🕳️  Pothole' }, { value: 'crack', label: '⚡  Road Crack' }, { value: 'waterlogging', label: '💧  Waterlogging' }, { value: 'debris', label: '🪨  Debris' }].map((opt) => (
                  <label key={opt.value} className="ios-row" style={{ cursor: 'pointer' }}>
                    <span className="ios-row-label">{opt.label}</span>
                    <input type="radio" name="type" value={opt.value} checked={manualType === opt.value} onChange={() => setManualType(opt.value)} style={{ accentColor: '#0A84FF', width: 18, height: 18 }} />
                  </label>
                ))}
              </div>

              <div className="section-label" style={{ marginTop: 16 }}>
                Severity
                {!geminiLoading && geminiResult?.detected && (
                  <span className="autofill-badge">✦ Auto-detected & filled by AI</span>
                )}
              </div>
              <div className="ios-card">
                <div className="ios-row">
                  <span className="ios-row-label">Level</span>
                  <div className="severity-display">
                    <span className="severity-badge">{manualSeverity}</span>
                    <input type="range" className="ios-slider" min="1" max="5" value={manualSeverity} onChange={e => setManualSeverity(e.target.value)} />
                  </div>
                </div>
              </div>

              <div className="submit-section">
                <button
                  type="button"
                  onClick={() => setReportStep(3)}
                  disabled={geminiLoading}
                  className="btn-submit"
                  style={{ background: geminiLoading ? 'rgba(84,84,88,0.4)' : '#0A84FF' }}
                >
                  Next: Pick Location →
                </button>
              </div>
            </div>
          )}

          {reportStep === 3 && (
            <div style={{ padding: '20px' }}>
              <div className="section-label">Hazard Location</div>
              <div
                className="ios-card location-pick-card"
                onClick={() => setShowLocationPicker(true)}
                style={{ cursor: 'pointer' }}
              >
                <div className="ios-row">
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(10,132,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <MapPinned size={18} color="#0A84FF" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, color: '#fff', fontFamily: 'Inter, sans-serif', fontWeight: 500 }}>
                      {pickedLocation ? `${pickedLocation.lat.toFixed(5)}, ${pickedLocation.lon.toFixed(5)}` : 'Tap to pick location on map'}
                    </div>
                    {!pickedLocation && userLocation && (
                      <div style={{ fontSize: 12, color: 'rgba(235,235,245,0.5)', marginTop: 2 }}>
                        GPS available — or choose manually
                      </div>
                    )}
                  </div>
                  <ChevronRight size={18} color="rgba(235,235,245,0.35)" />
                </div>
              </div>

              {!pickedLocation && userLocation && (
                <button
                  type="button"
                  onClick={() => setPickedLocation({ lat: userLocation[0], lon: userLocation[1] })}
                  className="gps-quick-fill-btn"
                >
                  <LocateFixed size={14} />
                  Use my GPS location
                </button>
              )}

              {pickedLocation && (
                <button
                  type="button"
                  onClick={() => setShowLocationPicker(true)}
                  style={{ marginTop: 8, width: '100%', padding: '10px 0', background: 'transparent', border: 'none', color: 'rgba(10,132,255,0.9)', fontSize: 14, fontWeight: 500, fontFamily: 'Inter, sans-serif', cursor: 'pointer' }}
                >
                  ✎ Change Location
                </button>
              )}

              <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setReportStep(2)}
                  style={{ flex: 1, padding: 14, borderRadius: 12, background: 'rgba(44,44,46,0.8)', border: '0.5px solid rgba(84,84,88,0.5)', color: 'rgba(235,235,245,0.7)', fontSize: 15, fontWeight: 600, fontFamily: 'Inter, sans-serif', cursor: 'pointer' }}
                >
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={submitPhotoReport}
                  disabled={isUploading || (!pickedLocation && !userLocation)}
                  className="btn-submit"
                  style={{ flex: 2, opacity: isUploading || (!pickedLocation && !userLocation) ? 0.4 : 1 }}
                >
                  {isUploading ? 'Submitting...' : <><Upload size={16} /> Submit Report</>}
                </button>
              </div>
            </div>
          )}

          {showLocationPicker && (
            <LocationPickerModal
              initialLocation={pickedLocation ? [pickedLocation.lat, pickedLocation.lon] : userLocation}
              onConfirm={(loc) => { setPickedLocation(loc); setShowLocationPicker(false); }}
              onClose={() => setShowLocationPicker(false)}
            />
          )}
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
