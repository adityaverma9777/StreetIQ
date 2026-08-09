import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, ZoomControl, useMap, LayersControl, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import 'leaflet.heat';
import { useNavigate } from 'react-router-dom';
import { Map as MapIcon, Camera, PlusCircle, LocateFixed, Square, Upload, Navigation, AlertTriangle, Wifi, Mic, Check } from 'lucide-react';
import './index.css';
import RecordView from './RecordView';
import SearchBar from './components/SearchBar';
import DirectionsPanel from './components/DirectionsPanel';
import NavigationHUD from './components/NavigationHUD';
import CameraPiP from './components/CameraPiP';
import DriveModal from './components/DriveModal';
import { useNavigation } from './hooks/useNavigation';
import { useGPSLocation } from './hooks/useGPSLocation';
import { useVoiceAssistant } from './hooks/useVoiceAssistant';
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

const parseWKBHex = (hex) => {
  try {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    const view = new DataView(bytes.buffer);
    const le = view.getUint8(0) === 1;
    const type = view.getUint32(1, le);
    const hasSRID = (type & 0x20000000) !== 0;
    const offset = 5 + (hasSRID ? 4 : 0);
    const lon = view.getFloat64(offset, le);
    const lat = view.getFloat64(offset + 8, le);
    if (isFinite(lat) && isFinite(lon)) return [lat, lon];
  } catch {}
  return null;
};
const parseLocation = (loc, fallback) => {
  if (!loc) return fallback;
  if (typeof loc === 'string') {
    if (/^[0-9a-fA-F]{10,}$/.test(loc)) {
      const r = parseWKBHex(loc);
      if (r) return r;
    }
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
  const [submitSuccess, setSubmitSuccess] = useState(false);


  const { location: gpsLocation, speedKmh, rawLocationRef } = useGPSLocation();
  const nav = useNavigation(userLocation, speedKmh);

  const handleVoiceIntent = useCallback(async (intent) => {
    const speak = (text) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      window.speechSynthesis.speak(utterance);
    };

    if (!userLocation) {
      speak("GPS location not available, sir.");
      return;
    }
    speak("Reported sir.");

    try {
      let blob = null;
      let streamToStop = null;
      let videoEl = liveCamRef.current;

      if (!videoEl || !camStream) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        streamToStop = stream;
        videoEl = document.createElement('video');
        videoEl.srcObject = stream;
        await videoEl.play();
        await new Promise(r => setTimeout(r, 600)); // wait for exposure
      }

      const canvas = document.createElement('canvas');
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      canvas.getContext('2d').drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));

      if (streamToStop) {
        streamToStop.getTracks().forEach(t => t.stop());
      }

      const optimisticId = `optimistic_voice_${Date.now()}`;
      setHazards(prev => [...prev, {
        id: optimisticId,
        type: 'pending_voice',
        severity_score: 3,
        status: 'under_review',
        source: 'voice',
        location: `POINT(${userLocation[1]} ${userLocation[0]})`,
        created_at: new Date().toISOString(),
      }]);

      const result = await analyzeImageWithGemini(blob, intent);
      let hazardType = result.type || 'pothole';
      let hazardSeverity = result.severity || 3;
      let hazardStatus = result.detected ? 'verified' : 'under_review';

      let imageUrl = null;
      const fileName = `voice_${Date.now()}_${Math.random().toString(36).slice(7)}.jpg`;
      const { data: uploadData, error: uploadErr } = await supabase.storage.from('hazard-images').upload(fileName, blob);
      if (!uploadErr && uploadData) {
        imageUrl = supabase.storage.from('hazard-images').getPublicUrl(fileName).data.publicUrl;
      }

      const { data: rpcData, error: rpcErr } = await supabase.rpc('report_hazard_photo', {
        p_type: hazardType,
        p_lat: userLocation[0],
        p_lon: userLocation[1],
        p_severity: hazardSeverity,
        p_confidence: result.confidence || 0.5,
        p_image_url: imageUrl,
      });

      if (rpcErr) throw rpcErr;
      
      if (hazardStatus === 'verified') {
        await supabase.rpc('admin_update_hazard', { p_hazard_id: rpcData, p_type: hazardType, p_severity: hazardSeverity, p_status: 'verified' });
      }

      setHazards(prev => prev.map(h => h.id === optimisticId ? { ...h, id: rpcData, type: hazardType, severity_score: hazardSeverity, status: hazardStatus, image_url: imageUrl, source: 'voice' } : h));

    } catch (e) {
      console.error('Voice report failed:', e);
    }
  }, [userLocation, camStream]);

  const voice = useVoiceAssistant(handleVoiceIntent);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      const tryBackend = async (name) => {
        try {
          await tf.setBackend(name);
          await Promise.race([
            tf.ready(),
            new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 4000)),
          ]);
          return true;
        } catch { return false; }
      };
      let ready = false;
      for (const b of ['webgl', 'wasm', 'cpu']) {
        ready = await tryBackend(b);
        if (ready) { console.log(`[StreetIQ] TF backend: ${b}`); break; }
      }
      if (!ready || cancelled) { console.warn('[StreetIQ] No TF backend — AI scan disabled'); return; }
      try {
        const m = await tf.loadGraphModel('/model/model.json?v=3');
        if (!cancelled) { setModel(m); console.log('[StreetIQ] Model ready'); }
      } catch (e) {
        console.warn('[StreetIQ] Model load failed:', e.message);
      }
    }, 2000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  // Wake up the backend server on Render (free tier)
  useEffect(() => {
    const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
    fetch(`${BACKEND_URL}/health`)
      .then(res => res.json())
      .then(data => console.log('[StreetIQ] Backend woke up:', data.status))
      .catch(err => console.warn('[StreetIQ] Wake request failed:', err));
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
    let channel;
    async function init() {
      try { await signInAnonymously(); } catch {}
      try {
        const { data } = await supabase.from('hazards').select('*');
        if (data) setHazards(data.filter(h => h.status === 'verified' || (h.source === 'photo' && h.status === 'under_review')));
      } catch {}
      try {
        channel = supabase.channel(`hazards_channel_${Date.now()}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hazards' }, p => {
            const h = p.new;
            if (h.status === 'verified' || (h.source === 'photo' && h.status === 'under_review')) {
              setHazards(prev => [...prev, h]);
            }
          })
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'hazards' }, p => setHazards(prev => prev.map(h => h.id === p.new.id ? p.new : h)))
          .subscribe();
      } catch {}
    }
    init();
    return () => { if (channel) supabase.removeChannel(channel); };
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
    if (!userLocation) return alert('GPS location not available. Please wait for GPS signal.');
    const loc = { lat: userLocation[0], lon: userLocation[1] };
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

        <button
          className={`voice-btn ${voice.isListening ? 'active' : ''} ${voice.isAwake ? 'awake' : ''}`}
          onClick={voice.toggleListening}
          title="Voice Assistant"
        >
          <Mic size={18} strokeWidth={voice.isListening ? 2.5 : 2} />
        </button>

        <MapContainer ref={mapRef} center={initialPosition} zoom={13} zoomControl={false} style={{ height: '100%', width: '100%' }}>
          <MapController center={userLocation} isNavigating={nav.isNavigating} heading={nav.heading} />
        <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap &copy; CARTO"
            subdomains="abcd"
            maxZoom={19}
            crossOrigin="anonymous"
          />
          <LayersControl position="bottomright">
            <LayersControl.BaseLayer checked name="Dark">
              <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" subdomains="abcd" maxZoom={19} crossOrigin="anonymous" />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name="Light">
              <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" subdomains="abcd" maxZoom={19} crossOrigin="anonymous" />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name="Satellite">
              <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="Tiles &copy; Esri" crossOrigin="anonymous" />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name="Terrain">
              <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}" attribution="Tiles &copy; Esri" crossOrigin="anonymous" />
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
                    {h.status === 'verified' && (h.source === 'voice' || h.source === 'photo') && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 6, fontSize: 10, fontWeight: 700, background: 'rgba(48,209,88,0.15)', color: '#30D158', border: '1px solid rgba(48,209,88,0.4)', borderRadius: 10, padding: '1px 7px' }}>
                        <Check size={10} strokeWidth={3} /> AI Verified
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
            <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ position: 'relative', flex: 1, background: '#000', overflow: 'hidden' }}>
                <video
                  ref={liveCamRef}
                  autoPlay
                  playsInline
                  muted
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: camStream ? 'block' : 'none' }}
                />
                {!camStream && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                    <div style={{ width: 48, height: 48, borderRadius: '50%', border: '3px solid rgba(10,132,255,0.3)', borderTopColor: '#0A84FF', animation: 'spin 0.8s linear infinite' }} />
                    <span style={{ fontSize: 14, color: 'rgba(235,235,245,0.5)', fontFamily: 'Inter, sans-serif' }}>Opening camera...</span>
                  </div>
                )}
                <canvas ref={liveCanvasRef} style={{ display: 'none' }} />
                <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(10px)', borderRadius: 20, padding: '6px 16px', border: '0.5px solid rgba(255,255,255,0.12)' }}>
                  <span style={{ fontSize: 12, color: 'rgba(235,235,245,0.8)', fontFamily: 'Inter, sans-serif', fontWeight: 500, letterSpacing: 0.3 }}>🔴 LIVE — Point at the hazard</span>
                </div>
                <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                  <div style={{ position: 'absolute', top: '20%', left: '10%', width: 28, height: 28, borderTop: '2px solid rgba(255,255,255,0.5)', borderLeft: '2px solid rgba(255,255,255,0.5)', borderRadius: '3px 0 0 0' }} />
                  <div style={{ position: 'absolute', top: '20%', right: '10%', width: 28, height: 28, borderTop: '2px solid rgba(255,255,255,0.5)', borderRight: '2px solid rgba(255,255,255,0.5)', borderRadius: '0 3px 0 0' }} />
                  <div style={{ position: 'absolute', bottom: '20%', left: '10%', width: 28, height: 28, borderBottom: '2px solid rgba(255,255,255,0.5)', borderLeft: '2px solid rgba(255,255,255,0.5)', borderRadius: '0 0 0 3px' }} />
                  <div style={{ position: 'absolute', bottom: '20%', right: '10%', width: 28, height: 28, borderBottom: '2px solid rgba(255,255,255,0.5)', borderRight: '2px solid rgba(255,255,255,0.5)', borderRadius: '0 0 3px 0' }} />
                </div>
              </div>
              <div style={{ padding: '20px 20px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, background: '#000' }}>
                <button
                  type="button"
                  onClick={captureFromLiveCamera}
                  disabled={!camStream}
                  style={{
                    width: 72, height: 72,
                    borderRadius: '50%',
                    background: camStream ? '#fff' : 'rgba(84,84,88,0.4)',
                    border: `4px solid ${camStream ? 'rgba(255,255,255,0.3)' : 'rgba(84,84,88,0.2)'}`,
                    cursor: camStream ? 'pointer' : 'not-allowed',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: camStream ? '0 0 0 2px rgba(255,255,255,0.15), 0 4px 20px rgba(0,0,0,0.6)' : 'none',
                    transition: 'transform 0.1s ease',
                  }}
                >
                  <Camera size={28} color={camStream ? '#1C1C1E' : 'rgba(84,84,88,0.6)'} />
                </button>
                <span style={{ fontSize: 12, color: 'rgba(235,235,245,0.4)', fontFamily: 'Inter, sans-serif' }}>Tap to capture live photo</span>
              </div>
            </div>
          )}

          {reportStep === 2 && (
            <div style={{ padding: '20px', flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
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
                  ↩ Retake photo
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
                  Next: Confirm Location →
                </button>
              </div>
            </div>
          )}

          {reportStep === 3 && (
            <div style={{ padding: '20px', flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <div className="section-label">Hazard Location</div>
              <div className="ios-card" style={{ overflow: 'hidden', marginBottom: 16 }}>
                <div style={{ padding: '16px 16px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(48,209,88,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <LocateFixed size={18} color="#30D158" />
                    </div>
                    <div>
                      <div style={{ fontSize: 13, color: 'rgba(235,235,245,0.5)', fontFamily: 'Inter, sans-serif', marginBottom: 2 }}>Live GPS Location</div>
                      <div style={{ fontSize: 15, color: '#fff', fontFamily: 'Inter, sans-serif', fontWeight: 600, letterSpacing: 0.2 }}>
                        {userLocation ? `${userLocation[0].toFixed(6)}, ${userLocation[1].toFixed(6)}` : 'Acquiring GPS...'}
                      </div>
                    </div>
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: userLocation ? '#30D158' : '#FF9F0A', boxShadow: userLocation ? '0 0 6px #30D158' : '0 0 6px #FF9F0A', animation: 'pulse 1.5s ease-in-out infinite' }} />
                      <span style={{ fontSize: 11, color: userLocation ? '#30D158' : '#FF9F0A', fontFamily: 'Inter, sans-serif', fontWeight: 600 }}>{userLocation ? 'LOCKED' : 'SEARCHING'}</span>
                    </div>
                  </div>
                </div>
                <div style={{ background: 'rgba(48,209,88,0.06)', borderTop: '0.5px solid rgba(48,209,88,0.2)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Wifi size={12} color="rgba(48,209,88,0.7)" />
                  <span style={{ fontSize: 12, color: 'rgba(48,209,88,0.7)', fontFamily: 'Inter, sans-serif' }}>Location is automatically set from your device GPS</span>
                </div>
              </div>
              {!userLocation && (
                <div className="gemini-warning-card" style={{ marginBottom: 16 }}>
                  <AlertTriangle size={16} color="#FF9F0A" />
                  <span>Waiting for GPS signal — please enable location services</span>
                </div>
              )}
              <div style={{ marginTop: 8, display: 'flex', gap: 10 }}>
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
                  disabled={isUploading || !userLocation}
                  className="btn-submit"
                  style={{ flex: 2, opacity: isUploading || !userLocation ? 0.4 : 1 }}
                >
                  {isUploading ? 'Submitting...' : <><Upload size={16} /> Submit Report</>}
                </button>
              </div>
            </div>
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
