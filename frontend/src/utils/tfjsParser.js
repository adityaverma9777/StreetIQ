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

  console.log('[YOLO] shape:', shape, 'total values:', data.length);

  const detections = [];

  if (shape.length !== 3) {
    console.warn('[YOLO] Unexpected tensor rank:', shape.length);
    return [];
  }

  const [, rows, cols] = shape;
  const numBoxes = cols >= rows ? cols : rows;
  const numFeatures = cols >= rows ? rows : cols;
  const colsMajor = cols >= rows;

  console.log(`[YOLO] numBoxes=${numBoxes} numFeatures=${numFeatures} colsMajor=${colsMajor}`);

  let maxSeen = -Infinity;
  let minSeen = Infinity;
  for (let i = 0; i < Math.min(data.length, 200); i++) {
    if (data[i] > maxSeen) maxSeen = data[i];
    if (data[i] < minSeen) minSeen = data[i];
  }
  console.log(`[YOLO] value range in first 200: min=${minSeen.toFixed(3)} max=${maxSeen.toFixed(3)}`);

  const numClasses = numFeatures - 4;
  if (numClasses <= 0) {
    console.warn('[YOLO] numClasses <= 0, numFeatures:', numFeatures);
    return [];
  }

  console.log(`[YOLO] numClasses=${numClasses}`);

  const classOffset = 4 * numBoxes;
  let classMin = Infinity, classMax = -Infinity;
  const sampleScores = [];
  for (let b = 0; b < Math.min(10, numBoxes); b++) {
    const scores = [];
    for (let c = 0; c < numClasses; c++) {
      const val = data[classOffset + c * numBoxes + b];
      scores.push(val.toFixed(4));
      if (val > classMax) classMax = val;
      if (val < classMin) classMin = val;
    }
    sampleScores.push(`box${b}:[${scores.join(',')}]`);
  }
  console.log('[YOLO] Class scores for first 10 boxes:', sampleScores.join(' '));
  console.log(`[YOLO] Class score range: min=${classMin.toFixed(4)} max=${classMax.toFixed(4)}`);


  let globalMaxProb = -Infinity;
  for (let b = 0; b < numBoxes; b++) {
    let maxProb = -Infinity;
    let maxIdx = -1;

    for (let c = 0; c < numClasses; c++) {
      const i = colsMajor ? (4 + c) * numBoxes + b : b * numFeatures + (4 + c);
      // Float32 export preserves the PyTorch Sigmoid layer, so these are native 0-1 probabilities!
      const prob = data[i];
      if (prob > maxProb) { maxProb = prob; maxIdx = c; }
    }

    if (maxProb > globalMaxProb) {
      globalMaxProb = maxProb;
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
  console.log(`[YOLO] global max probability across ALL boxes: ${globalMaxProb.toFixed(4)}`);

  console.log(`[YOLO] detections found: ${detections.length}`);
  detections.sort((a, b) => b.confidence - a.confidence);
  return detections.slice(0, 20);
}

export async function parseYoloOutput(output, threshold = 0.15) {
  const all = await parseYoloOutputAll(output, threshold);
  return all.slice(0, 1);
}
