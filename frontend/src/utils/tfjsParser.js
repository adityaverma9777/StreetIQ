import * as tf from '@tensorflow/tfjs';

const LABELS = ['D00 Crack', 'D10 Crack', 'D20 Crack', 'D40 Pothole'];

function extractTensor(output) {
  if (Array.isArray(output)) return output[0];
  return output;
}

export async function parseYoloOutputAll(output, threshold = 0.15) {
  const tensor = extractTensor(output);
  const shape = tensor.shape;
  if (shape.length !== 3) return [];
  const [, rows, cols] = shape;
  const numBoxes = cols >= rows ? cols : rows;
  const numFeatures = cols >= rows ? rows : cols;
  const colsMajor = cols >= rows;
  const numClasses = numFeatures - 4;
  if (numClasses <= 0) return [];
  const data = await tensor.data();
  const detections = [];
  for (let b = 0; b < numBoxes; b++) {
    let maxProb = -Infinity;
    let maxIdx = 0;
    for (let c = 0; c < numClasses; c++) {
      const i = colsMajor ? (4 + c) * numBoxes + b : b * numFeatures + (4 + c);
      const prob = data[i];
      if (prob > maxProb) { maxProb = prob; maxIdx = c; }
    }
    if (maxProb <= threshold) continue;
    const get = (f) => colsMajor ? data[f * numBoxes + b] : data[b * numFeatures + f];
    const w = get(2);
    const h = get(3);
    if (w <= 0 || h <= 0) continue;
    detections.push({
      classIndex: maxIdx,
      className: LABELS[maxIdx] || 'unknown',
      confidence: maxProb,
      bbox: { cx: get(0), cy: get(1), w, h },
    });
  }
  if (detections.length <= 1) return detections;
  detections.sort((a, b) => b.confidence - a.confidence);
  return detections.length > 20 ? detections.slice(0, 20) : detections;
}

export async function parseYoloOutput(output, threshold = 0.15) {
  const all = await parseYoloOutputAll(output, threshold);
  return all.length > 1 ? all.slice(0, 1) : all;
}
