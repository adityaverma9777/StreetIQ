import * as tf from '@tensorflow/tfjs';

const LABELS = [
  'D00 (Longitudinal Crack)',
  'D10 (Transverse Crack)',
  'D20 (Alligator Crack)',
  'D40 (Pothole)',
];

const RDD_TO_APP_TYPE = {
  'D00 (Longitudinal Crack)': 'crack',
  'D10 (Transverse Crack)': 'crack',
  'D20 (Alligator Crack)': 'crack',
  'D40 (Pothole)': 'pothole',
};

const RDD_TO_DISPLAY = {
  'D00 (Longitudinal Crack)': 'Longitudinal Crack',
  'D10 (Transverse Crack)': 'Transverse Crack',
  'D20 (Alligator Crack)': 'Alligator Crack',
  'D40 (Pothole)': 'Pothole',
};

function mapToAppType(rawLabel) {
  return RDD_TO_APP_TYPE[rawLabel] || 'crack';
}

export function mapToDisplayLabel(rawLabel) {
  return RDD_TO_DISPLAY[rawLabel] || rawLabel;
}

function extractTensor(output) {
  if (Array.isArray(output)) return output[0];
  return output;
}

export async function parseYoloOutputAll(output, threshold = 0.10) {
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
  const rawDetections = [];
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
    const cx = get(0);
    const cy = get(1);
    const w = get(2);
    const h = get(3);
    if (w <= 0 || h <= 0) continue;
    if (w < 8 || h < 8) continue;
    rawDetections.push({
      classIndex: maxIdx,
      rawLabel: LABELS[maxIdx],
      className: mapToAppType(LABELS[maxIdx]),
      displayLabel: mapToDisplayLabel(LABELS[maxIdx]),
      confidence: maxProb,
      bbox: { cx, cy, w, h },
      nmsBox: [cy - h / 2, cx - w / 2, cy + h / 2, cx + w / 2],
    });
  }
  if (rawDetections.length === 0) return [];
  const boxesTensor = tf.tensor2d(rawDetections.map(d => d.nmsBox), [rawDetections.length, 4]);
  const scoresTensor = tf.tensor1d(rawDetections.map(d => d.confidence));
  const nmsIndices = await tf.image.nonMaxSuppressionAsync(boxesTensor, scoresTensor, 50, 0.45, threshold);
  const selectedIndices = await nmsIndices.data();
  boxesTensor.dispose();
  scoresTensor.dispose();
  nmsIndices.dispose();
  const finalDetections = [];
  for (let i = 0; i < selectedIndices.length; i++) {
    finalDetections.push(rawDetections[selectedIndices[i]]);
  }
  return finalDetections;
}

export async function parseYoloOutput(output, threshold = 0.20) {
  const all = await parseYoloOutputAll(output, threshold);
  return all.length > 0 ? [all[0]] : [];
}

export function runInference(model, videoOrCanvas) {
  return tf.tidy(() => {
    const img = tf.browser.fromPixels(videoOrCanvas)
      .resizeBilinear([640, 640])
      .expandDims(0)
      .toFloat()
      .div(255.0);
    const result = model.execute({ images: img });
    return result;
  });
}
