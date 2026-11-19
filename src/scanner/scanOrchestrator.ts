import type { ScanResult, IntermediateImages, QuestionResult } from '../types';
import { loadImageFromFile, validateImage } from './imageLoader';
import { preprocessImage, checkOpenCV, cleanupMats } from './imagePreprocessor';
import { detectMarkers } from './markerDetector';
import { correctPerspective } from './perspectiveCorrection';
import { decodeQR, decodeQRFromRegion } from './qrDecoder';
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
  images.grayscale = preprocessed.grayDataUrl;
  images.thresholded = preprocessed.thresholdedDataUrl;
  logger.info('preprocessing', 'Image preprocessed');
  onProgress?.({ stage: 'Pass 1: Anchoring 4 corner registration markers…', percent: 30 });
  
  // Stage 3: Marker detection
  const markerResult = detectMarkers(preprocessed.thresholded, loaded.width, loaded.height);
  images.markerOverlay = generateMarkerOverlay(loaded.canvas, markerResult);
  logger.info('markerDetection', `Markers found: ${markerResult.count}/4`, { markerResult });
  onProgress?.({ stage: 'Pass 1: Correcting perspective & extracting QR…', percent: 45 });
  
  // Stage 4: Perspective correction
  const perspResult = correctPerspective(loaded.canvas, markerResult);
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

    // Try decoding from standard top-right QR region
    qrResult = decodeQRFromRegion(
      corrCanvas,
      OMR_LAYOUT.qr.xMm,
      OMR_LAYOUT.qr.yMm,
      OMR_LAYOUT.qr.sizeMm,
      dpi
    );

    // If not found at top-right, check if image is upside down (180°)
    if (!qrResult.found) {
      const oppX = OMR_LAYOUT.page.widthMm - OMR_LAYOUT.qr.xMm - OMR_LAYOUT.qr.sizeMm;
      const oppY = OMR_LAYOUT.page.heightMm - OMR_LAYOUT.qr.yMm - OMR_LAYOUT.qr.sizeMm;
      const invertedQR = decodeQRFromRegion(corrCanvas, oppX, oppY, OMR_LAYOUT.qr.sizeMm, dpi);

      if (invertedQR.found) {
        // Image was scanned upside down! Rotate 180 degrees
        logger.info('perspective', 'Detected upside-down sheet via QR. Rotating 180°...');
        cv.rotate(perspResult.corrected, perspResult.corrected, cv.ROTATE_180);
        cv.imshow(corrCanvas, perspResult.corrected);
        images.perspectiveCorrected = corrCanvas.toDataURL('image/png');
        qrResult = invertedQR;
      } else {
        // Fallback: full canvas scan
        qrResult = decodeQR(corrCanvas);
      }
    }
  } else {
    qrResult = decodeQR(loaded.canvas);
  }
  logger.info('qrDecoding', `QR: found=${qrResult.found} valid=${qrResult.valid}`, { raw: qrResult.raw });
  onProgress?.({ stage: 'Pass 1: Detecting Test ID & primary answer grid…', percent: 60 });
  
  // Stage 6: Test ID
  let testIdResult = { tens: null as number|null, units: null as number|null, testId: null as number|null };
  let correctedGray: any = null;
  
  if (perspResult.success && perspResult.corrected) {
    correctedGray = new cv.Mat();
    cv.cvtColor(perspResult.corrected, correctedGray, cv.COLOR_RGBA2GRAY);
    testIdResult = detectTestId(correctedGray, dpi);
    logger.info('testIdDetection', `Test ID: ${testIdResult.testId}`, testIdResult);
  }
  
  // Stage 7: Pass 1 Primary Answer detection
  let answers: QuestionResult[] = [];
  if (correctedGray) {
    answers = detectAllAnswers(correctedGray, dpi);
    logger.info('bubbleDetection', `Pass 1: Detected ${answers.filter(a => a.status === 'detected').length}/50 answers`);
  }
  
  // Pass 2: Double-Check Verification Pass
  onProgress?.({ stage: 'Pass 2: Double-checking symmetry & partial mark rejection…', percent: 80 });
  await new Promise(r => setTimeout(r, 450));
  
  if (correctedGray) {
    // Re-verify answers in Pass 2
    const pass2Answers = detectAllAnswers(correctedGray, dpi);
    answers = pass2Answers;

    // Generate visual bubble detection overlay
    images.bubbleOverlay = generateBubbleOverlay(
      corrCanvas,
      answers,
      { tens: testIdResult.tens, units: testIdResult.units },
      dpi
    );
  }
  
  onProgress?.({ stage: 'Pass 2: Auditing baseline integrity & confidence metrics…', percent: 94 });
  await new Promise(r => setTimeout(r, 350));
  
  // Build result
  const partialResult: ScanResult = {
    studentId: qrResult.studentId,
    testId: testIdResult.testId,
    answers,
    qrRaw: qrResult.raw,
    qrValid: qrResult.valid,
    markerCount: markerResult.count,
    perspectiveCorrected: perspResult.success,
    processingTimeMs: Date.now() - start,
    stageLogs: logger.getAll(),
    warnings: [],
    errors: [],
    overallStatus: 'success',
  };
  
  const { warnings, errors } = validateScanResult(partialResult);
  partialResult.warnings = warnings;
  partialResult.errors = errors;
  partialResult.overallStatus = errors.length > 3 ? 'failed' : warnings.length > 0 ? 'partial' : 'success';
  
  // Cleanup OpenCV Mats
  cleanupMats(preprocessed.gray, preprocessed.blurred, preprocessed.thresholded);
  if (correctedGray) cleanupMats(correctedGray);
  if (perspResult.corrected) cleanupMats(perspResult.corrected);
  if (perspResult.transform) cleanupMats(perspResult.transform);
  
  logger.info('complete', `Scan complete in ${partialResult.processingTimeMs}ms`, {
    status: partialResult.overallStatus,
    testId: partialResult.testId,
    answersDetected: answers.filter(a => a.status === 'detected').length,
  });
  
  onProgress?.({ stage: 'Complete', percent: 100 });
  return { result: partialResult, images };
}
