// src/scanner/bubbleDetector.ts
import { getBubbleCentre, getTestIdBubbleCentre, mmToPx, OMR_LAYOUT } from '../config/omrLayout';
import { getSettings } from '../config/scannerSettings';
import type { AnswerOption, BubbleMeasurement, DetectionStatus, QuestionResult } from '../types';

declare const cv: any;

export interface BubbleReadResult {
  measurements: BubbleMeasurement[];
  answer: AnswerOption | null;
  status: DetectionStatus;
  confidence: number;
}

export interface BubbleMeasurementDetail {
  fillPercent: number;
  horizontalDisparity: number;
  diagonalDisparity: number;
  isValid: boolean;
  rejectReason?: string;
}

/**
 * Computes an adaptive darkness threshold based on the sheet's actual paper reflectance.
 * Computes an Otsu threshold on the perspective-corrected grayscale sheet,
 * and sets the ink-darkness threshold dynamically: Math.max(142, Math.min(166, Math.round((140 + otsu) / 2)))
 * Default fallback is 152.
 */
export function computeAdaptiveDarkThreshold(grayMat: any): number {
  if (!grayMat || !grayMat.rows || !grayMat.cols) return 152;
  const hist = new Int32Array(256);
  let count = 0;
  // Subsample every 4th pixel for high speed (< 2ms)
  for (let r = 0; r < grayMat.rows; r += 4) {
    for (let c = 0; c < grayMat.cols; c += 4) {
      const val = grayMat.ucharPtr(r, c)[0];
      hist[val]++;
      count++;
    }
  }

  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];

  let sumB = 0;
  let wB = 0;
  let varMax = 0;
  let otsu = 168;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = count - wB;
    if (wF === 0) break;

    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) * (mB - mF);

    if (varBetween > varMax) {
      varMax = varBetween;
      otsu = t;
    }
  }

  // Ink threshold: safely calibrated halfway between ink baseline (140) and Otsu background boundary
  return Math.max(142, Math.min(166, Math.round((140 + otsu) / 2)));
}

/**
 * Measure dark pixel fill % strictly inside the interior of the bubble (radius <= interiorRadiusMm),
 * and compute directional symmetry (horizontal disparity and diagonal disparity) to filter out
 * partial marks (slashes, crosses, crescents, ticks) following established published OMR engine specifications.
 */
