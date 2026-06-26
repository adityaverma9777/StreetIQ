const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const MAX_WIDTH = 800;
const JPEG_QUALITY = 0.8;

async function resizeImageBlob(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = img.width > MAX_WIDTH ? MAX_WIDTH / img.width : 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(blob); };
    img.src = url;
  });
}

export async function analyzeImageWithGemini(imageBlob) {
  const resized = await resizeImageBlob(imageBlob);
  const formData = new FormData();
  formData.append('image', resized, 'hazard.jpg');
  const res = await fetch(`${BACKEND_URL}/api/gemini-analyze`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    throw new Error('Analysis failed');
  }
  return res.json();
}
