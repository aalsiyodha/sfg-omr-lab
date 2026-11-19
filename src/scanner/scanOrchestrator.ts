import type { ScanResult, IntermediateImages, QuestionResult, MarkerDetectionResult } from '../types';
import { loadImageFromFile, validateImage } from './imageLoader';
import { preprocessImage, checkOpenCV, cleanupMats } from './imagePreprocessor';
import { detectMarkers } from './markerDetector';
import { detectMidpointMarkers, generateMidpointOverlay } from './midpointDetector';
import type { MidpointRegistration } from './midpointDetector';
import { verifyTimingMarks } from './alignmentValidator';
import type { AlignmentCheck } from './alignmentValidator';
import { correctPerspective, correctPerspectiveFromMidpoints } from './perspectiveCorrection';
import type { PerspectiveResult } from './perspectiveCorrection';
import { decodeQRFromRegion } from './qrDecoder';
import { detectAllAnswers, detectTestId } from './bubbleDetector';
import { measureGrayCalibration, grayStripInkCeiling } from './grayCalibration';
import { estimateGridAlignment, offsetForQuestion } from './gridAlignment';
import { rescueTestIdOffset } from './testIdAlignment';
import { validateScanResult } from './scanValidator';
import { getSettings } from '../config/scannerSettings';
import { OMR_LAYOUT } from '../config/omrLayout';
import { logger } from '../diagnostics/diagnosticLogger';
import { generateBubbleOverlay, generateMarkerOverlay } from './overlayGenerator';

declare const cv: any;

export interface ScanProgress {
  stage: string;
  percent: number;
}

type QRStatus = ReturnType<typeof decodeQRFromRegion>;
type Hypothesis =
  | { kind: 'corner'; name: string; markers: MarkerDetectionResult }
  | { kind: 'midpoint'; name: string; markers: MidpointRegistration };
interface AcceptedAlignment {
  hypothesis: Hypothesis;
  perspective: PerspectiveResult;
  gray: any;
  canvas: HTMLCanvasElement;
  qr: QRStatus;
  check: AlignmentCheck;
  rotated: boolean;
}

function disposeAlignment(alignment: AcceptedAlignment): void {
  cleanupMats(alignment.gray, alignment.perspective.corrected, alignment.perspective.transform);
}

/**
 * Try a proposed registration; only accept it if the QR occupies its known
 * corner AND the side timing marks align with the 50 expected template rows.
 * The original sheet has a unique QR and 50 timing marks, so a geometrically
 * plausible but incorrect set of squares must not be trusted (Test 4).
 */
function evaluateHypothesis(
  source: HTMLCanvasElement,
  hypothesis: Hypothesis,
  dpi: number
): AcceptedAlignment | null {
  let persp: PerspectiveResult | null = null;
  let gray: any = null;
  let keep = false;
  try {
    persp = hypothesis.kind === 'corner'
      ? correctPerspective(source, hypothesis.markers)
      : correctPerspectiveFromMidpoints(source, hypothesis.markers);
    if (!persp.success || !persp.corrected) return null;
    const canvas = document.createElement('canvas');
    canvas.width = persp.corrected.cols;
    canvas.height = persp.corrected.rows;
    cv.imshow(canvas, persp.corrected);

    let qr = decodeQRFromRegion(
      canvas, OMR_LAYOUT.qr.xMm, OMR_LAYOUT.qr.yMm, OMR_LAYOUT.qr.sizeMm, dpi
    );
    let rotated = false;
    if (!qr.valid) {
      const x = OMR_LAYOUT.page.widthMm - OMR_LAYOUT.qr.xMm - OMR_LAYOUT.qr.sizeMm;
      const y = OMR_LAYOUT.page.heightMm - OMR_LAYOUT.qr.yMm - OMR_LAYOUT.qr.sizeMm;
      const opposite = decodeQRFromRegion(canvas, x, y, OMR_LAYOUT.qr.sizeMm, dpi);
      if (opposite.valid) {
        cv.rotate(persp.corrected, persp.corrected, cv.ROTATE_180);
        cv.imshow(canvas, persp.corrected);
        qr = decodeQRFromRegion(
          canvas, OMR_LAYOUT.qr.xMm, OMR_LAYOUT.qr.yMm, OMR_LAYOUT.qr.sizeMm, dpi
        );
        rotated = true;
      }
    }
    if (!qr.valid) {
      logger.warning('qrDecoding', `${hypothesis.name}: QR missing from both expected corners`);
      return null;
    }

    gray = new cv.Mat();
    cv.cvtColor(persp.corrected, gray, cv.COLOR_RGBA2GRAY);
    const check = verifyTimingMarks(gray, dpi);
    logger.info('perspective', `${hypothesis.name}: timing marks ${check.matched}/50`,
      { left: check.leftMatched, right: check.rightMatched, rotated });
    if (!check.passed) {
      logger.warning('perspective', `${hypothesis.name}: rejected, insufficient independent timing-mark alignment`);
      return null;
    }
    keep = true;
    return { hypothesis, perspective: persp, gray, canvas, qr, check, rotated };
  } catch (error) {
    logger.warning('perspective', `${hypothesis.name}: registration attempt failed`,
      { reason: String(error) });
    return null;
  } finally {
    if (!keep) cleanupMats(gray, persp?.corrected, persp?.transform);
  }
}

