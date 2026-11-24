import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Play, Square, X, Film, Activity, Cpu, Zap, ShieldCheck, Gauge } from 'lucide-react';
import * as tf from '@tensorflow/tfjs';
import { parseYoloOutputAll, runInference } from '../utils/tfjsParser';
import { checkGpuServerHealth, predictFrameGpu } from '../utils/gpuService';

const LABEL_COLORS = {
  'Longitudinal / Transverse Crack': '#007AFF',
  'Longitudinal Crack': '#007AFF',
  'Transverse Crack': '#5E5CE6',
  'Alligator Crack': '#FF9F0A',
  'Block Crack': '#AF52DE',
  'Patching': '#30D158',
  'Pothole': '#FF453A',
  'Weathering / Raveling': '#BF5AF2',
  'Lane / Shoulder Drop-off': '#FF375F',
  'Marking / Manhole': '#64D2FF',
  crack: '#007AFF',
  pothole: '#FF453A',
  patch: '#30D158',
  manhole: '#64D2FF',
  unknown: '#8E8E93',
};

const LABEL_EMOJI = {
  'Longitudinal / Transverse Crack': '━',
  'Longitudinal Crack': '━',
  'Transverse Crack': '┃',
  'Alligator Crack': '⚡',
  'Block Crack': '▦',
  'Patching': '🩹',
  'Pothole': '🕳️',
  'Weathering / Raveling': '〰️',
  'Lane / Shoulder Drop-off': '⚠️',
  'Marking / Manhole': '⭕',
  crack: '⚡',
  pothole: '🕳️',
  patch: '🩹',
  manhole: '⭕',
  unknown: '⚠️',
};

const GPU_BACKENDS = ['webgpu', 'webgl'];

function drawDetections(ctx, detections, canvasW, canvasH) {
  detections.forEach(({ displayLabel, className, confidence, bbox }) => {
    if (!bbox) return;
    let x, y, bw, bh;
    if (bbox.normalized) {
      x = bbox.normalized.x * canvasW;
      y = bbox.normalized.y * canvasH;
      bw = bbox.normalized.w * canvasW;
      bh = bbox.normalized.h * canvasH;
    } else {
      const { cx, cy, w, h } = bbox;
      x = ((cx - w / 2) / 640) * canvasW;
      y = ((cy - h / 2) / 640) * canvasH;
      bw = (w / 640) * canvasW;
      bh = (h / 640) * canvasH;
    }
    const labelKey = displayLabel || className;
    const color = LABEL_COLORS[labelKey] || LABEL_COLORS[className] || '#007AFF';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x, y, bw, bh);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.14;
    ctx.fillRect(x, y, bw, bh);
    ctx.globalAlpha = 1;
    const label = `${labelKey} ${Math.round(confidence * 100)}%`;
    ctx.font = 'bold 11px Inter, system-ui, sans-serif';
    const textW = ctx.measureText(label).width;
    const labelH = 18;
    const labelY = y > labelH + 4 ? y - labelH - 2 : y + bh + 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x - 1, labelY, textW + 10, labelH, 4);
    ctx.fill();
    ctx.fillStyle = 'white';
    ctx.fillText(label, x + 4, labelY + labelH - 4);
  });
}

