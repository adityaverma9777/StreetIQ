import * as tf from '@tensorflow/tfjs';

const LABELS = ['crack', 'crack', 'crack', 'pothole'];

export async function parseYoloOutput(outputTensor, threshold = 0.5) {
  const data = await outputTensor.data();
  const numClasses = 4;
  const numBoxes = 8400;

  let bestDetection = null;

  for (let i = 0; i < numBoxes; i++) {
    let maxClassProb = 0;
    let maxClassIndex = -1;
    for (let c = 0; c < numClasses; c++) {
      const prob = data[(4 + c) * numBoxes + i];
      if (prob > maxClassProb) { maxClassProb = prob; maxClassIndex = c; }
    }
    if (maxClassProb > threshold) {
      if (!bestDetection || maxClassProb > bestDetection.confidence) {
        const cx = data[0 * numBoxes + i];
        const cy = data[1 * numBoxes + i];
        const w  = data[2 * numBoxes + i];
        const h  = data[3 * numBoxes + i];
        bestDetection = {
          classIndex: maxClassIndex,
          className: LABELS[maxClassIndex] || 'unknown',
          confidence: maxClassProb,
          bbox: { cx, cy, w, h },
        };
      }
    }
  }

  return bestDetection ? [bestDetection] : [];
}

export async function parseYoloOutputAll(outputTensor, threshold = 0.35) {
  const data = await outputTensor.data();
  const numClasses = 4;
  const numBoxes = 8400;
  const detections = [];

  for (let i = 0; i < numBoxes; i++) {
    let maxClassProb = 0;
    let maxClassIndex = -1;
    for (let c = 0; c < numClasses; c++) {
      const prob = data[(4 + c) * numBoxes + i];
      if (prob > maxClassProb) { maxClassProb = prob; maxClassIndex = c; }
    }
    if (maxClassProb > threshold) {
      const cx = data[0 * numBoxes + i];
      const cy = data[1 * numBoxes + i];
      const w  = data[2 * numBoxes + i];
      const h  = data[3 * numBoxes + i];
      detections.push({
        classIndex: maxClassIndex,
        className: LABELS[maxClassIndex] || 'unknown',
        confidence: maxClassProb,
        bbox: { cx, cy, w, h },
      });
    }
  }

  detections.sort((a, b) => b.confidence - a.confidence);
  return detections.slice(0, 20);
}
