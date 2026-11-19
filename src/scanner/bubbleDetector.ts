// src/scanner/bubbleDetector.ts
import { getBubbleCentre, getTestIdBubbleCentre, mmToPx, OMR_LAYOUT } from '../config/omrLayout';
import { getSettings, MARK_REVIEW_THRESHOLDS } from '../config/scannerSettings';
const RULES = MARK_REVIEW_THRESHOLDS;
import { measureRadialInk } from './radialInk';
import { measureOutlineBand, hasInterBubbleInk, hasExternalStroke } from './strayInk';
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
  localPaperBrightness?: number;
  filledQuadrants?: number;
  strokeLike?: boolean;
  effectiveThreshold?: number;
  axisCoverage?: number;
  diagonalCoverage?: number;
  filledSectors?: number;
  paperReferenceBrightness?: number;
  paperReferenceContaminated?: boolean;
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
  darkThreshold: number = 152,
  dpi: number = 150,
  paperOverride?: number,
  inkCeiling?: number
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

  // Reference-informed local background: the printed outline has radius
  // 1.7mm. Sample clean paper in a 2.05–2.55mm annulus, before the option
  // letter printed ~3.3mm to the right. Use the median to resist speckles.
  const ringInner = Math.max(r + 2, Math.round(mmToPx(2.05, dpi)));
  const ringOuter = Math.max(ringInner + 2, Math.round(mmToPx(2.55, dpi)));
  const ringSamples: number[] = [];
  for (let dy = -ringOuter; dy <= ringOuter; dy++) {
    for (let dx = -ringOuter; dx <= ringOuter; dx++) {
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq < ringInner * ringInner || distanceSq > ringOuter * ringOuter) continue;
      const sampleX = bestCx + dx, sampleY = bestCy + dy;
      if (sampleX < 0 || sampleY < 0 || sampleX >= grayMat.cols || sampleY >= grayMat.rows) continue;
      ringSamples.push(grayMat.ucharPtr(sampleY, sampleX)[0]);
    }
  }
  ringSamples.sort((a,b) => a-b);
  const paper = ringSamples.length ? ringSamples[Math.floor(ringSamples.length / 2)] : 235;
  // Shadow-resistant threshold: local paper must never itself count as ink.
  // Retain the established threshold on well-lit paper.
  const referencePaper = paperOverride ?? paper;
  const correction = Math.max(-7, Math.min(7, (referencePaper - 235) * .14));
  const inkThreshold = Math.max(50, Math.min(173, darkThreshold + correction, referencePaper - (inkCeiling === undefined ? 24 : 36), inkCeiling ?? 173));

  let totalCirclePx = 0;
  let darkCirclePx = 0;
  let leftDark = 0, leftTot = 0;
  let rightDark = 0, rightTot = 0;
  let q1Dark = 0, q1Tot = 0; // Top-Left
  let q2Dark = 0, q2Tot = 0; // Top-Right
  let q3Dark = 0, q3Tot = 0; // Bottom-Left
  let q4Dark = 0, q4Tot = 0; // Bottom-Right
  let axisDark = 0, axisTotal = 0, diagonalDark = 0, diagonalTotal = 0;
  const sectorDark = Array(8).fill(0) as number[];
  const sectorTotal = Array(8).fill(0) as number[];

  const rSq = r * r;
  for (let row = 0; row < h; row++) {
    const dy = row - r;
    const dySq = dy * dy;
    for (let col = 0; col < w; col++) {
      const dx = col - r;
      if (dx * dx + dySq <= rSq) {
        totalCirclePx++;
        const pixelVal = grayMat.ucharPtr(y + row, x + col)[0];
        const isDark = pixelVal < inkThreshold;
        if (isDark) darkCirclePx++;
        if (r >= 5 && dx * dx + dy * dy >= rSq * 0.25) {
          const sector = Math.min(7, Math.floor((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI) * 8));
          sectorTotal[sector]++;
          if (isDark) sectorDark[sector]++;
        }
        if (Math.abs(dx) <= 1 || Math.abs(dy) <= 1) {
          axisTotal++;
          if (isDark) axisDark++;
        }
        if (Math.abs(Math.abs(dx) - Math.abs(dy)) <= 1) {
          diagonalTotal++;
          if (isDark) diagonalDark++;
        }

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

  // Shape-aware rejection: thin slashes/ticks often darken only one or two
  // quadrants. A genuinely filled bubble should occupy most quadrants, even
  // when photographed under moderate shadows.
  const filledQuadrants = [q1Pct, q2Pct, q3Pct, q4Pct].filter(v => v >= RULES.quadrantCoverage).length;
  const axisCoverage = axisTotal ? axisDark * 100 / axisTotal : 0;
  const diagonalCoverage = diagonalTotal ? diagonalDark * 100 / diagonalTotal : 0;
  const filledSectors = sectorTotal.filter((n,i) => n >= 3 && sectorDark[i] / n >= 0.30).length;
  // A thick X can cover all four quadrants and must not become valid at 65%.
  const strokeLike = fillPercent >= RULES.strokeReviewMinFill && fillPercent < RULES.strokeReviewMaxFill && (
    filledQuadrants <= 2 ||
    (diagonalCoverage >= RULES.diagonalLineCoverage && diagonalCoverage - axisCoverage >= RULES.diagonalAxisGap) ||
    diagonalDisparity > RULES.diagonalDisparity ||
    horizontalDisparity > RULES.horizontalDisparity ||
    (r >= 5 && filledSectors < 5 && fillPercent < 85) ||
    (fillPercent < 85 && diagonalDisparity > 65 && horizontalDisparity >= 30)
  );

  // OMR rejection criteria:
  // 1. Solid fill threshold: at least 45% (crosses ~25%, ticks ~25% fail)
  // 2. Crescent mark: horizontal disparity > 65% with an empty opposing side (< 15%)
  // 3. Diagonal slash: opposing diagonal disparity > 85% when fill < 65%
  let isValid = true;
  let rejectReason: string | undefined;

  if (fillPercent < getSettings().bubbleFillThreshold) {
    isValid = false;
    rejectReason = `Low fill (${fillPercent.toFixed(0)}%)`;
  } else if (strokeLike) {
    isValid = false;
    rejectReason = `Stroke-like shape (quadrants=${filledQuadrants}/4, diag=${diagonalCoverage.toFixed(0)}%, axis=${axisCoverage.toFixed(0)}%)`;
  } else if (horizontalDisparity > 65 && Math.min(leftPct, rightPct) < 15) {
    isValid = false;
    rejectReason = `Half-filled crescent mark (H-disparity ${horizontalDisparity.toFixed(0)}%)`;
  } else if (fillPercent < 65 && diagonalDisparity > 85) {
    isValid = false;
    rejectReason = `Diagonal slash mark (diagonal disparity ${diagonalDisparity.toFixed(0)}%)`;
  }

  return { fillPercent, horizontalDisparity, diagonalDisparity, isValid,
    rejectReason, localPaperBrightness: paper, filledQuadrants, strokeLike,
    effectiveThreshold: inkThreshold, axisCoverage, diagonalCoverage, filledSectors,
    paperReferenceBrightness: referencePaper, paperReferenceContaminated: paperOverride !== undefined };
}

export function detectQuestion(
  correctedGray: any,  // grayscale cv.Mat of perspective-corrected image
  question: number,    // 1-based
  dpi: number,
  darkThreshold?: number,
  inkCeiling?: number,
  offset: {dx:number;dy:number} = {dx:0,dy:0}
): BubbleReadResult {
  const settings = getSettings();
  const effectiveThreshold = darkThreshold ?? computeAdaptiveDarkThreshold(correctedGray);
  const options: AnswerOption[] = ['A', 'B', 'C', 'D'];
  // Specification: 3.4 mm answer bubbles have an interior radius of 1.0 mm (leaving the 1.7mm outline outside)
  const interiorRadiusPx = mmToPx(1.0, dpi);
  
  const centres = options.map((_, idx) => {
    const c = getBubbleCentre(question, idx as 0|1|2|3);
    return { x: mmToPx(c.xMm,dpi)+offset.dx, y: mmToPx(c.yMm,dpi)+offset.dy };
  });
  const preliminary = centres.map(c =>
    measureBubbleInterior(correctedGray, c.x, c.y, interiorRadiusPx, effectiveThreshold, dpi, undefined, inkCeiling));
  // An extended pen mark can flood the 2.05–2.55mm reference annulus.
  // Borrow nearby paper only for an extreme isolated anomaly, not for
  // ordinary localized shadows such as Test 10 Q21–24.
  const details = preliminary.map((sample,idx) => {
    const localPaper = sample.localPaperBrightness ?? 235;
    const others = preliminary.filter((_,j)=>j!==idx)
      .map(d=>d.localPaperBrightness ?? 235)
      .sort((a,b)=>a-b);
    const reference = others[1];
    if (localPaper < 105 && reference - localPaper >= 65 &&
        others.filter(v=>v>=145).length >= 2)
      return measureBubbleInterior(correctedGray, centres[idx].x, centres[idx].y,
        interiorRadiusPx, effectiveThreshold, dpi, reference, inkCeiling);
    return sample;
  });
  const rawMeasurements = options.map((opt, idx) => {
    const centre = getBubbleCentre(question, idx as 0|1|2|3);
    const cxPx = centres[idx].x;
    const cyPx = centres[idx].y;
    const detail = details[idx];
    const radial = measureRadialInk(correctedGray, cxPx, cyPx, dpi, detail.effectiveThreshold ?? effectiveThreshold);
    const clearlyInvalid = radial.classification === 'centre_dot' || radial.classification === 'hollow_ring';
    const unevenOuter = radial.classification === 'partial' && detail.fillPercent >= settings.bubbleFillThreshold;
    // Q38-D-type crescent can darken most of the *interior* while leaving
    // an incomplete outer fill. Check radial consistency even above 85%.
    const highFillCrescent = detail.fillPercent >= 75 &&
      detail.fillPercent < 97 &&
      radial.core >= 75 &&
      radial.outer < 42 &&
      radial.core - radial.outer > 42;
    if (highFillCrescent) {
      detail.isValid = false;
      detail.rejectReason = 'High-density partial/crescent: outer coverage insufficient';
    }
    if (!highFillCrescent && detail.fillPercent >= settings.bubbleFillThreshold && (clearlyInvalid || unevenOuter)) {
      detail.isValid = false;
      detail.rejectReason = radial.classification === 'centre_dot'
        ? 'Small central dot, not a completely filled bubble'
        : radial.classification === 'hollow_ring'
        ? 'Hollow ring: bubble interior is not filled'
        : 'Ink distribution does not resemble a complete fill';
    }
    return {
      measurement: {
        question, option: opt, fillPercent: detail.fillPercent,
        horizontalDisparity: detail.horizontalDisparity,
        diagonalDisparity: detail.diagonalDisparity,
        validMark: detail.isValid,
        rejectReason: detail.rejectReason,
        sampleXPx: Math.round(cxPx), sampleYPx: Math.round(cyPx),
        inkThreshold: detail.effectiveThreshold,
        localPaperBrightness: detail.localPaperBrightness,
        paperReferenceBrightness: detail.paperReferenceBrightness,
        paperReferenceContaminated: detail.paperReferenceContaminated,
        filledQuadrants: detail.filledQuadrants,
        strokeLike: detail.strokeLike,
        axisCoverage: detail.axisCoverage,
        diagonalCoverage: detail.diagonalCoverage,
        stabilitySpread: undefined as number | undefined,
        radialCore: Number(radial.core.toFixed(1)),
        radialMiddle: Number(radial.middle.toFixed(1)),
        radialOuter: Number(radial.outer.toFixed(1)),
        radialShape: radial.classification,
        filledSectors: detail.filledSectors,
        xMm: centre.xMm, yMm: centre.yMm
      },
      detail,
    };
  });

  const measurements = rawMeasurements.map(r => r.measurement);
  // Separate stray-ink signals from answer validity.
  const bands = centres.map(c => measureOutlineBand(correctedGray,c.x,c.y,dpi));
  const tracedOutline = bands.some((value,i) =>
    measurements[i].fillPercent < settings.bubbleFillThreshold &&
    value < 85 && Math.max(...bands.filter((_,j)=>j!==i)) - value > 45);
  const offBubbleInk = hasInterBubbleInk(correctedGray,centres,dpi,effectiveThreshold,
    measurements.map(m => m.localPaperBrightness ?? 235));
  // The 2.0.1 external-band probe sees printed text/rings and JPEG artifacts,
  // so it is not trustworthy when a clear solid answer is present. Constrain
  // it to *otherwise unfilled* rows that also have local interior evidence of
  // a genuine stray mark. Never reject a clear fill based on this probe alone.
  const strongestFill = Math.max(...measurements.map(m => m.fillPercent));
  const externalStroke = strongestFill < settings.bubbleFillThreshold &&
    centres.some((c,i) =>
      measurements[i].fillPercent >= 18 &&
      measurements[i].fillPercent < settings.bubbleFillThreshold &&
      hasExternalStroke(correctedGray,c.x,c.y,dpi,
        measurements[i].paperReferenceBrightness ?? measurements[i].localPaperBrightness ?? 235));
  const unexpectedInk = tracedOutline || offBubbleInk || externalStroke;
  const reviewUnexpected = (): BubbleReadResult => {
    const target = rawMeasurements.reduce((a,b) => a.measurement.fillPercent >= b.measurement.fillPercent ? a:b);
    target.measurement.rejectReason = tracedOutline ? 'Ink traced around a bubble outline'
      : offBubbleInk ? 'Ink detected between answer bubbles' : 'Stroke outside bubble outline';
    return { measurements, answer:null,status:'uncertain',confidence:0 };
  };
  
  // Sort by fill descending
  const sorted = [...rawMeasurements].sort((a, b) => b.measurement.fillPercent - a.measurement.fillPercent);
  const top = sorted[0];
  const second = sorted[1];
  const max = top.measurement.fillPercent;
  const baseline = (sorted[1].measurement.fillPercent + sorted[2].measurement.fillPercent + sorted[3].measurement.fillPercent) / 3;
  const jump = max - baseline;
  const diff = max - second.measurement.fillPercent;

  // Evaluate all marks, including a second selection just below the
  // 45% threshold (Test 5 Q29: A=42.5%, C=83.2%).
  const validFills = rawMeasurements.filter(r =>
    r.detail.isValid && r.measurement.fillPercent >= settings.bubbleFillThreshold
  );
  const substantialMarks = rawMeasurements.filter(r =>
    r.measurement.fillPercent >= settings.bubbleFillThreshold
  );
  // Two strongly shaded options remain multiple even if directional noise
  // rejects one shape; otherwise v1.8 could regress Q26 to 'uncertain'.
  // This does NOT promote medium-density background noise (Q24/Q25).
  if (validFills.length >= 2 || (max >= RULES.strongFill && second.measurement.fillPercent >= RULES.strongMultipleRunner &&
    validFills.length >= 1 && rawMeasurements.filter(r => r.measurement.fillPercent >= RULES.strongMultipleRunner &&
      (r.detail.isValid || r.measurement.radialShape === 'insufficient_resolution')).length >= 2)) {
    return { measurements, answer: null, status: 'multiple', confidence: 0 };
  }
  if (max < settings.bubbleFillThreshold) {
    if (unexpectedInk) return reviewUnexpected();
    // v2.1.2: printed-ring/compression debris produces faint annular pixels
    // even in an empty row. Without central evidence or an independent
    // external-stroke signal, do not turn tiny noise into manual review.
    // A visible centre slash/cross still follows the conservative review path.
    const noCoreInk = rawMeasurements.every(r =>
      (r.measurement.radialCore ?? 0) < 8 &&
      (r.measurement.radialMiddle ?? 0) < 20);
    if(max < 12 && noCoreInk)
      return { measurements, answer:null, status:'blank', confidence:Math.max(0,100-max) };
    // A small crossed or ticked bubble can have almost no dark interior
    // at the standard threshold. Compare the fixed interior against local
    // paper without promoting any mark to a valid answer.
    const faintMark = centres.some((c,i) => {
      const paper = measurements[i].paperReferenceBrightness ??
        measurements[i].localPaperBrightness ?? 235;
      const radius = Math.round(mmToPx(1.05,dpi));
      let total=0, dark=0;
      const x0=Math.round(c.x), y0=Math.round(c.y);
      for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
        if(dx*dx+dy*dy>radius*radius)continue;
        const x=x0+dx,y=y0+dy;
        if(x<0||y<0||x>=correctedGray.cols||y>=correctedGray.rows)continue;
        total++;
        if(correctedGray.ucharPtr(y,x)[0] < paper-38)dark++;
      }
      const fraction=total?dark/total:0;
      // Faint strokes: nontrivial interior evidence but not broad solid ink.
      return paper>=115 && fraction>=0.075 && fraction<=0.48 &&
        measurements[i].fillPercent < RULES.visiblePartialFill;
    });
    if (faintMark) {
      top.measurement.rejectReason = 'Faint or thin non-solid ink inside bubble';
      return {measurements,answer:null,status:'uncertain',confidence:0};
    }
    if (max >= RULES.nearThresholdFill ||
        (max >= RULES.visiblePartialFill && (top.detail.filledQuadrants ?? 0) >= 2) ||
        (max >= RULES.visiblePartialFill && top.detail.strokeLike) ||
        rawMeasurements.some(r => r.measurement.radialShape === 'hollow_ring' &&
          r.measurement.radialOuter >= 55)) {
      top.measurement.rejectReason = top.detail.rejectReason || 'Visible mark near the fill threshold';
      return { measurements, answer: null, status: 'uncertain', confidence: 0 };
    }
    return { measurements, answer: null, status: 'blank', confidence: Math.max(0, 100 - max) };
  }

  const borderlineSecond = max >= RULES.secondMarkTopMin &&
    second.measurement.fillPercent >= RULES.secondMarkFillMin &&
    second.measurement.fillPercent >= max * RULES.secondMarkRelative;
  if (borderlineSecond && substantialMarks.length < 2) {
    second.measurement.rejectReason = 'Possible additional mark just below threshold';
    return { measurements, answer: null, status: 'uncertain', confidence: 0 };
  }
  if (substantialMarks.length >= 2 || !top.detail.isValid || jump < RULES.minJump ||
      diff < settings.bubbleUncertainThreshold) {
    return { measurements, answer: null, status: 'uncertain', confidence: 0 };
  }

  // Only borderline selections need perturbation analysis; clear 90%-filled
  // answers remain fast. Recheck neighbouring ink thresholds and ROI centres.
  if (max < RULES.strongFill) {
    const optionIdx = options.indexOf(top.measurement.option) as 0|1|2|3;
    const centre = getBubbleCentre(question, optionIdx);
    const cx = mmToPx(centre.xMm, dpi)+offset.dx, cy = mmToPx(centre.yMm, dpi)+offset.dy;
    const samples = [
      measureBubbleInterior(correctedGray, cx, cy, interiorRadiusPx, effectiveThreshold - RULES.thresholdPerturbation, dpi),
      measureBubbleInterior(correctedGray, cx, cy, interiorRadiusPx, effectiveThreshold + RULES.thresholdPerturbation, dpi),
      measureBubbleInterior(correctedGray, cx - 1, cy, interiorRadiusPx, effectiveThreshold, dpi),
      measureBubbleInterior(correctedGray, cx + 1, cy, interiorRadiusPx, effectiveThreshold, dpi),
      measureBubbleInterior(correctedGray, cx, cy - 1, interiorRadiusPx, effectiveThreshold, dpi),
      measureBubbleInterior(correctedGray, cx, cy + 1, interiorRadiusPx, effectiveThreshold, dpi),
    ];
    const values = [max, ...samples.map(s => s.fillPercent)];
    const range = Math.max(...values) - Math.min(...values);
    top.measurement.stabilitySpread = Number(range.toFixed(1));
    if (range >= RULES.stabilityReviewSpread || samples.filter(s => s.strokeLike).length >= 2) {
      top.measurement.rejectReason = 'Unstable or stroke-like mark (variation ' + range.toFixed(0) + '%)';
      return { measurements, answer: null, status: 'uncertain', confidence: 0 };
    }
  }

  if (unexpectedInk) return reviewUnexpected();

  // Difference from other options is a separation score, not the likelihood
  // of a valid filled bubble. Cap confidence for borderline marks.
  const cap = max < 60 ? 75 : max < 75 ? 87 : max < 85 ? 95 : 99;
  return {
    measurements,
    answer: top.measurement.option,
    status: 'detected',
    confidence: Math.min(cap, Math.round(diff * 3)),
  };
}

export function detectAllAnswers(
  correctedGray: any,
  dpi: number,
  inkCeiling?: number,
  offsetForRow: (q:number)=>{dx:number;dy:number} = ()=>({dx:0,dy:0})
): QuestionResult[] {
  const darkThreshold = computeAdaptiveDarkThreshold(correctedGray);
  return Array.from({ length: 50 }, (_, i) => {
    const q = i + 1;
    const result = detectQuestion(correctedGray, q, dpi, darkThreshold, inkCeiling, offsetForRow(q));
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
  dpi: number,
  inkCeiling?: number,
  offset: {dx:number;dy:number} = {dx:0,dy:0}
): { tens: number | null; units: number | null; testId: number | null;
  tensCandidates: {digit:number;fill:number;valid:boolean}[];
  unitsCandidates: {digit:number;fill:number;valid:boolean}[] } {
  const settings = getSettings();
  const darkThreshold = computeAdaptiveDarkThreshold(correctedGray);
  const TID = OMR_LAYOUT.testId;
  // Specification: 4.0 mm test-ID bubbles have an interior radius of 1.3 mm
  const interiorRadiusPx = mmToPx(1.3, dpi);
  
  // Detect TENS (0-5)
  const tensFills = (TID.tens.digits as readonly number[]).map(digit => {
    const c = getTestIdBubbleCentre('tens', digit);
    const detail = measureBubbleInterior(correctedGray, mmToPx(c.xMm, dpi)+offset.dx, mmToPx(c.yMm, dpi)+offset.dy, interiorRadiusPx, darkThreshold, dpi, undefined, inkCeiling);
    return { digit, fill: detail.fillPercent, valid: detail.isValid, paper: detail.paperReferenceBrightness ?? 235 };
  });
  
  // Detect UNITS (0-9)
  const unitsFills = (TID.units.digits as readonly number[]).map(digit => {
    const c = getTestIdBubbleCentre('units', digit);
    const detail = measureBubbleInterior(correctedGray, mmToPx(c.xMm, dpi)+offset.dx, mmToPx(c.yMm, dpi)+offset.dy, interiorRadiusPx, darkThreshold, dpi, undefined, inkCeiling);
    return { digit, fill: detail.fillPercent, valid: detail.isValid, paper: detail.paperReferenceBrightness ?? 235 };
  });
  
  const sortedTens = [...tensFills].sort((a,b) => b.fill - a.fill);
  const sortedUnits = [...unitsFills].sort((a,b) => b.fill - a.fill);
  
  const bestTens = sortedTens[0];
  const runnerTens = sortedTens[1];
  const tensDiff = runnerTens ? bestTens.fill - runnerTens.fill : bestTens.fill;
  
  const bestUnits = sortedUnits[0];
  const runnerUnits = sortedUnits[1];
  const unitsDiff = runnerUnits ? bestUnits.fill - runnerUnits.fill : bestUnits.fill;
  
  // The ID rows contain only one valid mark each. Allow a strongly
  // isolated mark even if the generic answer-shape classifier rejects it
  // due to photographic artifacts. Never choose a digit on a close tie.
  const isolatedDigit = (
    best: {digit:number;fill:number;valid:boolean;paper:number} | undefined,
    runner: {fill:number} | undefined,
    separation: number,
  ): number | null => {
    if (!best || separation < RULES.testIdMinSeparation) return null;
    const strong = best.fill >= 70 && separation >= 30;
    const moderate = best.fill >= settings.bubbleFillThreshold &&
      best.valid && separation >= RULES.testIdMinSeparation;
    const lowLightRescue = best.fill >= 40 && best.valid &&
      separation >= 32 && (runner?.fill ?? 0) < 18;
    return strong || moderate || lowLightRescue ? best.digit : null;
  };
  const tens = isolatedDigit(bestTens, runnerTens, tensDiff);
  const units = isolatedDigit(bestUnits, runnerUnits, unitsDiff);
  
  const testId = (tens !== null && units !== null) ? tens * 10 + units : null;
  const validRange = testId !== null && testId >= 1 && testId <= 40;
  
  return { tens, units, testId: validRange ? testId : null,
    tensCandidates: tensFills.map(({digit,fill,valid})=>({digit,fill,valid})),
    unitsCandidates: unitsFills.map(({digit,fill,valid})=>({digit,fill,valid})) };

}