export async function runFullScan(
  file: File,
  onProgress?: (p: ScanProgress) => void
): Promise<{ result: ScanResult; images: IntermediateImages }> {
  const start = Date.now();
  const images: IntermediateImages = {};
  logger.clear();
  logger.info('loading', 'Starting scan pipeline', { fileSize: file.size });
  onProgress?.({ stage: 'Loading image…', percent: 5 });
  if (!checkOpenCV()) throw new Error('OpenCV.js is not loaded. Please wait for OpenCV to initialize.');

  const loaded = await loadImageFromFile(file);
  images.original = loaded.dataUrl;
  const validation = validateImage(loaded);
  if (!validation.valid) throw new Error(validation.errors.join('\n'));
  logger.info('loading', `Image loaded: ${loaded.width}×${loaded.height}px`, { validation });
  onProgress?.({ stage: 'Preparing grayscale and threshold images…', percent: 15 });

  const preprocessed = preprocessImage(loaded.canvas);
  let selected: AcceptedAlignment | null = null;
  try {
    images.grayscale = preprocessed.grayDataUrl;
    images.thresholded = preprocessed.thresholdedDataUrl;
    onProgress?.({ stage: 'Finding reference markers (corner and edge midpoint)…', percent: 30 });

    const hypotheses: Hypothesis[] = [];
    const primary = detectMarkers(preprocessed.thresholded, loaded.width, loaded.height);
    if (primary.found) hypotheses.push({ kind: 'corner', name: 'corner/adaptive', markers: primary });

    // Always evaluate an independent midpoint hypothesis: a false-positive
    // corner quadrilateral can be geometrically plausible (Test 4 v1.6).
    const mid = detectMidpointMarkers(preprocessed.thresholded, loaded.width, loaded.height);
    if (mid.found) hypotheses.push({ kind: 'midpoint', name: 'midpoint/adaptive', markers: mid });

    const alternate = new cv.Mat();
    try {
      cv.threshold(preprocessed.gray, alternate, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
      const cornerOtsu = detectMarkers(alternate, loaded.width, loaded.height);
      const midOtsu = detectMidpointMarkers(alternate, loaded.width, loaded.height);
      if (cornerOtsu.found) hypotheses.push({ kind: 'corner', name: 'corner/Otsu', markers: cornerOtsu });
      if (midOtsu.found) hypotheses.push({ kind: 'midpoint', name: 'midpoint/Otsu', markers: midOtsu });
    } finally {
      cleanupMats(alternate);
    }

    logger.info('markerDetection', `${hypotheses.length} reference hypotheses available`,
      { cornerCandidates: hypotheses.filter(h => h.kind === 'corner').length,
        midpointCandidates: hypotheses.filter(h => h.kind === 'midpoint').length });
    images.markerOverlay = generateMarkerOverlay(loaded.canvas, primary);
    onProgress?.({ stage: 'Verifying candidate registrations with QR and timing marks…', percent: 48 });
    const dpi = getSettings().scanDpi;
    for (const hypothesis of hypotheses) {
      logger.info('markerDetection', `${hypothesis.name}: candidate coordinates`,
        hypothesis.kind === 'corner'
          ? { topLeft:hypothesis.markers.topLeft, topRight:hypothesis.markers.topRight, bottomLeft:hypothesis.markers.bottomLeft,
              bottomRight:hypothesis.markers.bottomRight, validGeometry:hypothesis.markers.validGeometry }
          : { top:hypothesis.markers.top, right:hypothesis.markers.right, bottom:hypothesis.markers.bottom, left:hypothesis.markers.left });
      // Clean photos should not pay for two extra full-resolution warps.
      // We still compare the independent adaptive midpoint candidate before
      // skipping Otsu alternatives, and retry Otsu for marginal alignments.
      if (selected && selected.check.matched >= 40 && hypothesis.name.endsWith('/Otsu')) break;
      const evaluated = evaluateHypothesis(loaded.canvas, hypothesis, dpi);
      if (!evaluated) continue;
      // Prefer the hypothesis that aligns the most timing marks; tie-break in
      // favour of actual corner squares (less extrapolation than midpoints).
      const newScore = evaluated.check.matched +
        (evaluated.hypothesis.kind === 'corner' ? 0.25 : 0);
      const oldScore = selected
        ? selected.check.matched + (selected.hypothesis.kind === 'corner' ? .25 : 0)
        : -1;
      if (newScore > oldScore) {
        if (selected) disposeAlignment(selected);
        selected = evaluated;
      } else {
        disposeAlignment(evaluated);
      }
    }

    let answers: QuestionResult[] = [];
    let testId: number | null = null;
    let studentId: string | null = null;
    let qrRaw: string | null = null;
    let qrValid = false;
    let markerCount = primary.count;
    let corrected = false;
    let alignmentVerified = false;
    let alignmentMatched = 0;
    let registrationMethod: string | null = null;
    let rotated = false;
    let grayCalibration: ReturnType<typeof measureGrayCalibration> | undefined;

    if (selected) {
      const chosen = selected;
      corrected = true;
      qrValid = true;
      studentId = chosen.qr.studentId;
      qrRaw = chosen.qr.raw;
      alignmentVerified = true;
      alignmentMatched = chosen.check.matched;
      registrationMethod = chosen.hypothesis.name;
      rotated = chosen.rotated;
      markerCount = 4;
      logger.info('perspective', `Selected ${registrationMethod} registration`,
        { timingMarks: alignmentMatched, rotated });
      images.perspectiveCorrected = chosen.canvas.toDataURL('image/png');
      images.markerOverlay = chosen.hypothesis.kind === 'corner'
        ? generateMarkerOverlay(loaded.canvas, chosen.hypothesis.markers)
        : generateMidpointOverlay(loaded.canvas, chosen.hypothesis.markers);

      grayCalibration = measureGrayCalibration(chosen.gray, dpi);
      const inkCeiling = grayStripInkCeiling(grayCalibration);
      logger.info('bubbleDetection', 'Grayscale reference strip calibration', {
        status:grayCalibration.status,
        patchMedians:grayCalibration.patchMedians,
        contrast:grayCalibration.contrast,
        activeInkCeiling:inkCeiling,
        note:grayCalibration.note
      });
      onProgress?.({ stage: 'Refining printed bubble-grid alignment…', percent: 67 });
      const gridStart=Date.now();
      const grid = estimateGridAlignment(chosen.gray,dpi);
      logger.info('perspective','Independent printed-ring grid offsets',
        {grid, durationMs:Date.now()-gridStart});
      onProgress?.({ stage: 'Reading Test ID and answer bubbles…', percent: 72 });
      let idOffset: {dx:number;dy:number} = grid.testId;
      let detectedId = detectTestId(chosen.gray, dpi, inkCeiling ?? undefined, idOffset);
      if(detectedId.testId===null){
        // A global warp may miss the top ID grid even if answer rings align.
        // Only retry at a location with TWO isolated high-density digit cores.
        const rescue=rescueTestIdOffset(chosen.gray,dpi,Math.min(150,inkCeiling??150));
        if(rescue){
          const retry=detectTestId(chosen.gray,dpi,inkCeiling??undefined,rescue);
          if(retry.testId===rescue.tens*10+rescue.units){
            detectedId=retry;
            idOffset=rescue;
            logger.info('testIdDetection','ID rescued with independent two-row evidence',
              {offset:{dx:rescue.dx,dy:rescue.dy},strength:rescue.strength});
          } else logger.warning('testIdDetection','Candidate ID offset failed full validation',
            {offset:{dx:rescue.dx,dy:rescue.dy},strength:rescue.strength});
        }
      }
      testId = detectedId.testId;
      logger.info('testIdDetection', `Test ID: ${testId}`, detectedId);
      answers = detectAllAnswers(chosen.gray, dpi, inkCeiling ?? undefined, q => offsetForQuestion(grid,q));
      logger.info('bubbleDetection',
        `Detected ${answers.filter(a => a.status === 'detected').length}/50 answers`);
      images.bubbleOverlay = generateBubbleOverlay(
        chosen.canvas, answers, { tens: detectedId.tens, units: detectedId.units }, dpi, idOffset
      );
    } else {
      logger.error('perspective',
        'No trustworthy registration: corner/edge-midpoint attempts failed QR or timing-mark validation.');
    }

    const partial: ScanResult = {
      studentId, testId, answers, qrRaw, qrValid, markerCount,
      perspectiveCorrected: corrected, alignmentVerified, alignmentMatched,
      registrationMethod, orientationRotated: rotated,
      processingTimeMs: Date.now() - start,
      grayCalibration,
      stageLogs: [],
      warnings: [],
      errors: selected ? [] : [
        'No registration hypothesis verified the QR position and side timing marks. Try a clearer photo of the complete sheet.'
      ],
      overallStatus: 'failed',
    };
    const { warnings, errors } = validateScanResult(partial);
    partial.warnings = warnings;
    partial.errors = errors;
    partial.overallStatus = errors.length ? 'failed' : warnings.length ? 'partial' : 'success';
    logger.info('complete', `Scan complete in ${partial.processingTimeMs}ms`,
      { status: partial.overallStatus, testId, registrationMethod, alignmentMatched,
        detected: answers.filter(a => a.status === 'detected').length });
    partial.stageLogs = logger.getAll();
    onProgress?.({ stage: 'Complete', percent: 100 });
    return { result: partial, images };
  } finally {
    if (selected) disposeAlignment(selected);
    cleanupMats(preprocessed.gray, preprocessed.blurred, preprocessed.thresholded);
  }
}