function measureBubbleInterior(
  grayMat: any, // grayscale cv.Mat
  cxPx: number,
  cyPx: number,
  interiorRadiusPx: number,
  darkThreshold: number = 152
): BubbleMeasurementDetail {
  // Sample the known homography-mapped centre. Searching for the darkest
  // single pixel caused the ROI to chase outlines and stray ink.
  const bestCx = Math.round(cxPx);
  const bestCy = Math.round(cyPx);
  const r = Math.max(2, Math.round(interiorRadiusPx));
  if (bestCx - r < 0 || bestCy - r < 0 ||
      bestCx + r >= grayMat.cols || bestCy + r >= grayMat.rows) {
    return { fillPercent: 0, horizontalDisparity: 0, diagonalDisparity: 0, isValid: false, rejectReason: 'out_of_bounds' };
  }
  const x = bestCx - r;
  const y = bestCy - r;
  const w = r * 2 + 1;
  const h = r * 2 + 1;
  if (w <= 0 || h <= 0) {
    return { fillPercent: 0, horizontalDisparity: 0, diagonalDisparity: 0, isValid: false, rejectReason: 'out_of_bounds' };
  }

  let totalCirclePx = 0;
  let darkCirclePx = 0;
  let leftDark = 0, leftTot = 0;
  let rightDark = 0, rightTot = 0;
  let q1Dark = 0, q1Tot = 0; // Top-Left
  let q2Dark = 0, q2Tot = 0; // Top-Right
  let q3Dark = 0, q3Tot = 0; // Bottom-Left
  let q4Dark = 0, q4Tot = 0; // Bottom-Right

  const rSq = r * r;
  for (let row = 0; row < h; row++) {
    const dy = row - r;
    const dySq = dy * dy;
    for (let col = 0; col < w; col++) {
      const dx = col - r;
      if (dx * dx + dySq <= rSq) {
        totalCirclePx++;
        const pixelVal = grayMat.ucharPtr(y + row, x + col)[0];
        const isDark = pixelVal < darkThreshold;
        if (isDark) darkCirclePx++;

        if (dx < 0) {
          leftTot++;
          if (isDark) leftDark++;
        } else if (dx > 0) {
          rightTot++;
          if (isDark) rightDark++;
        }

        if (dy < 0 && dx < 0) {
          q1Tot++; if (isDark) q1Dark++;
        } else if (dy < 0 && dx > 0) {
          q2Tot++; if (isDark) q2Dark++;
        } else if (dy > 0 && dx < 0) {
          q3Tot++; if (isDark) q3Dark++;
        } else if (dy > 0 && dx > 0) {
          q4Tot++; if (isDark) q4Dark++;
        }
      }
    }
  }

  const fillPercent = totalCirclePx > 0 ? (darkCirclePx / totalCirclePx) * 100 : 0;
  const leftPct = leftTot > 0 ? (leftDark / leftTot) * 100 : 0;
  const rightPct = rightTot > 0 ? (rightDark / rightTot) * 100 : 0;
  const horizontalDisparity = Math.abs(leftPct - rightPct);

  const q1Pct = q1Tot > 0 ? (q1Dark / q1Tot) * 100 : 0;
  const q2Pct = q2Tot > 0 ? (q2Dark / q2Tot) * 100 : 0;
  const q3Pct = q3Tot > 0 ? (q3Dark / q3Tot) * 100 : 0;
  const q4Pct = q4Tot > 0 ? (q4Dark / q4Tot) * 100 : 0;
  const diagonalDisparity = Math.abs((q1Pct + q4Pct) - (q2Pct + q3Pct));

  // Published OMR rejection criteria:
  // 1. Solid fill threshold: at least 45% (crosses ~25%, ticks ~25% fail)
  // 2. Crescent mark: horizontal disparity > 65% with an empty opposing side (< 15%)
  // 3. Diagonal slash: opposing diagonal disparity > 85% when fill < 65%
  let isValid = true;
  let rejectReason: string | undefined;

  if (fillPercent < 45) {
    isValid = false;
    rejectReason = `Low fill (${fillPercent.toFixed(0)}%)`;
  } else if (horizontalDisparity > 65 && Math.min(leftPct, rightPct) < 15) {
    isValid = false;
    rejectReason = `Half-filled crescent mark (H-disparity ${horizontalDisparity.toFixed(0)}%)`;
  } else if (fillPercent < 65 && diagonalDisparity > 85) {
    isValid = false;
    rejectReason = `Diagonal slash mark (diagonal disparity ${diagonalDisparity.toFixed(0)}%)`;
  }

  return { fillPercent, horizontalDisparity, diagonalDisparity, isValid, rejectReason };
}

export function detectQuestion(
  correctedGray: any,  // grayscale cv.Mat of perspective-corrected image
  question: number,    // 1-based
  dpi: number,
  darkThreshold?: number
): BubbleReadResult {
  const settings = getSettings();
  const effectiveThreshold = darkThreshold ?? computeAdaptiveDarkThreshold(correctedGray);
  const options: AnswerOption[] = ['A', 'B', 'C', 'D'];
  // Specification: 3.4 mm answer bubbles have an interior radius of 1.0 mm (leaving the 1.7mm outline outside)
  const interiorRadiusPx = mmToPx(1.0, dpi);
  
  const rawMeasurements = options.map((opt, idx) => {
    const centre = getBubbleCentre(question, idx as 0|1|2|3);
    const cxPx = mmToPx(centre.xMm, dpi);
    const cyPx = mmToPx(centre.yMm, dpi);
    const detail = measureBubbleInterior(correctedGray, cxPx, cyPx, interiorRadiusPx, effectiveThreshold);
    return {
      measurement: { question, option: opt, fillPercent: detail.fillPercent, xMm: centre.xMm, yMm: centre.yMm },
      detail,
    };
  });

  const measurements = rawMeasurements.map(r => r.measurement);
  
  // Sort by fill descending
  const sorted = [...rawMeasurements].sort((a, b) => b.measurement.fillPercent - a.measurement.fillPercent);
  const top = sorted[0];
  const second = sorted[1];
  const max = top.measurement.fillPercent;
  const baseline = (sorted[1].measurement.fillPercent + sorted[2].measurement.fillPercent + sorted[3].measurement.fillPercent) / 3;
  const jump = max - baseline;
  const diff = max - second.measurement.fillPercent;

  // Classify the whole row before choosing a winner. Previously a high
  // baseline could suppress a genuine second mark (Q26 in regression scans).
  const validFills = rawMeasurements.filter(r =>
    r.detail.isValid && r.measurement.fillPercent >= settings.bubbleFillThreshold
  );
  const substantialMarks = rawMeasurements.filter(r =>
    r.measurement.fillPercent >= settings.bubbleFillThreshold
  );

  if (validFills.length >= 2) {
    return { measurements, answer: null, status: 'multiple', confidence: 0 };
  }
  if (max < settings.bubbleFillThreshold) {
    return { measurements, answer: null, status: 'blank', confidence: Math.max(0, 100 - max) };
  }
  if (substantialMarks.length >= 2 || !top.detail.isValid) {
    // Even if another mark fails morphology, it is not safe to assign an
    // unambiguous single answer; ask for a manual review instead.
    return { measurements, answer: null, status: 'uncertain', confidence: 0 };
  }
  if (jump < 16 || diff < settings.bubbleUncertainThreshold) {
    return { measurements, answer: null, status: 'uncertain', confidence: Math.min(Math.round(diff * 2.5), 100) };
  }

  return {
    measurements,
    answer: top.measurement.option,
    status: 'detected',
    confidence: Math.min(Math.round(diff * 3), 100),
  };
}

