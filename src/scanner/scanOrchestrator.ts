import type { ScanResult, IntermediateImages, QuestionResult, MarkerDetectionResult } from '../types';
import { loadImageFromFile, validateImage } from './imageLoader';
import { preprocessImage, checkOpenCV, cleanupMats } from './imagePreprocessor';
import { detectMarkers } from './markerDetector';
import { detectMidpointMarkers, generateMidpointOverlay } from './midpointDetector';
import type { MidpointRegistration } from './midpointDetector';
import { verifyTimingMarks } from './alignmentValidator';
import type { AlignmentCheck } from './alignmentValidator';
import { correctPerspective, correctPerspectiveFromMidpoints, correctPerspectiveFromArucos } from './perspectiveCorrection';
import { detectArucoMarkers, predictMidpointsFromArucos } from './arucoDetector';
import type { ArucoRegistration } from './arucoDetector';
import { applySevenToneCorrection } from './grayToneCorrection';
import { reconcileToneAnswers } from './toneConsensus';
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
  | { kind: 'midpoint'; name: string; markers: MidpointRegistration }
  | { kind: 'aruco'; name: string; markers: ArucoRegistration };
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
      : hypothesis.kind === 'midpoint'
      ? correctPerspectiveFromMidpoints(source, hypothesis.markers)
      : correctPerspectiveFromArucos(source,hypothesis.markers);
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
    const arucoAdaptive=detectArucoMarkers(preprocessed.gray,preprocessed.thresholded);
    const arucoMidpointPrediction=predictMidpointsFromArucos(arucoAdaptive);
    logger.info('markerDetection','ArUco 4x4 marker identification (adaptive)',{
      identified:arucoAdaptive.count,ids:Object.keys(arucoAdaptive.points),
      readyForRescue:arucoAdaptive.found});
    const primary = detectMarkers(preprocessed.thresholded, loaded.width, loaded.height);
    if (primary.found) hypotheses.push({ kind: 'corner', name: 'corner/adaptive', markers: primary });

    // Always evaluate an independent midpoint hypothesis: a false-positive
    // corner quadrilateral can be geometrically plausible (Test 4 v1.6).
    const mid = detectMidpointMarkers(preprocessed.thresholded, loaded.width, loaded.height);
    if (mid.found) hypotheses.push({ kind: 'midpoint', name: 'midpoint/adaptive', markers: mid });
    if(arucoMidpointPrediction){
      const guided=detectMidpointMarkers(preprocessed.thresholded,loaded.width,loaded.height,arucoMidpointPrediction);
      logger.info('markerDetection','ArUco-guided midpoint square selection',{
        predictions:arucoMidpointPrediction,valid:guided.found,
        selected:guided.found?{top:guided.top,right:guided.right,
          bottom:guided.bottom,left:guided.left}:null,
      });
      if(guided.found) hypotheses.push({kind:'midpoint',name:'midpoint/aruco-guided',markers:guided});
    }

    const alternate = new cv.Mat();
    try {
      cv.threshold(preprocessed.gray, alternate, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
      const cornerOtsu = detectMarkers(alternate, loaded.width, loaded.height);
      const midOtsu = detectMidpointMarkers(alternate, loaded.width, loaded.height);
      if (cornerOtsu.found) hypotheses.push({ kind: 'corner', name: 'corner/Otsu', markers: cornerOtsu });
      if (midOtsu.found) hypotheses.push({ kind: 'midpoint', name: 'midpoint/Otsu', markers: midOtsu });
      if(arucoMidpointPrediction){
        const guidedOtsu=detectMidpointMarkers(alternate,loaded.width,loaded.height,arucoMidpointPrediction);
        if(guidedOtsu.found)hypotheses.push({
          kind:'midpoint',name:'midpoint/aruco-guided-Otsu',markers:guidedOtsu,
        });
      }
      const arucoOtsu=detectArucoMarkers(preprocessed.gray,alternate);
      logger.info('markerDetection','ArUco identification (Otsu)',{
        identified:arucoOtsu.count,ids:Object.keys(arucoOtsu.points),
        readyForRescue:arucoOtsu.found});
      if(arucoAdaptive.found)hypotheses.push({kind:'aruco',name:'aruco/adaptive',markers:arucoAdaptive});
      else if(arucoOtsu.found)hypotheses.push({kind:'aruco',name:'aruco/Otsu',markers:arucoOtsu});
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
          : hypothesis.kind === 'midpoint'
          ? { top:hypothesis.markers.top, right:hypothesis.markers.right, bottom:hypothesis.markers.bottom, left:hypothesis.markers.left }
          : { ids:Object.keys(hypothesis.markers.points),points:hypothesis.markers.points });
      // Clean photos should not pay for two extra full-resolution warps.
      // We still compare the independent adaptive midpoint candidate before
      // skipping Otsu alternatives, and retry Otsu for marginal alignments.
      if (selected && selected.check.matched >= 40 && hypothesis.name.endsWith('/Otsu') && hypothesis.kind !== 'aruco') continue;
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
      if(chosen.hypothesis.kind==='corner')images.markerOverlay=generateMarkerOverlay(loaded.canvas,chosen.hypothesis.markers);
      else if(chosen.hypothesis.kind==='midpoint')images.markerOverlay=generateMidpointOverlay(loaded.canvas,chosen.hypothesis.markers);
      // For ArUco rescue keep the original source overlay; marker IDs are in logs.

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
      // Compare original and seven-tone readings under exactly the same
      // verified registration, grid offsets and ink ceiling. This separates
      // geometry from tone-mapping changes and protects against Q18-like
      // disappearing filled marks without promoting Q42-like faint debris.
      const rawAnswers=detectAllAnswers(chosen.gray,dpi,inkCeiling??undefined,
        q=>offsetForQuestion(grid,q));
      const tone=applySevenToneCorrection(chosen.gray,grayCalibration);
      logger.info('bubbleDetection','Seven-tone image correction',{
        applied:tone.applied,topBottomDelta:tone.topBottomDelta,
        description:tone.description});
      try {
        if(tone.applied){
          const toneAnswers=detectAllAnswers(tone.corrected,dpi,inkCeiling??undefined,
            q=>offsetForQuestion(grid,q));
          const consensus=reconcileToneAnswers(rawAnswers,toneAnswers);
          answers=consensus.answers;
          logger.info('bubbleDetection','Original-vs-seven-tone answer comparison',{
            differingRows:consensus.differences,
            reviewedConflicts:consensus.differences.filter(d=>d.action!=='retain_corrected').length,
          });
        }else{
          answers=rawAnswers;
        }
      } finally {
        cleanupMats(tone.corrected);
      }
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
