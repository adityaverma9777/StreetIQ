const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

export async function analyzeImageWithGemini(imageBlob) {
  const formData = new FormData();
  formData.append('image', imageBlob, 'hazard.jpg');
  const res = await fetch(`${BACKEND_URL}/api/gemini-analyze`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    throw new Error('Analysis failed');
  }
  return res.json();
}