export default function VideoAnalysis({ model, onClose }) {
  const [phase, setPhase] = useState('ready');
  const [summary, setSummary] = useState(null);
  const [fps, setFps] = useState(0);
  const [latencyMs, setLatencyMs] = useState(0);
  const [backendInfo, setBackendInfo] = useState('');
  const [gpuServerInfo, setGpuServerInfo] = useState(null);
  const [currentPci, setCurrentPci] = useState(100);
  const videoRef = useRef(null);
  const displayCanvasRef = useRef(null);
  const overlayRef = useRef(null);
  const stoppedRef = useRef(false);
  const countsByTypeRef = useRef({});
  const drawFrameIdRef = useRef(null);
  const fpsCounterRef = useRef({ frames: 0, lastTime: 0 });

  useEffect(() => {
    let active = true;
    checkGpuServerHealth().then(status => {
      if (!active) return;
      if (status.online) {
        setGpuServerInfo(status);
        setBackendInfo(`CUDA · ${status.device_name || 'NVIDIA GPU'} · YOLO11-L`);
      } else {
        const b = tf.getBackend();
        const isGpu = GPU_BACKENDS.includes(b);
        setBackendInfo(isGpu ? `WebGPU/WebGL · ${b}` : `CPU · ${b}`);
      }
    });
    return () => { active = false; };
  }, []);

  const cleanup = useCallback(() => {
    stoppedRef.current = true;
    if (drawFrameIdRef.current) {
      cancelAnimationFrame(drawFrameIdRef.current);
    }
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const handleVideoEnded = useCallback(() => {
    setPhase('done');
    stoppedRef.current = true;
    const counts = countsByTypeRef.current;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    let deduct = 0;
    Object.entries(counts).forEach(([type, count]) => {
      if (type.includes('Pothole') || type.includes('Alligator')) deduct += count * 6;
      else if (type.includes('Crack')) deduct += count * 3;
      else deduct += count * 2;
    });
    const finalPci = Math.max(10, Math.min(100, 100 - deduct));
    const pciRating = finalPci >= 85 ? 'Good' : finalPci >= 70 ? 'Satisfactory' : finalPci >= 55 ? 'Fair' : finalPci >= 40 ? 'Poor' : 'Serious';
    setSummary({
      countsByType: counts,
      total,
      duration: Math.round(videoRef.current?.duration || 0),
      pci: finalPci,
      pciRating,
      hardware: gpuServerInfo?.device_name || 'Browser Inference Engine'
    });
  }, [gpuServerInfo]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.addEventListener('ended', handleVideoEnded);
      return () => video.removeEventListener('ended', handleVideoEnded);
    }
  }, [handleVideoEnded]);

  const startProcessing = () => {
    const isGpuServerReady = gpuServerInfo && gpuServerInfo.online;
    if (!isGpuServerReady && !model) return;
    if (!videoRef.current) return;
    setPhase('processing');
    setSummary(null);
    countsByTypeRef.current = {};
    stoppedRef.current = false;
    setCurrentPci(100);
    fpsCounterRef.current = { frames: 0, lastTime: performance.now() };
    videoRef.current.currentTime = 0;
    videoRef.current.play().catch(console.error);
    const drawLoop = () => {
      if (stoppedRef.current) return;
      if (videoRef.current && displayCanvasRef.current && overlayRef.current) {
        const vw = videoRef.current.videoWidth || 640;
        const vh = videoRef.current.videoHeight || 360;
        if (displayCanvasRef.current.width !== vw || displayCanvasRef.current.height !== vh) {
          displayCanvasRef.current.width = vw;
          displayCanvasRef.current.height = vh;
          overlayRef.current.width = vw;
          overlayRef.current.height = vh;
        }
        const ctx = displayCanvasRef.current.getContext('2d');
        ctx.drawImage(videoRef.current, 0, 0, vw, vh);
      }
      drawFrameIdRef.current = requestAnimationFrame(drawLoop);
    };
    let inferRunning = false;
    const inferenceLoop = async () => {
      if (stoppedRef.current || videoRef.current.paused || videoRef.current.ended) return;
      if (inferRunning) return;
      inferRunning = true;
      try {
        let detections = [];
        if (gpuServerInfo && gpuServerInfo.online) {
          const t0 = performance.now();
          const res = await predictFrameGpu(videoRef.current, 0.15);
          const dt = performance.now() - t0;
          setLatencyMs(Math.round(res?.inference_ms || dt));
          if (res?.detections) {
            detections = res.detections;
            if (res.estimated_pci !== undefined) setCurrentPci(res.estimated_pci);
          }
        } else if (model) {
          const t0 = performance.now();
          const predictions = runInference(model, videoRef.current);
          detections = await parseYoloOutputAll(predictions, 0.08);
          if (Array.isArray(predictions)) predictions.forEach(t => t.dispose());
          else predictions.dispose();
          setLatencyMs(Math.round(performance.now() - t0));
        }
        if (overlayRef.current) {
          const octx = overlayRef.current.getContext('2d');
          octx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
          drawDetections(octx, detections, overlayRef.current.width, overlayRef.current.height);
        }
        detections.forEach(d => {
          const key = d.displayLabel || d.className;
          countsByTypeRef.current[key] = (countsByTypeRef.current[key] || 0) + 1;
        });
        fpsCounterRef.current.frames++;
        const now = performance.now();
        const elapsed = now - fpsCounterRef.current.lastTime;
        if (elapsed >= 1000) {
          setFps(Math.round((fpsCounterRef.current.frames / elapsed) * 1000));
          fpsCounterRef.current = { frames: 0, lastTime: now };
        }
        inferRunning = false;
        if (!stoppedRef.current && !videoRef.current.paused && !videoRef.current.ended) {
          setTimeout(inferenceLoop, (gpuServerInfo?.online || GPU_BACKENDS.includes(tf.getBackend())) ? 0 : 80);
        }
      } catch (e) {
        console.error('Frame inference error:', e);
        inferRunning = false;
      }
    };
    drawFrameIdRef.current = requestAnimationFrame(drawLoop);
    inferenceLoop();
  };

  const stopProcessing = () => {
    stoppedRef.current = true;
    if (videoRef.current) videoRef.current.pause();
    handleVideoEnded();
  };

  const reset = () => {
    cleanup();
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
    if (overlayRef.current) {
      const octx = overlayRef.current.getContext('2d');
      octx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
    }
    setPhase('ready');
    setSummary(null);
    setFps(0);
    setLatencyMs(0);
    setCurrentPci(100);
    countsByTypeRef.current = {};
  };

  const isModelReady = Boolean(gpuServerInfo?.online || model);

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 'calc(var(--bottom-bar-height) + var(--safe-bottom, 0px))', background: '#0a0a0c', zIndex: 3000, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'calc(env(safe-area-inset-top, 0px) + 16px) 20px 12px', background: 'rgba(18,18,22,0.95)', borderBottom: '0.5px solid rgba(84,84,88,0.3)', backdropFilter: 'blur(20px)' }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#fff', fontFamily: 'Inter, sans-serif', letterSpacing: '-0.3px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>StreetIQ Vision AI · ASTM D6433</span>
          </div>
          <div style={{ fontSize: 12, color: 'rgba(235,235,245,0.6)', fontFamily: 'Inter, sans-serif', marginTop: 3, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>Smart Road PCI · YOLO11-Large</span>
            {backendInfo && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: gpuServerInfo?.online ? 'rgba(48,209,88,0.18)' : 'rgba(10,132,255,0.18)', border: `0.5px solid ${gpuServerInfo?.online ? 'rgba(48,209,88,0.4)' : 'rgba(10,132,255,0.4)'}`, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, color: gpuServerInfo?.online ? '#30D158' : '#0A84FF' }}>
                {gpuServerInfo?.online ? <Zap size={10} /> : <Cpu size={10} />}
                {backendInfo}
              </span>
            )}
          </div>
        </div>
        <button onClick={onClose || reset} style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '50%', width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'background 0.2s' }}>
          <X size={16} color="rgba(235,235,245,0.85)" />
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: 16, gap: 14 }}>
        {phase === 'ready' && (
          <div style={{ background: 'linear-gradient(180deg, rgba(10,132,255,0.1) 0%, rgba(10,132,255,0.03) 100%)', border: '1px solid rgba(10,132,255,0.25)', padding: '16px 20px', borderRadius: 14, display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(10,132,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Gauge size={22} color="#0A84FF" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#fff', fontFamily: 'Inter, sans-serif' }}>Automated Pavement Condition Index (PCI) Analysis</h3>
              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'rgba(235,235,245,0.7)', fontFamily: 'Inter, sans-serif', lineHeight: 1.5 }}>
                Running the ASTM D6433-trained YOLO11-Large model powered by hardware acceleration. Detects longitudinal cracks, alligator cracking, potholes, patches, and distresses in real-time.
              </p>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: window.innerWidth < 768 ? 'column' : 'row', gap: 12, width: '100%', flex: 1 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#121216', borderRadius: 14, overflow: 'hidden', border: '0.5px solid rgba(84,84,88,0.3)' }}>
            <div style={{ padding: '9px 14px', background: 'rgba(22,22,26,0.95)', fontSize: 11, fontWeight: 700, color: 'rgba(235,235,245,0.7)', fontFamily: 'Inter, sans-serif', textTransform: 'uppercase', letterSpacing: 0.6, borderBottom: '0.5px solid rgba(84,84,88,0.3)' }}>
              Raw Dashcam Footage
            </div>
            <div style={{ position: 'relative', flex: 1, minHeight: 220 }}>
              <video
                ref={videoRef}
                src="/demo-video.mp4"
                playsInline
                muted
                crossOrigin="anonymous"
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'contain' }}
              />
            </div>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#121216', borderRadius: 14, overflow: 'hidden', border: '0.5px solid rgba(84,84,88,0.3)' }}>
            <div style={{ padding: '9px 14px', background: 'rgba(22,22,26,0.95)', fontSize: 11, fontWeight: 700, color: '#0A84FF', fontFamily: 'Inter, sans-serif', textTransform: 'uppercase', letterSpacing: 0.6, borderBottom: '0.5px solid rgba(84,84,88,0.3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>YOLO11 Detection Stream</span>
              {phase === 'processing' && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#30D158', fontSize: 11 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#30D158', animation: 'pulse 1.5s infinite' }} />
                    Live Scanning
                  </span>
                  <span style={{ color: '#FF9F0A', fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fps} FPS</span>
                  {latencyMs > 0 && (
                    <span style={{ color: 'rgba(235,235,245,0.5)', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>{latencyMs}ms</span>
                  )}
                  <span style={{ background: currentPci >= 70 ? 'rgba(48,209,88,0.2)' : 'rgba(255,159,10,0.2)', color: currentPci >= 70 ? '#30D158' : '#FF9F0A', padding: '2px 6px', borderRadius: 4, fontSize: 11, fontWeight: 700 }}>
                    PCI: {currentPci}
                  </span>
                </span>
              )}
            </div>
            <div style={{ position: 'relative', flex: 1, minHeight: 220, background: '#000' }}>
              {(phase === 'ready' || phase === 'done') && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', zIndex: 10 }}>
                  <div style={{ textAlign: 'center' }}>
                    <Film size={34} color="rgba(235,235,245,0.4)" />
                    <div style={{ fontSize: 13, color: 'rgba(235,235,245,0.6)', fontFamily: 'Inter, sans-serif', marginTop: 8 }}>
                      {phase === 'done' ? 'Analysis finished · review report below' : 'Ready to start inspection scan'}
                    </div>
                  </div>
                </div>
              )}
              <canvas ref={displayCanvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
              <canvas ref={overlayRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>
          </div>
        </div>
        {phase === 'done' && summary && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
            <div style={{ background: 'rgba(24,24,28,0.95)', borderRadius: 14, padding: 18, border: '0.5px solid rgba(84,84,88,0.3)', display: 'grid', gridTemplateColumns: window.innerWidth < 640 ? '1fr' : '180px 1fr', gap: 18, alignItems: 'center' }}>
              <div style={{ textAlign: 'center', padding: '12px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '0.5px solid rgba(84,84,88,0.2)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'rgba(235,235,245,0.5)', fontFamily: 'Inter, sans-serif', letterSpacing: 0.5 }}>ASTM D6433 PCI</div>
                <div style={{ fontSize: 38, fontWeight: 800, color: summary.pci >= 70 ? '#30D158' : summary.pci >= 55 ? '#FF9F0A' : '#FF453A', fontFamily: 'Inter, sans-serif', margin: '4px 0', letterSpacing: '-1px' }}>
                  {summary.pci}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: summary.pci >= 70 ? '#30D158' : summary.pci >= 55 ? '#FF9F0A' : '#FF453A', fontFamily: 'Inter, sans-serif' }}>
                  {summary.pciRating}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(235,235,245,0.6)', fontFamily: 'Inter, sans-serif', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                  Survey Summary · {summary.total} Distress Detections · {summary.duration}s Analyzed
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: window.innerWidth < 640 ? '1fr' : 'repeat(2, 1fr)', gap: 8 }}>
                  {Object.entries(summary.countsByType).map(([type, count]) => (
                    <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.02)', padding: '6px 10px', borderRadius: 8, border: '0.5px solid rgba(84,84,88,0.15)' }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, background: LABEL_COLORS[type] || '#007AFF', flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 13, color: '#fff', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {LABEL_EMOJI[type] || '•'} {type}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: LABEL_COLORS[type] || '#007AFF', fontFamily: 'Inter, sans-serif' }}>{count}</span>
                    </div>
                  ))}
                  {summary.total === 0 && (
                    <div style={{ fontSize: 13, color: 'rgba(235,235,245,0.5)', fontFamily: 'Inter, sans-serif' }}>No defects detected</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <div style={{ flexShrink: 0, padding: '12px 18px', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)', background: 'rgba(18,18,22,0.95)', borderTop: '0.5px solid rgba(84,84,88,0.3)', display: 'flex', gap: 10, zIndex: 1 }}>
        {(phase === 'ready' || phase === 'done') && (
          <button
            onClick={startProcessing}
            disabled={!isModelReady}
            style={{ flex: 1, padding: '14px 0', borderRadius: 12, border: 'none', background: isModelReady ? '#0A84FF' : 'rgba(84,84,88,0.3)', color: 'white', fontSize: 15, fontWeight: 600, fontFamily: 'Inter, sans-serif', cursor: isModelReady ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'all 0.2s', boxShadow: isModelReady ? '0 4px 14px rgba(10,132,255,0.35)' : 'none' }}
          >
            <Play size={16} fill="white" strokeWidth={0} />
            {isModelReady ? (phase === 'done' ? 'Replay Analysis' : 'Start Full GPU Analysis') : 'Initializing AI Weights…'}
          </button>
        )}
        {phase === 'processing' && (
          <button
            onClick={stopProcessing}
            style={{ flex: 1, padding: '14px 0', borderRadius: 12, border: 'none', background: '#FF453A', color: 'white', fontSize: 15, fontWeight: 600, fontFamily: 'Inter, sans-serif', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: '0 4px 14px rgba(255,69,58,0.35)' }}
          >
            <Square size={14} fill="white" strokeWidth={0} /> Stop Scan
          </button>
        )}
      </div>
    </div>
  );
}