export function detectAllAnswers(
  correctedGray: any,
  dpi: number
): QuestionResult[] {
  const darkThreshold = computeAdaptiveDarkThreshold(correctedGray);
  return Array.from({ length: 50 }, (_, i) => {
    const q = i + 1;
    const result = detectQuestion(correctedGray, q, dpi, darkThreshold);
    return {
      question: q,
      measurements: result.measurements,
      detectedAnswer: result.answer,
      status: result.status,
      confidence: result.confidence,
      isManuallyEdited: false,
    };
  });
}

export function detectTestId(
  correctedGray: any,
  dpi: number
): { tens: number | null; units: number | null; testId: number | null } {
  const settings = getSettings();
  const darkThreshold = computeAdaptiveDarkThreshold(correctedGray);
  const TID = OMR_LAYOUT.testId;
  // Specification: 4.0 mm test-ID bubbles have an interior radius of 1.3 mm
  const interiorRadiusPx = mmToPx(1.3, dpi);
  
  // Detect TENS (0-5)
  const tensFills = (TID.tens.digits as readonly number[]).map(digit => {
    const c = getTestIdBubbleCentre('tens', digit);
    const detail = measureBubbleInterior(correctedGray, mmToPx(c.xMm, dpi), mmToPx(c.yMm, dpi), interiorRadiusPx, darkThreshold);
    return { digit, fill: detail.fillPercent };
  });
  
  // Detect UNITS (0-9)
  const unitsFills = (TID.units.digits as readonly number[]).map(digit => {
    const c = getTestIdBubbleCentre('units', digit);
    const detail = measureBubbleInterior(correctedGray, mmToPx(c.xMm, dpi), mmToPx(c.yMm, dpi), interiorRadiusPx, darkThreshold);
    return { digit, fill: detail.fillPercent };
  });
  
  const sortedTens = [...tensFills].sort((a,b) => b.fill - a.fill);
  const sortedUnits = [...unitsFills].sort((a,b) => b.fill - a.fill);
  
  const bestTens = sortedTens[0];
  const runnerTens = sortedTens[1];
  const tensDiff = runnerTens ? bestTens.fill - runnerTens.fill : bestTens.fill;
  
  const bestUnits = sortedUnits[0];
  const runnerUnits = sortedUnits[1];
  const unitsDiff = runnerUnits ? bestUnits.fill - runnerUnits.fill : bestUnits.fill;
  
  // Digit detection
  const tens = (bestTens && (bestTens.fill >= settings.bubbleFillThreshold || (bestTens.fill >= 25 && tensDiff >= 12)))
    ? bestTens.digit
    : null;
    
  const units = (bestUnits && (bestUnits.fill >= settings.bubbleFillThreshold || (bestUnits.fill >= 25 && unitsDiff >= 12)))
    ? bestUnits.digit
    : null;
  
  const testId = (tens !== null && units !== null) ? tens * 10 + units : null;
  const validRange = testId !== null && testId >= 1 && testId <= 40;
  
  return { tens, units, testId: validRange ? testId : null };
}
