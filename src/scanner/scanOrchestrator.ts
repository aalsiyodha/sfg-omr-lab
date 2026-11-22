import type { ScanResult, IntermediateImages, QuestionResult, MarkerDetectionResult } from '../types';
import { loadImageFromFile, validateImage } from './imageLoader';
import { preprocessImage, checkOpenCV, cleanupMats } from './imagePreprocessor';
import { detectMarkers } from './markerDetector';
import { detectMidpointMarkers, generateMidpointOverlay } from './midpointDetector';
import type { MidpointRegistration } from './midpointDetector';
import { verifyTimingMarks } from './alignmentValidator';
import { diagnoseTimingLattice } from './timingDiagnostics';
import { canStopRegistrationSearch } from './registrationFastPath';
import { registrationScore, skipRedundantFallback, shouldAdoptTimingRefinement } from './alignmentPolicy';
import { refineByTimingSquares } from './timingRefinement';
import type { AlignmentCheck } from './alignmentValidator';
import { correctPerspective, correctPerspectiveFromMidpoints, correctPerspectiveFromArucos } from './perspectiveCorrection';
import { detectArucoMarkers, predictMidpointsFromArucos, predictCornersFromArucos, generateArucoOverlay } from './arucoDetector';
import type { ArucoRegistration } from './arucoDetector';
import { applySevenToneCorrection } from './grayToneCorrection';
import { reconcileToneAnswers } from './toneConsensus';
import type { PerspectiveResult } from './perspectiveCorrection';
import { decodeQRFromRegion } from './qrDecoder';
import { detectAllAnswers, detectTestId, computeAdaptiveDarkThreshold } from './bubbleDetector';
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
    if (!persp.success || !persp.corrected) {
      logger.warning('perspective',`${hypothesis.name}: homography unavailable`,
        {reason:persp.error ?? 'Perspective correction failed'});
      return null;
    }
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
      logger.warning('qrDecoding', `${hypothesis.name}: QR could not be verified after warp`,
        {upright:{found:qr.found,valid:qr.valid,error:qr.error},
          rotated180Checked:true,warp:{width:canvas.width,height:canvas.height}});
      return null;
    }

    gray = new cv.Mat();
    cv.cvtColor(persp.corrected, gray, cv.COLOR_RGBA2GRAY);
    let check = verifyTimingMarks(gray, dpi);
    logger.info('perspective', `${hypothesis.name}: timing marks ${check.matched}/50`,
      { left: check.leftMatched, right: check.rightMatched, rotated });
    if (check.matched < 50) {
      try {
        const profile=diagnoseTimingLattice(gray,dpi);
        logger.info('perspective',
          `${hypothesis.name}: independent timing lattice row evidence`,{
            matched:profile.matches,
            matchedRows:{left:profile.left,right:profile.right},
            missingRows:{left:profile.unmatchedLeft,right:profile.unmatchedRight},
            bestSharedTranslationPx:profile.bestShiftPx,
            image:profile.imageSize,
            threshold:profile.threshold,
            note:'Exploratory shift score only; QR and timing must still reverify',
          });
        // Only attempt a bounded global correction when *both* independent
        // timing bands show a substantial improvement. Never use an
        // exploratory timing score as acceptance evidence.
        const shift=profile.bestShiftPx;
        if (!check.passed && shift.matches >= 35 &&
            shift.leftMatched >= 10 && shift.rightMatched >= 10 &&
            shift.matches >= check.matched+8 &&
            (shift.dx!==0 || shift.dy!==0)) {
          let affine:any=null,translated:any=null,shiftGray:any=null;
          try {
            affine=cv.matFromArray(2,3,cv.CV_64F,
              [1,0,-shift.dx,0,1,-shift.dy]);
            translated=new cv.Mat();
            cv.warpAffine(persp.corrected,translated,affine,
              new cv.Size(persp.corrected.cols,persp.corrected.rows));
            const shiftedCanvas=document.createElement('canvas');
            shiftedCanvas.width=translated.cols;shiftedCanvas.height=translated.rows;
            cv.imshow(shiftedCanvas,translated);
            const shiftedQR=decodeQRFromRegion(shiftedCanvas,
              OMR_LAYOUT.qr.xMm,OMR_LAYOUT.qr.yMm,OMR_LAYOUT.qr.sizeMm,dpi);
            if(shiftedQR.valid && shiftedQR.raw===qr.raw){
              shiftGray=new cv.Mat();
              cv.cvtColor(translated,shiftGray,cv.COLOR_RGBA2GRAY);
              const shiftedCheck=verifyTimingMarks(shiftGray,dpi);
              logger.info('perspective',
                `${hypothesis.name}: verified shared-shift fallback`,{
                  dx:shift.dx,dy:shift.dy,
                  before:check.matched,after:shiftedCheck.matched,
                  left:shiftedCheck.leftMatched,right:shiftedCheck.rightMatched,
                  sameQR:true});
              if(shouldAdoptTimingRefinement(check,shiftedCheck)){
                cleanupMats(gray,persp.corrected);
                persp.corrected=translated;translated=null;
                gray=shiftGray;shiftGray=null;
                persp.correctedDataUrl=shiftedCanvas.toDataURL('image/png');
                cv.imshow(canvas,persp.corrected);
                check=shiftedCheck;
              }
            }else logger.info('perspective',
              `${hypothesis.name}: shared-shift fallback rejected by QR`,{
                dx:shift.dx,dy:shift.dy,found:shiftedQR.found,
                valid:shiftedQR.valid});
          }catch(error){
            logger.warning('perspective',
              `${hypothesis.name}: shared-shift fallback unavailable`,
              {reason:String(error)});
          }finally{
            cleanupMats(affine,translated,shiftGray);
          }
        }

      } catch (error) {
        logger.warning('perspective',
          `${hypothesis.name}: timing profile unavailable`,{reason:String(error)});
      }
    }

    // Even a QR-valid ArUco candidate with 45–49 matched timing marks may
    // have measurable warp drift in the distant right column. Recheck with
    // four extreme printed timing squares, but only adopt a strictly better
    // independently verified result. Perfect 50/50 warps stay untouched.
    if (!check.passed || (hypothesis.kind === 'aruco' && check.matched < 50)) {
      // v2.2.2: Any registration method can have a sound QR position but
      // a slightly displaced timing lattice. Try four *independent* printed
      // timing squares as a bounded second correction. Never trust a refined
      // warp until QR identity and both side timing bands independently pass.
      const rescued=refineByTimingSquares(persp.corrected,dpi);
      if(rescued){
        let updatedGray:any=null;
        try{
          const candidate=document.createElement('canvas');
          candidate.width=rescued.corrected.cols;
          candidate.height=rescued.corrected.rows;
          cv.imshow(candidate,rescued.corrected);
          const verifiedQR=decodeQRFromRegion(
            candidate,OMR_LAYOUT.qr.xMm,OMR_LAYOUT.qr.yMm,OMR_LAYOUT.qr.sizeMm,dpi);
          if(verifiedQR.valid && verifiedQR.raw === qr.raw){
            updatedGray=new cv.Mat();
            cv.cvtColor(rescued.corrected,updatedGray,cv.COLOR_RGBA2GRAY);
            const updatedCheck=verifyTimingMarks(updatedGray,dpi);
            logger.info('perspective',`${hypothesis.name}: timing-assisted refinement`,{
              shifts:rescued.shifts,
              before:check.matched,after:updatedCheck.matched,
              left:updatedCheck.leftMatched,right:updatedCheck.rightMatched,
              qrReverified:verifiedQR.valid,
            });
            if(shouldAdoptTimingRefinement(check,updatedCheck)){
              cleanupMats(gray,persp.corrected);
              persp.corrected=rescued.corrected;
              persp.correctedDataUrl=candidate.toDataURL('image/png');
              gray=updatedGray;updatedGray=null;
              cv.imshow(canvas,persp.corrected);
              check=updatedCheck;
              qr=verifiedQR;
              // The original first-stage transform remains owned by persp.
            }else {
              logger.info('perspective',`${hypothesis.name}: timing refinement not adopted`,
                {before:check.matched,after:updatedCheck.matched,
                  left:updatedCheck.leftMatched,right:updatedCheck.rightMatched});
              cleanupMats(rescued.corrected);
            }
          }else{
            logger.warning('qrDecoding',`${hypothesis.name}: timing refinement failed QR recheck`,
              {found:verifiedQR.found,valid:verifiedQR.valid,
                reason:verifiedQR.error ?? 'QR identity changed or moved'});
            cleanupMats(rescued.corrected);
          }
        }catch(error){
          // On failure, keep only the unchanged original warp.
          // If the refinement was adopted, persp owns the new image.
          if(persp.corrected!==rescued.corrected)cleanupMats(rescued.corrected);
          logger.warning('perspective','Timing-assisted correction failed',{reason:String(error)});
        }finally{
          cleanupMats(updatedGray,rescued.transform);
        }
      }
    }
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
    // Independent marker families: corners, side midpoints and uniquely
    // identified ArUco codes. Each alignment is verified after warping.
    const arucoAdaptive=detectArucoMarkers(preprocessed.gray,preprocessed.thresholded);
    const arucoMidpointPrediction=predictMidpointsFromArucos(arucoAdaptive);
    const arucoCornerPrediction=predictCornersFromArucos(arucoAdaptive);
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
      // Independent thresholding can recover a different set of marker
      // centres. Evaluate both, even if adaptive ArUco detection succeeded.
      if(arucoOtsu.found)hypotheses.push({kind:'aruco',name:'aruco/Otsu',markers:arucoOtsu});
      // Additional independent corner candidate after ordinary detection:
      // estimate where actual corner squares should lie using ArUco IDs, then
      // locate nearby contours. The estimate itself is never a registration.
      if(arucoCornerPrediction){
        const guidedCorner=detectMarkers(
          preprocessed.thresholded,loaded.width,loaded.height,arucoCornerPrediction);
        if(guidedCorner.found){
          const prior=primary;
          const changed=!prior.found || (
            Math.hypot(guidedCorner.topLeft!.x-prior.topLeft!.x,
              guidedCorner.topLeft!.y-prior.topLeft!.y)>4 ||
            Math.hypot(guidedCorner.topRight!.x-prior.topRight!.x,
              guidedCorner.topRight!.y-prior.topRight!.y)>4 ||
            Math.hypot(guidedCorner.bottomLeft!.x-prior.bottomLeft!.x,
              guidedCorner.bottomLeft!.y-prior.bottomLeft!.y)>4 ||
            Math.hypot(guidedCorner.bottomRight!.x-prior.bottomRight!.x,
              guidedCorner.bottomRight!.y-prior.bottomRight!.y)>4);
          if(changed)hypotheses.push({
            kind:'corner',name:'corner/aruco-guided',markers:guidedCorner});
          logger.info('markerDetection','ArUco-guided corner contour cross-check',{
            distinct:changed,corners:guidedCorner,estimated:arucoCornerPrediction});
        }else logger.info('markerDetection','ArUco-guided corner contours unavailable',
          {estimated:arucoCornerPrediction});
      }

    } finally {
      cleanupMats(alternate);
    }

    logger.info('markerDetection', `${hypotheses.length} reference hypotheses available`,
      { cornerCandidates: hypotheses.filter(h => h.kind === 'corner').length,
        midpointCandidates: hypotheses.filter(h => h.kind === 'midpoint').length,
        arucoCandidates: hypotheses.filter(h => h.kind === 'aruco').length,
        methodNames: hypotheses.map(h => h.name) });
    images.markerOverlay = arucoAdaptive.found
      ? generateArucoOverlay(loaded.canvas,arucoAdaptive)
      : generateMarkerOverlay(loaded.canvas, primary);
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
      if (skipRedundantFallback(selected?.check.matched ?? null, hypothesis.name, hypothesis.kind)) {
        logger.info('markerDetection', `${hypothesis.name}: skipped redundant expensive fallback after strong verification`);
        continue;
      }
      const evaluated = evaluateHypothesis(loaded.canvas, hypothesis, dpi);
      if (!evaluated) continue;
      // Prefer the hypothesis that aligns the most timing marks; tie-break in
      // favour of actual corner squares (less extrapolation than midpoints).
      const rank = (a: AcceptedAlignment) => registrationScore({
        kind: a.hypothesis.kind, timingMatched: a.check.matched,
        leftMatched: a.check.leftMatched, rightMatched: a.check.rightMatched,
        qrVerified: a.qr.valid,
      });
      const newScore = rank(evaluated);
      const oldScore = selected ? rank(selected) : -1;
      logger.info('perspective', `${hypothesis.name}: alignment candidate verified`, {
        score: newScore, timing: evaluated.check.matched,
        left: evaluated.check.leftMatched, right: evaluated.check.rightMatched,
        qrIdentityVerified: evaluated.qr.valid,
      });
      if (newScore > oldScore) {
        if (selected) disposeAlignment(selected);
        selected = evaluated;
      } else {
        disposeAlignment(evaluated);
      }
      // v2.3: after *independent* QR identity and both timing
      // bands reach a perfect 50/50, no later hypothesis can improve
      // timing coverage. Avoid remaining costly perspective/QR warps.
      // Do NOT stop at 47–49: the reference photos needed fallback.
      if (selected && canStopRegistrationSearch(
        selected.qr.valid, selected.check.matched,
        selected.check.leftMatched, selected.check.rightMatched
      )) {
        logger.info('perspective',
          'v2.3 fast-path: stopped registration after perfect QR + 50/50 timing',
          {selected:selected.hypothesis.name,skipped:Math.max(0,
            hypotheses.length-hypotheses.indexOf(hypothesis)-1)});
        break;
      }
    }

    // Deferred midpoint search: only pay for four alternate candidates
    // when first-choice marker registrations did not reach strong timing
    // agreement. A filled student bubble may out-rank a faded midpoint.
    // Each alternate warp still needs its own QR and timing verification.
    if (!selected || selected.check.matched < 48) {
      for (const side of ['top','bottom','left','right'] as const) {
        const alternateMid=detectMidpointMarkers(
          preprocessed.thresholded,loaded.width,loaded.height,undefined,side);
        if(!alternateMid.found)continue;
        const hypothesis:Hypothesis={
          kind:'midpoint',name:'midpoint/alternate-'+side,markers:alternateMid
        };
        const attempt=evaluateHypothesis(loaded.canvas,hypothesis,dpi);
        if(!attempt)continue;
        const score=registrationScore({kind:'midpoint',
          timingMatched:attempt.check.matched,
          leftMatched:attempt.check.leftMatched,
          rightMatched:attempt.check.rightMatched,
          qrVerified:attempt.qr.valid});
        const prior=selected?registrationScore({
          kind:selected.hypothesis.kind,timingMatched:selected.check.matched,
          leftMatched:selected.check.leftMatched,
          rightMatched:selected.check.rightMatched,qrVerified:selected.qr.valid,
        }): -Infinity;
        if(score>prior){
          if(selected)disposeAlignment(selected);
          selected=attempt;
        }else disposeAlignment(attempt);
        if(selected?.check.matched===50)break;
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
      if(arucoAdaptive.found)images.markerOverlay=generateArucoOverlay(
        loaded.canvas,arucoAdaptive,registrationMethod,alignmentMatched,
        chosen.hypothesis.kind==='midpoint'?chosen.hypothesis.markers:undefined);
      else if(chosen.hypothesis.kind==='corner')
        images.markerOverlay=generateMarkerOverlay(loaded.canvas,chosen.hypothesis.markers);
      else if(chosen.hypothesis.kind==='midpoint')
        images.markerOverlay=generateMidpointOverlay(loaded.canvas,chosen.hypothesis.markers);

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
      const rawInkThreshold=computeAdaptiveDarkThreshold(chosen.gray);
      const rawAnswers=detectAllAnswers(chosen.gray,dpi,inkCeiling??undefined,
        q=>offsetForQuestion(grid,q),rawInkThreshold);
      const tone=applySevenToneCorrection(chosen.gray,grayCalibration);
      logger.info('bubbleDetection','Seven-tone image correction',{
        applied:tone.applied,topBottomDelta:tone.topBottomDelta,
        description:tone.description});
      try {
        if(tone.applied){
          // Both the darkness threshold and the calibrated ink ceiling
          // must be mapped through the identical LUT as the pixel values.
          const correctedInkThreshold=tone.mapInkThreshold(rawInkThreshold);
          const correctedInkCeiling=inkCeiling===null
            ? undefined : tone.mapInkThreshold(inkCeiling);
          logger.info('bubbleDetection','Original/corrected threshold correspondence',{
            rawThreshold:rawInkThreshold,
            correctedThreshold:Number(correctedInkThreshold.toFixed(2)),
            rawInkCeiling:inkCeiling,
            correctedInkCeiling:correctedInkCeiling===undefined
              ? null:Number(correctedInkCeiling.toFixed(2)),
          });
          const toneAnswers=detectAllAnswers(tone.corrected,dpi,correctedInkCeiling,
            q=>offsetForQuestion(grid,q),correctedInkThreshold);
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
        'No trustworthy registration: corner, midpoint and ArUco attempts failed independent QR/timing validation.');
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
        'No registration hypothesis passed QR identity and independent left/right timing checks (corners, midpoint squares, ArUco). Try a sharper full-page image.'
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
