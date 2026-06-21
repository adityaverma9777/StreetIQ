import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Play, Square, X, Film, Activity } from 'lucide-react';
import * as tf from '@tensorflow/tfjs';
import { parseYoloOutputAll } from '../utils/tfjsParser';

const LABEL_COLORS = {
  crack: '#007AFF',
  pothole: '#FF453A',
  waterlogging: '#30D158',
  debris: '#FF9F0A',
  unknown: '#007AFF',
};

function drawDetections(ctx, detections, canvasW, canvasH) {
  detections.forEach(({ className, confidence, bbox }) => {
    if (!bbox) return;
    const { cx, cy, w, h } = bbox;
    const x = ((cx - w / 2) / 640) * canvasW;
    const y = ((cy - h / 2) / 640) * canvasH;
    const bw = (w / 640) * canvasW;
    const bh = (h / 640) * canvasH;
    const color = LABEL_COLORS[className] || '#007AFF';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x, y, bw, bh);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.12;
    ctx.fillRect(x, y, bw, bh);
    ctx.globalAlpha = 1;
    const label = `${className} ${Math.round(confidence * 100)}%`;
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
  
  const videoRef = useRef(null);
  const displayCanvasRef = useRef(null);
  const overlayRef = useRef(null);
  
  const stoppedRef = useRef(false);
  const countsByTypeRef = useRef({});
  const drawFrameIdRef = useRef(null);

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
    setSummary({ 
      countsByType: counts, 
      total, 
      duration: Math.round(videoRef.current?.duration || 0) 
    });
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.addEventListener('ended', handleVideoEnded);
      return () => video.removeEventListener('ended', handleVideoEnded);
    }
  }, [handleVideoEnded]);

  const startProcessing = () => {
    if (!model || !videoRef.current) return;
    setPhase('processing');
    setSummary(null);
    countsByTypeRef.current = {};
    stoppedRef.current = false;
    
    videoRef.current.currentTime = 0;
    videoRef.current.play().catch(console.error);

    // Render loop for syncing video to canvas
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

    // Inference loop
    const inferenceLoop = async () => {
      if (stoppedRef.current || videoRef.current.paused || videoRef.current.ended) {
        return;
      }
      try {
        const predictions = tf.tidy(() => {
          return model.execute(
            tf.browser.fromPixels(videoRef.current)
              .resizeBilinear([640, 640])
              .expandDims(0)
              .toFloat()
          );
        });
        const detections = await parseYoloOutputAll(predictions, 0.20);
        if (Array.isArray(predictions)) predictions.forEach(t => t.dispose());
        else predictions.dispose();

        if (overlayRef.current) {
          const octx = overlayRef.current.getContext('2d');
          octx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
          drawDetections(octx, detections, overlayRef.current.width, overlayRef.current.height);
        }

        detections.forEach(d => {
          countsByTypeRef.current[d.className] = (countsByTypeRef.current[d.className] || 0) + 1;
        });
      } catch (e) {
        console.error('Frame inference error:', e);
      }
      
      if (!stoppedRef.current && !videoRef.current.paused && !videoRef.current.ended) {
        requestAnimationFrame(inferenceLoop);
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
    countsByTypeRef.current = {};
  };

  const hazardEmoji = { crack: '⚡', pothole: '🕳️', waterlogging: '💧', debris: '🪨', unknown: '⚠️' };
  const BUTTON_BAR_H = 70;

  // Render the onClose differently: we can pass an onClose prop from App.jsx so we don't have to redefine reset
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 'calc(var(--bottom-bar-height) + var(--safe-bottom, 0px))', background: '#000', zIndex: 3000, display: 'flex', flexDirection: 'column' }}>
      
      {/* Header */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'calc(env(safe-area-inset-top, 0px) + 16px) 20px 12px', background: 'rgba(18,18,18,0.95)', borderBottom: '0.5px solid rgba(84,84,88,0.4)' }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#fff', fontFamily: 'Inter, sans-serif' }}>How We Work</div>
          <div style={{ fontSize: 12, color: 'rgba(235,235,245,0.45)', fontFamily: 'Inter, sans-serif', marginTop: 2 }}>
            Interactive AI Demo · Processed locally
          </div>
        </div>
        <button onClick={onClose || reset} style={{ background: 'rgba(84,84,88,0.35)', border: 'none', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <X size={16} color="rgba(235,235,245,0.8)" />
        </button>
      </div>

      {/* Main Content Area */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: 16, gap: 16 }}>
        
        {/* Intro text when ready */}
        {phase === 'ready' && (
          <div style={{ textAlign: 'center', background: 'rgba(10,132,255,0.08)', border: '1px solid rgba(10,132,255,0.2)', padding: '16px', borderRadius: 12 }}>
            <Activity size={32} color="#0A84FF" style={{ margin: '0 auto 8px' }} />
            <h3 style={{ margin: 0, fontSize: 16, color: 'white', fontFamily: 'Inter, sans-serif' }}>Real-time Detection Demo</h3>
            <p style={{ margin: '8px 0 0', fontSize: 13, color: 'rgba(235,235,245,0.7)', fontFamily: 'Inter, sans-serif', lineHeight: 1.5 }}>
              We've pre-loaded a sample dashcam video. Click "Start Analysis" to see how our on-device AI scans for hazards in real-time, side-by-side with the raw footage.
            </p>
          </div>
        )}

        {/* Split Screen Container */}
        <div style={{ 
          display: 'flex', 
          flexDirection: window.innerWidth < 768 ? 'column' : 'row', 
          gap: 12, 
          width: '100%',
          flex: 1
        }}>
          
          {/* Left: Raw Video */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#111', borderRadius: 12, overflow: 'hidden', border: '0.5px solid rgba(84,84,88,0.4)' }}>
            <div style={{ padding: '8px 12px', background: 'rgba(28,28,30,0.9)', fontSize: 12, fontWeight: 600, color: 'rgba(235,235,245,0.8)', fontFamily: 'Inter, sans-serif', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '0.5px solid rgba(84,84,88,0.4)' }}>
              Raw Footage
            </div>
            <div style={{ position: 'relative', flex: 1, minHeight: 200 }}>
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

          {/* Right: AI Analysis Overlay */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#111', borderRadius: 12, overflow: 'hidden', border: '0.5px solid rgba(84,84,88,0.4)' }}>
            <div style={{ padding: '8px 12px', background: 'rgba(28,28,30,0.9)', fontSize: 12, fontWeight: 600, color: '#0A84FF', fontFamily: 'Inter, sans-serif', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '0.5px solid rgba(84,84,88,0.4)', display: 'flex', justifyContent: 'space-between' }}>
              <span>AI Analysis</span>
              {phase === 'processing' && <span style={{ color: '#30D158' }}>Scanning...</span>}
            </div>
            <div style={{ position: 'relative', flex: 1, minHeight: 200, background: '#000' }}>
              {/* Fallback placeholder when not playing */}
              {(phase === 'ready' || phase === 'done') && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', zIndex: 10 }}>
                  <div style={{ textAlign: 'center' }}>
                    <Film size={32} color="rgba(235,235,245,0.4)" />
                    <div style={{ fontSize: 13, color: 'rgba(235,235,245,0.5)', fontFamily: 'Inter, sans-serif', marginTop: 8 }}>
                      {phase === 'done' ? 'Analysis finished' : 'Ready to analyse'}
                    </div>
                  </div>
                </div>
              )}
              {/* Sync Canvas */}
              <canvas ref={displayCanvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
              {/* Bounding Box Overlay Canvas */}
              <canvas ref={overlayRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>
          </div>

        </div>

        {/* Summary Screen */}
        {phase === 'done' && summary && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
            <div style={{ background: 'rgba(28,28,30,0.9)', borderRadius: 14, padding: 16, border: '0.5px solid rgba(84,84,88,0.4)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(235,235,245,0.5)', fontFamily: 'Inter, sans-serif', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Analysis Complete · {summary.total} hazard detections
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Object.entries(summary.countsByType).map(([type, count]) => (
                  <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: LABEL_COLORS[type] || '#007AFF', flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 14, color: '#fff', fontFamily: 'Inter, sans-serif' }}>{hazardEmoji[type]} {type}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: LABEL_COLORS[type] || '#007AFF', fontFamily: 'Inter, sans-serif' }}>{count} items</span>
                  </div>
                ))}
                {summary.total === 0 && (
                  <div style={{ fontSize: 14, color: 'rgba(235,235,245,0.5)', fontFamily: 'Inter, sans-serif', textAlign: 'center' }}>No hazards detected in this footage</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer Controls */}
      <div style={{ flexShrink: 0, padding: '12px 16px', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)', background: 'rgba(18,18,18,0.95)', borderTop: '0.5px solid rgba(84,84,88,0.4)', display: 'flex', gap: 10, zIndex: 1 }}>
        {(phase === 'ready' || phase === 'done') && (
          <button
            onClick={startProcessing}
            disabled={!model}
            style={{ flex: 1, padding: '13px 0', borderRadius: 12, border: 'none', background: model ? '#0A84FF' : 'rgba(84,84,88,0.4)', color: 'white', fontSize: 15, fontWeight: 600, fontFamily: 'Inter, sans-serif', cursor: model ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            <Play size={16} fill="white" strokeWidth={0} />
            {model ? (phase === 'done' ? 'Replay Analysis' : 'Start Analysis') : 'Loading AI model…'}
          </button>
        )}
        {phase === 'processing' && (
          <button
            onClick={stopProcessing}
            style={{ flex: 1, padding: '13px 0', borderRadius: 12, border: 'none', background: '#FF453A', color: 'white', fontSize: 15, fontWeight: 600, fontFamily: 'Inter, sans-serif', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            <Square size={14} fill="white" strokeWidth={0} /> Stop
          </button>
        )}
      </div>
    </div>
  );
}
