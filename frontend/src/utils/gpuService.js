const DEFAULT_URL = import.meta.env.VITE_GPU_SERVER_URL || 'http://127.0.0.1:8000';

let cachedHealth = null;
let lastCheckTime = 0;

export async function checkGpuServerHealth(force = false) {
  const now = Date.now();
  if (!force && cachedHealth && now - lastCheckTime < 10000) {
    return cachedHealth;
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${DEFAULT_URL}/health`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error('Bad response');
    const data = await res.json();
    cachedHealth = { online: true, ...data };
    lastCheckTime = now;
    return cachedHealth;
  } catch (err) {
    cachedHealth = { online: false, error: err.message };
    lastCheckTime = now;
    return cachedHealth;
  }
}

const offscreenCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;

export async function predictFrameGpu(videoOrCanvas, conf = 0.15) {
  if (!offscreenCanvas) return null;
  const vw = videoOrCanvas.videoWidth || videoOrCanvas.width || 640;
  const vh = videoOrCanvas.videoHeight || videoOrCanvas.height || 360;
  offscreenCanvas.width = vw;
  offscreenCanvas.height = vh;
  const ctx = offscreenCanvas.getContext('2d');
  ctx.drawImage(videoOrCanvas, 0, 0, vw, vh);
  const dataUrl = offscreenCanvas.toDataURL('image/jpeg', 0.85);
  const res = await fetch(`${DEFAULT_URL}/predict/base64`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: dataUrl, confidence: conf }),
  });
  if (!res.ok) throw new Error(`GPU inference failed: ${res.statusText}`);
  return await res.json();
}
