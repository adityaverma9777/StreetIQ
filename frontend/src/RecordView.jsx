import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Camera, Play, Square, Film } from 'lucide-react';
import * as tf from '@tensorflow/tfjs';
import { parseYoloOutput } from './utils/tfjsParser';
import { supabase } from './supabaseClient';
import { useMotionGate } from './hooks/useMotionGate';
import VideoAnalysis from './components/VideoAnalysis';

const SESSION_ID = crypto.randomUUID();

export default function RecordView({ onHazardDetected, isRecording, setIsRecording, userLocation, speedKmh, model }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [showVideoAnalysis, setShowVideoAnalysis] = useState(false);
  const [fpsTarget, setFpsTarget] = useState(15);
  const [inferenceActive, setInferenceActive] = useState(false);
  const [useFixture, setUseFixture] = useState(false);

  const { handlePosition, cleanup } = useMotionGate(
    useCallback(() => setInferenceActive(true), []),
    useCallback(() => { setInferenceActive(false); setIsRecording(false); }, [setIsRecording])
  );

  useEffect(() => {
    if (speedKmh !== undefined) handlePosition({ coords: { speed: speedKmh / 3.6 } });
  }, [speedKmh, handlePosition]);

  useEffect(() => () => cleanup(), [cleanup]);

  const requestCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) { videoRef.current.srcObject = stream; setPermissionGranted(true); setUseFixture(false); }
    } catch {
      setUseFixture(true); setPermissionGranted(true);
      if (videoRef.current) { videoRef.current.src = '/test_dashcam_clip.mp4'; videoRef.current.loop = true; }
    }
  };

  const toggleFixture = () => {
    const next = !useFixture;
    setUseFixture(next); setPermissionGranted(true);
    if (videoRef.current) {
      if (next) { videoRef.current.srcObject = null; videoRef.current.src = '/test_dashcam_clip.mp4'; videoRef.current.loop = true; videoRef.current.play().catch(() => {}); }
      else { videoRef.current.src = ''; requestCamera(); }
    }
  };

  useEffect(() => {
    if (!isRecording || !inferenceActive || !model || !permissionGranted) return;
    let frameId;
    let lastTime = 0;
    const INTERVAL = 1000 / fpsTarget;

    const processFrame = async (timestamp) => {
      frameId = requestAnimationFrame(processFrame);
      if (timestamp - lastTime < INTERVAL) return;
      lastTime = timestamp;
      if (!videoRef.current || videoRef.current.readyState !== 4) return;

      const inferenceStart = performance.now();
      tf.engine().startScope();
      try {
        const tensor = tf.browser.fromPixels(videoRef.current)
          .resizeBilinear([640, 640]).expandDims(0).toFloat();
        const predictions = await model.executeAsync(tensor);
        const detections = await parseYoloOutput(predictions, 0.5);

        if (detections.length > 0 && userLocation) {
          const best = detections[0];
          let imageBlob = null;
          if (canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            canvasRef.current.width = videoRef.current.videoWidth;
            canvasRef.current.height = videoRef.current.videoHeight;
            ctx.drawImage(videoRef.current, 0, 0);
            imageBlob = await new Promise(r => canvasRef.current.toBlob(r, 'image/jpeg', 0.8));
          }
          await supabase.rpc('insert_road_scan', {
            p_session_id: SESSION_ID,
            p_lat: userLocation[0],
            p_lon: userLocation[1],
            p_detected_type: best.className,
            p_confidence: best.confidence,
            p_speed_kmh: speedKmh || 0,
            p_source: 'ai_scan',
          });
          onHazardDetected({ type: best.className, severity: best.confidence > 0.8 ? 5 : 3, confidence: best.confidence }, imageBlob);
        }
        const elapsed = performance.now() - inferenceStart;
        if (elapsed > 200 && fpsTarget > 2) setFpsTarget(2);
        else if (elapsed > 100 && fpsTarget > 5) setFpsTarget(5);
      } catch (e) {
        console.error('Inference error:', e);
      } finally {
        tf.engine().endScope();
      }
    };

    frameId = requestAnimationFrame(processFrame);
    return () => cancelAnimationFrame(frameId);
  }, [isRecording, inferenceActive, fpsTarget, model, permissionGranted, userLocation, speedKmh, onHazardDetected]);

  return (
    <div className="camera-overlay">
      {showVideoAnalysis && (
        <VideoAnalysis model={model} />
      )}
      <div className="camera-view">
        <video ref={videoRef} autoPlay playsInline muted style={{ display: permissionGranted ? 'block' : 'none' }} />
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        {!permissionGranted && (
          <div className="camera-permission-screen">
            <Camera size={52} color="rgba(235,235,245,0.3)" />
            <p>Allow camera access to start AI-powered road hazard detection</p>
            <button className="btn-record start" style={{ marginTop: 8, fontSize: 15 }} onClick={requestCamera}>Grant Camera Access</button>
            <button
              onClick={() => setShowVideoAnalysis(true)}
              style={{ background: 'none', border: '0.5px solid rgba(84,84,88,0.5)', color: 'rgba(235,235,245,0.7)', fontSize: 14, fontFamily: 'Inter, sans-serif', cursor: 'pointer', padding: '10px 18px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 7, marginTop: 4 }}
            >
              <Film size={15} /> How We Work
            </button>
          </div>
        )}
        {permissionGranted && (
          <div className="camera-status-bar">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)', borderRadius: 20, padding: '5px 12px' }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: isRecording && inferenceActive ? 'var(--ios-red)' : 'rgba(235,235,245,0.3)', animation: isRecording && inferenceActive ? 'pulse 1.5s infinite' : 'none' }} />
              <span style={{ fontSize: 12, color: 'rgba(235,235,245,0.8)', fontFamily: 'Inter, sans-serif' }}>
                {isRecording && inferenceActive ? `Scanning · ${fpsTarget} fps` : isRecording ? 'Paused — move to scan' : 'Ready'}
              </span>
            </div>
            <button onClick={toggleFixture} style={{ marginLeft: 'auto', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)', border: 'none', borderRadius: 20, padding: '5px 12px', color: 'var(--ios-blue)', fontSize: 12, fontFamily: 'Inter, sans-serif', cursor: 'pointer' }}>
              {useFixture ? 'Fixture' : 'Live'}
            </button>
          </div>
        )}
        {speedKmh !== undefined && permissionGranted && (
          <div style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)', borderRadius: 12, padding: '6px 12px' }}>
            <span style={{ fontSize: 13, color: 'white', fontFamily: 'Inter, sans-serif', fontWeight: 600 }}>{Math.round(speedKmh)} <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.7 }}>km/h</span></span>
          </div>
        )}
      </div>
      {permissionGranted && (
        <div className="camera-controls">
          <button className={`btn-record ${isRecording ? 'stop' : 'start'}`} onClick={() => setIsRecording(!isRecording)}>
            {isRecording ? <Square size={18} fill="white" strokeWidth={0} /> : <Play size={18} fill="white" strokeWidth={0} />}
            {isRecording ? 'Stop Scan' : 'Start Scan'}
          </button>
        </div>
      )}
    </div>
  );
}
