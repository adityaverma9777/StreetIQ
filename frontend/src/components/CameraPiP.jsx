import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Minimize2, Maximize2 } from 'lucide-react';
import * as tf from '@tensorflow/tfjs';
import { parseYoloOutput } from '../utils/tfjsParser';
import { supabase } from '../supabaseClient';
import { useMotionGate } from '../hooks/useMotionGate';

const SESSION_ID = crypto.randomUUID();

export default function CameraPiP({ userLocation, speedKmh, model, isRecording, onDetection }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [minimized, setMinimized] = useState(false);
  const [inferenceActive, setInferenceActive] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);

  const { handlePosition, cleanup } = useMotionGate(
    useCallback(() => setInferenceActive(true), []),
    useCallback(() => setInferenceActive(false), [])
  );

  useEffect(() => {
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setPermissionGranted(true);
        }
      } catch { setPermissionGranted(false); }
    })();
    return () => {
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(t => t.stop());
      }
      cleanup();
    };
  }, [cleanup]);

  useEffect(() => {
    if (speedKmh !== undefined) {
      handlePosition({ coords: { speed: speedKmh / 3.6 } });
    }
  }, [speedKmh, handlePosition]);

  useEffect(() => {
    if (!isRecording || !inferenceActive || !model || !permissionGranted) return;
    let frameId;
    let lastTime = 0;
    const INTERVAL = 1000;

    const runInference = async (timestamp) => {
      frameId = requestAnimationFrame(runInference);
      if (timestamp - lastTime < INTERVAL) return;
      lastTime = timestamp;
      if (!videoRef.current || videoRef.current.readyState !== 4) return;

      tf.engine().startScope();
      try {
        const tensor = tf.browser.fromPixels(videoRef.current)
          .resizeBilinear([640, 640]).expandDims(0).toFloat().div(255.0);
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
            imageBlob = await new Promise(r => canvasRef.current.toBlob(r, 'image/jpeg', 0.7));
          }
          await supabase.rpc('insert_road_scan', {
            p_session_id: SESSION_ID,
            p_lat: userLocation[0],
            p_lon: userLocation[1],
            p_detected_type: best.className,
            p_confidence: best.confidence,
            p_speed_kmh: speedKmh || 0,
            p_source: 'drive_scan',
          });
          onDetection?.({ type: best.className, confidence: best.confidence, imageBlob });
        }
      } catch (e) {
        console.error('PiP inference error:', e);
      } finally {
        tf.engine().endScope();
      }
    };

    frameId = requestAnimationFrame(runInference);
    return () => cancelAnimationFrame(frameId);
  }, [isRecording, inferenceActive, model, permissionGranted, userLocation, speedKmh, onDetection]);

  const size = minimized
    ? { width: 80, height: 60 }
    : { width: 160, height: 120 };

  return (
    <div style={{
      position: 'fixed',
      top: 'calc(env(safe-area-inset-top, 0px) + 84px)',
      left: 12,
      zIndex: 1800,
      width: size.width,
      height: size.height,
      borderRadius: 12,
      overflow: 'hidden',
      background: '#000',
      border: '0.5px solid rgba(84,84,88,0.65)',
      boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      transition: 'all 0.25s ease',
    }}>
      <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', display: permissionGranted ? 'block' : 'none' }} />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      {!permissionGranted && (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1C1C1E' }}>
          <span style={{ fontSize: 10, color: 'rgba(235,235,245,0.4)', textAlign: 'center', fontFamily: 'Inter, sans-serif' }}>No Camera</span>
        </div>
      )}
      {inferenceActive && isRecording && (
        <div style={{ position: 'absolute', top: 4, left: 4, width: 6, height: 6, borderRadius: '50%', background: '#FF453A', animation: 'pulse 1.5s infinite' }} />
      )}
      <button
        onClick={() => setMinimized(m => !m)}
        style={{ position: 'absolute', bottom: 3, right: 3, background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: 6, width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
      >
        {minimized ? <Maximize2 size={10} color="white" /> : <Minimize2 size={10} color="white" />}
      </button>
    </div>
  );
}
