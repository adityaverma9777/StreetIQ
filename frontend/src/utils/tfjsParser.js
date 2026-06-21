import * as tf from '@tensorflow/tfjs';

const LABELS = ['D00 Crack', 'D10 Crack', 'D20 Crack', 'D40 Pothole'];

function extractTensor(output) {
  if (Array.isArray(output)) return output[0];
  return output;
}

export async function parseYoloOutputAll(output, threshold = 0.15) {
  const tensor = extractTensor(output);
  const shape = tensor.shape;
  const data = await tensor.data();
  const detections = [];
  if (shape.length !== 3) return [];
  const [, rows, cols] = shape;
  const numBoxes = cols >= rows ? cols : rows;
  const numFeatures = cols >= rows ? rows : cols;
  const colsMajor = cols >= rows;
  const numClasses = numFeatures - 4;
  if (numClasses <= 0) return [];
  for (let b = 0; b < numBoxes; b++) {
    let maxProb = -Infinity;
    let maxIdx = -1;
    for (let c = 0; c < numClasses; c++) {
      const i = colsMajor ? (4 + c) * numBoxes + b : b * numFeatures + (4 + c);
      const prob = data[i];
      if (prob > maxProb) { maxProb = prob; maxIdx = c; }
    }
    if (maxProb > threshold) {
      const get = (f) => colsMajor ? data[f * numBoxes + b] : data[b * numFeatures + f];
      const cx = get(0), cy = get(1), w = get(2), h = get(3);
      if (w > 0 && h > 0) {
        detections.push({
          classIndex: maxIdx,
          className: LABELS[maxIdx] || 'unknown',
          confidence: maxProb,
          bbox: { cx, cy, w, h },
        });
      }
    }
  }
  detections.sort((a, b) => b.confidence - a.confidence);
  return detections.slice(0, 20);
}

export async function parseYoloOutput(output, threshold = 0.15) {
  const all = await parseYoloOutputAll(output, threshold);
  return all.slice(0, 1);
}
