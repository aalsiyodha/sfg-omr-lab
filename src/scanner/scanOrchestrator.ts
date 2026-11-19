import type { ScanResult, IntermediateImages, QuestionResult } from '../types';
import { loadImageFromFile, validateImage } from './imageLoader';
import { preprocessImage, checkOpenCV, cleanupMats } from './imagePreprocessor';
import { detectMarkers } from './markerDetector';
import { verifyTimingMarks } from './alignmentValidator';
import { correctPerspective } from './perspectiveCorrection';
import { decodeQRFromRegion } from './qrDecoder';
import { detectAllAnswers, detectTestId } from './bubbleDetector';
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

export async function runFullScan(
  file: File,
  onProgress?: (p: ScanProgress) => void
): Promise<{ result: ScanResult; images: IntermediateImages }> {
  const start = Date.now();
  const images: IntermediateImages = {};
  
  logger.clear();
  logger.info('loading', 'Starting scan pipeline', { fileName: file.name, fileSize: file.size });
  onProgress?.({ stage: 'Loading image…', percent: 5 });
  
  if (!checkOpenCV()) {
    logger.error('loading', 'OpenCV not available');
    throw new Error('OpenCV.js is not loaded. Please wait for OpenCV to initialize.');
  }
  
  // Stage 1: Load
  const loaded = await loadImageFromFile(file);
  images.original = loaded.dataUrl;
  const validation = validateImage(loaded);
  if (!validation.valid) throw new Error(validation.errors.join('\n'));
  logger.info('loading', `Image loaded: ${loaded.width}×${loaded.height}px`, { validation });
  onProgress?.({ stage: 'Pass 1: Preprocessing & normalizing canvas…', percent: 15 });
  await new Promise(r => setTimeout(r, 250));
  
  // Stage 2: Preprocess
  const preprocessed = preprocessImage(loaded.canvas);
  let correctedGray: any = null;
  let perspectiveResources: { corrected: any; transform: any } | null = null;
  try {
  images.grayscale = preprocessed.grayDataUrl;
  images.thresholded = preprocessed.thresholdedDataUrl;
  logger.info('preprocessing', 'Image preprocessed');
  onProgress?.({ stage: 'Pass 1: Anchoring 4 corner registration markers…', percent: 30 });
  
  // Stage 3: Marker detection
  let markerResult = detectMarkers(preprocessed.thresholded, loaded.width, loaded.height);
  // A global Otsu retry often recovers degraded corner squares missed by
  // adaptive thresholding. Never accept it without geometry + QR verification.
  if (!markerResult.found) {
    const alternate = new cv.Mat();
    try {
      cv.threshold(preprocessed.gray, alternate, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
      const recovered = detectMarkers(alternate, loaded.width, loaded.height);
      if (recovered.found) {
        markerResult = recovered;
        logger.info('markerDetection', 'Recovered registration markers using an alternate Otsu threshold');
      } else {
        logger.warning('markerDetection', 'Adaptive and Otsu marker searches failed geometry checks');
      }
    } finally {
      cleanupMats(alternate);
    }
  }
  images.markerOverlay = generateMarkerOverlay(loaded.canvas, markerResult);
  logger.info('markerDetection', `Markers found: ${markerResult.count}/4`, { markerResult });
  onProgress?.({ stage: 'Pass 1: Correcting perspective & extracting QR…', percent: 45 });
  
  // Stage 4: Perspective correction
  const perspResult = correctPerspective(loaded.canvas, markerResult);
  perspectiveResources = perspResult;
  if (!perspResult.success) {
    logger.warning('perspective', perspResult.error || 'Perspective correction failed');
  } else {
    images.perspectiveCorrected = perspResult.correctedDataUrl;
    logger.info('perspective', 'Perspective correction applied');
  }
  
  // Stage 5: QR decode & Orientation Verification
  const dpi = getSettings().scanDpi;
  let qrResult = { found: false, raw: null as string | null, valid: false, studentId: null as string | null };
  const corrCanvas = document.createElement('canvas');

  if (perspResult.success && perspResult.corrected) {
    corrCanvas.width = perspResult.corrected.cols;
    corrCanvas.height = perspResult.corrected.rows;
    cv.imshow(corrCanvas, perspResult.corrected);

    // Strict region checks: a QR found elsewhere must never count as upright.
    qrResult = decodeQRFromRegion(
      corrCanvas, OMR_LAYOUT.qr.xMm, OMR_LAYOUT.qr.yMm, OMR_LAYOUT.qr.sizeMm, dpi
    );
    if (!qrResult.valid) {
      const oppX = OMR_LAYOUT.page.widthMm - OMR_LAYOUT.qr.xMm - OMR_LAYOUT.qr.sizeMm;
      const oppY = OMR_LAYOUT.page.heightMm - OMR_LAYOUT.qr.yMm - OMR_LAYOUT.qr.sizeMm;
      const invertedQR = decodeQRFromRegion(corrCanvas, oppX, oppY, OMR_LAYOUT.qr.sizeMm, dpi);
      if (invertedQR.valid) {
        logger.info('perspective', 'QR found in opposite corner: rotating sheet by 180°');
        cv.rotate(perspResult.corrected, perspResult.corrected, cv.ROTATE_180);
        cv.imshow(corrCanvas, perspResult.corrected);
        images.perspectiveCorrected = corrCanvas.toDataURL('image/png');
        // Verify again AFTER rotation rather than trusting the old region.
        qrResult = decodeQRFromRegion(
          corrCanvas, OMR_LAYOUT.qr.xMm, OMR_LAYOUT.qr.yMm, OMR_LAYOUT.qr.sizeMm, dpi
        );
      } else {
        logger.error('qrDecoding', 'Cannot establish page orientation: QR absent from both expected corners');
      }
    }
  } else {
    logger.error('perspective', 'Cannot establish orientation without trusted marker geometry');
  }
  logger.info('qrDecoding', `QR: found=${qrResult.found} valid=${qrResult.valid}`, { raw: qrResult.raw });
  onProgress?.({ stage: 'Pass 1: Detecting Test ID & primary answer grid…', percent: 60 });
  
  // Stage 6: Test ID
  let testIdResult = { tens: null as number|null, units: null as number|null, testId: null as number|null };
  
  if (perspResult.success && perspResult.corrected) {
    correctedGray = new cv.Mat();
    cv.cvtColor(perspResult.corrected, correctedGray, cv.COLOR_RGBA2GRAY);
    testIdResult = detectTestId(correctedGray, dpi);
    logger.info('testIdDetection', `Test ID: ${testIdResult.testId}`, testIdResult);
  }
  
  // Independent geometric verification: the side timing marks must be near
  // their configured rows on the corrected upright sheet.
  const alignmentCheck = correctedGray && qrResult.valid
    ? verifyTimingMarks(correctedGray, dpi)
    : null;
  if (alignmentCheck) {
    logger.info('perspective', 'Timing-mark geometry check', { ...alignmentCheck });
  }

  // Stage 7: Primary Answer detection
  let answers: QuestionResult[] = [];
  if (correctedGray && qrResult.valid && alignmentCheck?.passed) {
    answers = detectAllAnswers(correctedGray, dpi);
    logger.info('bubbleDetection', `Pass 1: Detected ${answers.filter(a => a.status === 'detected').length}/50 answers`);
  }
  
  // Visual audit overlay. Do not pretend identical second-pass scans independently verify results.
  onProgress?.({ stage: 'Generating scan alignment and answer overlay…', percent: 85 });
  if (correctedGray) {
    // Generate visual bubble detection overlay
    images.bubbleOverlay = generateBubbleOverlay(
      corrCanvas,
      answers,
      { tens: testIdResult.tens, units: testIdResult.units },
      dpi
    );
  }
  
  onProgress?.({ stage: 'Validating orientation, geometry and classification…', percent: 94 });
  
  // Build result
  const partialResult: ScanResult = {
    studentId: qrResult.studentId,
    testId: testIdResult.testId,
    answers,
    qrRaw: qrResult.raw,
    qrValid: qrResult.valid,
    markerCount: markerResult.count,
    perspectiveCorrected: perspResult.success,
    alignmentVerified: alignmentCheck?.passed ?? false,
    processingTimeMs: Date.now() - start,
    stageLogs: logger.getAll(),
    warnings: [],
    errors: [
      ...(!markerResult.found ? [markerResult.error || 'Registration geometry is not reliable.'] : []),
      ...(!qrResult.valid && markerResult.found ? ['Could not verify page orientation from the QR location.'] : []),
      ...(alignmentCheck && !alignmentCheck.passed ? [alignmentCheck.reason || 'Side timing mark alignment failed.'] : []),
    ],
    overallStatus: 'success',
  };
  
  const { warnings, errors } = validateScanResult(partialResult);
  partialResult.warnings = warnings;
  partialResult.errors = errors;
  partialResult.overallStatus = errors.length > 0 ? 'failed' : warnings.length > 0 ? 'partial' : 'success';
  

  logger.info('complete', `Scan complete in ${partialResult.processingTimeMs}ms`, {
    status: partialResult.overallStatus,
    testId: partialResult.testId,
    answersDetected: answers.filter(a => a.status === 'detected').length,
  });
  
  onProgress?.({ stage: 'Complete', percent: 100 });
  return { result: partialResult, images };
  } finally {
    cleanupMats(preprocessed.gray, preprocessed.blurred, preprocessed.thresholded);
    cleanupMats(correctedGray);
    if (perspectiveResources) cleanupMats(perspectiveResources.corrected, perspectiveResources.transform);
  }
}
