import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Upload, Play, Square, X, ChevronRight, Film } from 'lucide-react';
import * as tf from '@tensorflow/tfjs';
import { parseYoloOutputAll } from '../utils/tfjsParser';

const MAX_FILE_MB = 50;
const PROCESS_FPS = 5;
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
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.strokeRect(x, y, bw, bh);
    ctx.shadowBlur = 0;

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

export default function VideoAnalysis({ model }) {
  const [phase, setPhase] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [blobUrl, setBlobUrl] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const rafRef = useRef(null);
  const fileRef = useRef(null);
  const detectionLogRef = useRef([]);

  const cleanup = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (blobUrl) { URL.revokeObjectURL(blobUrl); }
    detectionLogRef.current = [];
  }, [blobUrl]);

  useEffect(() => () => cleanup(), [cleanup]);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('video/')) { setError('Please select a video file.'); return; }
    if (file.size > MAX_FILE_MB * 1024 * 1024) { setError(`File must be under ${MAX_FILE_MB} MB.`); return; }
    cleanup();
    setError(null);
    setSummary(null);
    setProgress(0);
    detectionLogRef.current = [];
    const url = URL.createObjectURL(file);
    setBlobUrl(url);
    fileRef.current = file;
    setPhase('ready');
    if (videoRef.current) {
      videoRef.current.src = url;
      videoRef.current.load();
    }
  };

  const startProcessing = async () => {
    if (!model || !videoRef.current) return;
    setPhase('processing');
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;

    let duration = video.duration;
    if (!duration || isNaN(duration) || duration === Infinity) {
      duration = 30;
    }

    const seekTo = (time) => new Promise(res => {
      if (Math.abs(video.currentTime - time) < 0.05) return res();
      let isDone = false;
      const done = () => {
        if (isDone) return;
        isDone = true;
        video.onseeked = null;
        res();
      };
      video.onseeked = done;
      video.currentTime = time;
      setTimeout(done, 300);
    });

    const interval = 1 / PROCESS_FPS;
    let currentTime = 0;
    const countsByType = {};

    const processNextFrame = async () => {
      const reachedEndByClamp = currentTime > 0.5 && Math.abs(video.currentTime - currentTime) > 0.5;
      
      if (currentTime > duration || video.ended || reachedEndByClamp) {
        setPhase('done');
        const total = Object.values(countsByType).reduce((a, b) => a + b, 0);
        setSummary({ countsByType, total, duration: Math.round(video.currentTime || duration) });
        return;
      }

      await seekTo(currentTime);
      setProgress(Math.min(100, Math.round((currentTime / duration) * 100)));

      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 360;
      overlay.width = canvas.width;
      overlay.height = canvas.height;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      tf.engine().startScope();
      try {
        const tensor = tf.browser.fromPixels(canvas)
          .resizeBilinear([640, 640]).expandDims(0).toFloat();
        
        // DEBUG: Let's see if the tensor is empty
        const tMin = tensor.min().dataSync()[0];
        const tMax = tensor.max().dataSync()[0];
        console.log(`[TENSOR DEBUG] min=${tMin} max=${tMax}`);
        const predictions = model.execute(tensor);
        const detections = await parseYoloOutputAll(predictions, 0.20);

        const octx = overlay.getContext('2d');
        octx.clearRect(0, 0, overlay.width, overlay.height);
        octx.drawImage(video, 0, 0, overlay.width, overlay.height);
        drawDetections(octx, detections, overlay.width, overlay.height);

        detections.forEach(d => {
          countsByType[d.className] = (countsByType[d.className] || 0) + 1;
          detectionLogRef.current.push({ time: currentTime, type: d.className, confidence: d.confidence });
        });
      } catch (e) {
        console.error('Frame inference error:', e);
      } finally {
        tf.engine().endScope();
      }

      currentTime += interval;
      rafRef.current = requestAnimationFrame(processNextFrame);
    };

    processNextFrame();
  };

  const reset = () => {
    cleanup();
    setBlobUrl(null);
    setPhase('idle');
    setProgress(0);
    setSummary(null);
    setError(null);
    detectionLogRef.current = [];
    if (fileRef.current) fileRef.current = null;
    if (videoRef.current) { videoRef.current.src = ''; videoRef.current.load(); }
  };

  const hazardEmoji = { crack: '⚡', pothole: '🕳️', waterlogging: '💧', debris: '🪨', unknown: '⚠️' };
  const BUTTON_BAR_H = 70;

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 'calc(var(--bottom-bar-height) + var(--safe-bottom, 0px))', background: '#000', zIndex: 3000, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'calc(env(safe-area-inset-top, 0px) + 16px) 20px 12px', background: 'rgba(18,18,18,0.95)', borderBottom: '0.5px solid rgba(84,84,88,0.4)' }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#fff', fontFamily: 'Inter, sans-serif' }}>Analyse Your Road</div>
          <div style={{ fontSize: 12, color: 'rgba(235,235,245,0.45)', fontFamily: 'Inter, sans-serif', marginTop: 2 }}>
            Processed locally · Never stored on our servers
          </div>
        </div>
        <button onClick={reset} style={{ background: 'rgba(84,84,88,0.35)', border: 'none', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <X size={16} color="rgba(235,235,245,0.8)" />
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: phase === 'idle' ? 'center' : 'flex-start', padding: 16, gap: 12 }}>
        {phase === 'idle' && (
          <label style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, width: '100%' }}>
            <input type="file" accept="video/*" onChange={handleFile} style={{ display: 'none' }} />
            <div style={{ width: 80, height: 80, borderRadius: 20, background: 'rgba(10,132,255,0.12)', border: '1.5px dashed rgba(10,132,255,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Film size={36} color="#0A84FF" />
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 17, fontWeight: 600, color: '#fff', fontFamily: 'Inter, sans-serif' }}>Upload Dashcam Footage</div>
              <div style={{ fontSize: 13, color: 'rgba(235,235,245,0.45)', fontFamily: 'Inter, sans-serif', marginTop: 6, lineHeight: 1.5 }}>
                MP4, MOV, AVI · Max {MAX_FILE_MB} MB<br />
                Our AI identifies road hazards and marks them with colour-coded boxes
              </div>
            </div>
            <div style={{ background: '#0A84FF', borderRadius: 14, padding: '13px 28px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Upload size={16} color="white" />
              <span style={{ color: 'white', fontSize: 15, fontWeight: 600, fontFamily: 'Inter, sans-serif' }}>Choose Video</span>
            </div>
            {error && <div style={{ color: '#FF453A', fontSize: 13, fontFamily: 'Inter, sans-serif', textAlign: 'center' }}>{error}</div>}
          </label>
        )}
        {(phase === 'ready' || phase === 'processing' || phase === 'done') && (
          <>
            <div style={{ width: '100%', borderRadius: 12, overflow: 'hidden', position: 'relative', background: '#111', aspectRatio: '16/9', maxHeight: `calc(100vh - ${BUTTON_BAR_H + 130}px)` }}>
              <video ref={videoRef} src={blobUrl} style={{ opacity: 0.01, position: 'absolute', width: 10, height: 10, pointerEvents: 'none' }} playsInline muted crossOrigin="anonymous" />
              <canvas ref={canvasRef} style={{ opacity: 0.01, position: 'absolute', width: 10, height: 10, pointerEvents: 'none' }} />
              <canvas ref={overlayRef} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#000' }} />
              {phase === 'ready' && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}>
                  <div style={{ textAlign: 'center' }}>
                    <Film size={36} color="rgba(235,235,245,0.4)" />
                    <div style={{ fontSize: 13, color: 'rgba(235,235,245,0.5)', fontFamily: 'Inter, sans-serif', marginTop: 8 }}>Video loaded · Ready to analyse</div>
                  </div>
                </div>
              )}
            </div>
            {phase === 'processing' && (
              <div style={{ width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: 'rgba(235,235,245,0.7)', fontFamily: 'Inter, sans-serif' }}>Analysing frames…</span>
                  <span style={{ fontSize: 13, color: '#0A84FF', fontFamily: 'Inter, sans-serif', fontWeight: 600 }}>{progress}%</span>
                </div>
                <div style={{ height: 4, background: 'rgba(84,84,88,0.4)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${progress}%`, background: '#0A84FF', borderRadius: 2, transition: 'width 0.3s ease' }} />
                </div>
                <div style={{ fontSize: 11, color: 'rgba(235,235,245,0.35)', fontFamily: 'Inter, sans-serif', marginTop: 6, textAlign: 'center' }}>
                  Running at {PROCESS_FPS} fps · On-device AI · No data leaves your device
                </div>
              </div>
            )}
            {phase === 'done' && summary && (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ background: 'rgba(28,28,30,0.9)', borderRadius: 14, padding: 16, border: '0.5px solid rgba(84,84,88,0.4)' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(235,235,245,0.5)', fontFamily: 'Inter, sans-serif', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Analysis Complete · {summary.total} hazard frames detected
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {Object.entries(summary.countsByType).map(([type, count]) => (
                      <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 2, background: LABEL_COLORS[type] || '#007AFF', flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: 14, color: '#fff', fontFamily: 'Inter, sans-serif' }}>{hazardEmoji[type]} {type}</span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: LABEL_COLORS[type] || '#007AFF', fontFamily: 'Inter, sans-serif' }}>{count} frames</span>
                      </div>
                    ))}
                    {summary.total === 0 && (
                      <div style={{ fontSize: 14, color: 'rgba(235,235,245,0.5)', fontFamily: 'Inter, sans-serif', textAlign: 'center' }}>No hazards detected in this footage</div>
                    )}
                  </div>
                </div>
                <div style={{ background: 'rgba(48,209,88,0.08)', borderRadius: 10, padding: '10px 14px', border: '0.5px solid rgba(48,209,88,0.2)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>🔒</span>
                  <span style={{ fontSize: 12, color: 'rgba(48,209,88,0.9)', fontFamily: 'Inter, sans-serif', lineHeight: 1.5 }}>
                    Your video was processed entirely on this device. Nothing was uploaded to our servers. Closing this screen permanently removes the video from memory.
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {(phase === 'ready' || phase === 'processing' || phase === 'done') && (
        <div style={{ flexShrink: 0, padding: '12px 16px', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)', background: 'rgba(18,18,18,0.95)', borderTop: '0.5px solid rgba(84,84,88,0.4)', display: 'flex', gap: 10, zIndex: 1 }}>
          {phase === 'ready' && (
            <button
              onClick={startProcessing}
              disabled={!model}
              style={{ flex: 1, padding: '13px 0', borderRadius: 12, border: 'none', background: model ? '#0A84FF' : 'rgba(84,84,88,0.4)', color: 'white', fontSize: 15, fontWeight: 600, fontFamily: 'Inter, sans-serif', cursor: model ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              <Play size={16} fill="white" strokeWidth={0} />
              {model ? 'Start Analysis' : 'Loading AI model…'}
            </button>
          )}
          {phase === 'processing' && (
            <button
              onClick={() => { cancelAnimationFrame(rafRef.current); setPhase('done'); setSummary({ countsByType: {}, total: detectionLogRef.current.length, duration: 0 }); }}
              style={{ flex: 1, padding: '13px 0', borderRadius: 12, border: 'none', background: '#FF453A', color: 'white', fontSize: 15, fontWeight: 600, fontFamily: 'Inter, sans-serif', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              <Square size={14} fill="white" strokeWidth={0} /> Stop
            </button>
          )}
          <button
            onClick={reset}
            style={{ flex: phase === 'processing' ? 0.5 : 1, padding: '13px 0', borderRadius: 12, border: '0.5px solid rgba(84,84,88,0.5)', background: 'transparent', color: 'rgba(235,235,245,0.7)', fontSize: 15, fontFamily: 'Inter, sans-serif', cursor: 'pointer' }}
          >
            {phase === 'done' ? 'Analyse Another' : 'Change Video'}
          </button>
        </div>
      )}
    </div>
  );
}
