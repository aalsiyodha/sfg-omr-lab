import type { ScanResult, IntermediateImages, QuestionResult, MarkerDetectionResult } from '../types';
import { loadImageFromFile, validateImage } from './imageLoader';
import { preprocessImage, checkOpenCV, cleanupMats } from './imagePreprocessor';
import { detectMarkers } from './markerDetector';
import { detectMidpointMarkers, generateMidpointOverlay } from './midpointDetector';
import type { MidpointRegistration } from './midpointDetector';
import { verifyTimingMarks } from './alignmentValidator';
import { canStopRegistrationSearch } from './litePolicy';
import { recoverPaperBoundary } from './pageBoundaryRecovery';
import { registrationScore, skipRedundantFallback, shouldAdoptTimingRefinement } from './alignmentPolicy';
import { refineByTimingSquares } from './timingRefinement';
import { correctMildPageWarp, countHeldOutTimingMarks } from './mildCurveCorrection';
import type { AlignmentCheck } from './alignmentValidator';
import { correctPerspective, correctPerspectiveFromMidpoints, correctPerspectiveFromArucos } from './perspectiveCorrection';
import { detectArucoMarkers, predictMidpointsFromArucos, generateArucoOverlay } from './arucoDetector';
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
  dpi: number,
  curveBudget: { remaining: number }
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
    let check = verifyTimingMarks(gray, dpi);
    logger.info('perspective', `${hypothesis.name}: timing marks ${check.matched}/50`,
      { left: check.leftMatched, right: check.rightMatched, rotated });
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
            }else cleanupMats(rescued.corrected);
          }else{
            logger.warning('qrDecoding',`${hypothesis.name}: timing refinement failed QR recheck`);
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
    // Only one lightweight curvature trial per scan. An already verified
    // clean sheet never pays for this fallback. No change to acceptance rules.
    if (!check.passed && check.matched >= 12 &&
        check.leftMatched >= 5 && check.rightMatched >= 5 &&
        curveBudget.remaining > 0) {
      curveBudget.remaining--;
      logger.info('perspective',`${hypothesis.name}: Lite gentle-curve trial`,{
        timingBefore:check.matched, left:check.leftMatched, right:check.rightMatched,
        trialsRemaining:curveBudget.remaining});
      const mesh = correctMildPageWarp(persp.corrected, dpi, evidence=>{
        logger.info('perspective',`${hypothesis.name}: OpenCV timing-track recovery evidence`,{
          reason:evidence.reason,candidates:evidence.candidates,
          assigned:evidence.assigned,controls:evidence.controls,
          maxAbsShiftPx:evidence.maxAbsShiftPx,details:evidence.details});
      });
      if (!mesh) {
        logger.info('perspective',`${hypothesis.name}: OpenCV timing-track warp not generated`);
      } else {
        let meshGray:any=null;
        let adopted=false;
        try {
          const candidate=document.createElement('canvas');
          candidate.width=mesh.corrected.cols;
          candidate.height=mesh.corrected.rows;
          cv.imshow(candidate,mesh.corrected);
          const meshQR=decodeQRFromRegion(candidate,OMR_LAYOUT.qr.xMm,
            OMR_LAYOUT.qr.yMm,OMR_LAYOUT.qr.sizeMm,dpi);
          if(meshQR.valid && meshQR.raw===qr.raw){
            meshGray=new cv.Mat();
            cv.cvtColor(mesh.corrected,meshGray,cv.COLOR_RGBA2GRAY);
            const after=verifyTimingMarks(meshGray,dpi);
            const holdout=countHeldOutTimingMarks(meshGray,dpi);
            logger.info('perspective',`${hypothesis.name}: OpenCV timing-track holdout validation`,{
              before:check.matched,after:after.matched,
              left:after.leftMatched,right:after.rightMatched,
              withheldEvenRows:holdout,
              controls:mesh.evidence.sampled,
              maxShiftPx:mesh.evidence.maxAbsShiftPx,
              qrIdentityUnchanged:true});
            if(after.passed && after.matched>check.matched &&
               holdout.left>=8 && holdout.right>=8){
              const correctedUrl=candidate.toDataURL('image/png');
              cv.imshow(canvas,mesh.corrected);
              cleanupMats(gray,persp.corrected);
              persp.corrected=mesh.corrected;
              persp.correctedDataUrl=correctedUrl;
              gray=meshGray;meshGray=null;
              qr=meshQR;check=after;adopted=true;
            }
          }else{
            logger.info('qrDecoding',`${hypothesis.name}: Lite gentle-curve rejected by QR`,{
              found:meshQR.found,valid:meshQR.valid});
          }
        }catch(error){
          logger.warning('perspective','Lite gentle-curve attempt failed',{
            reason:String(error)});
        }finally{
          if(!adopted)cleanupMats(mesh.corrected);
          cleanupMats(meshGray);
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
  const stageTimes: Record<string, number> = {};
  let stageStart = start;
  const finishStage = (name: string) => {
    const now = Date.now();
    stageTimes[name] = now - stageStart;
    stageStart = now;
  };
  const images: IntermediateImages = {};
  logger.clear();
  logger.info('loading', 'Starting scan pipeline', { fileSize: file.size });
  onProgress?.({ stage: 'Loading image…', percent: 5 });
  if (!checkOpenCV()) throw new Error('OpenCV.js is not loaded. Please wait for OpenCV to initialize.');

  const loaded = await loadImageFromFile(file);
  finishStage('imageDecode');
  images.original = loaded.dataUrl;
  const validation = validateImage(loaded);
  if (!validation.valid) throw new Error(validation.errors.join('\n'));
  logger.info('loading', `Image loaded: ${loaded.width}×${loaded.height}px`, { validation });
  onProgress?.({ stage: 'Preparing grayscale and threshold images…', percent: 15 });

  const preprocessed = preprocessImage(loaded.canvas);
  finishStage('preprocessing');
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
    } finally {
      cleanupMats(alternate);
    }

    finishStage('markerDiscovery');
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
    const curveBudget={remaining:1};
    const registrationStarted=Date.now();
    let warpAttempts=0;
    let boundaryAttempted=false;
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
      warpAttempts++;
      const evaluated = evaluateHypothesis(loaded.canvas, hypothesis, dpi, curveBudget);
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
      // A QR-verified 48+/50 with at least 23 on both sides is an early
      // completion signal. Lesser passing registrations keep alternatives.
      if (selected && canStopRegistrationSearch(
        selected.qr.valid, selected.check.matched,
        selected.check.leftMatched, selected.check.rightMatched
      )) {
        logger.info('perspective',
          'Fast-path: stopped after QR and near-perfect dual-side timing',
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
        warpAttempts++;
        const attempt=evaluateHypothesis(loaded.canvas,hypothesis,dpi,curveBudget);
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

    // Last-chance local rescue for strong tilt or missing distorted fiducials.
    // The outer paper is NEVER trusted as registration: it only produces a
    // normalized search canvas. Every resulting ArUco/midpoint/corner warp
    // still goes through evaluateHypothesis, QR identity, and dual-side timing.
    if(!selected){
      boundaryAttempted=true;
      const boundaryStart=Date.now();
      const rough=recoverPaperBoundary(loaded.canvas,evidence=>{
        logger.info('perspective','Outer-page boundary recovery evidence',{
          reason:evidence.reason,candidates:evidence.candidates,
          contourAreaRatio:evidence.contourAreaRatio,
          rejectedBorder:evidence.rejectedBorder,
          rejectedImageCorner:evidence.rejectedImageCorner,
          rejectedGeometry:evidence.rejectedGeometry,
          candidateSummary:evidence.candidateSummary,
          thresholdsTried:evidence.thresholdsTried,
          method:evidence.method,
          quadrilateral:evidence.quadrilateral});
      });
      if(!rough)logger.warning('perspective','Outer-page rescue produced no plausible sheet candidate');
      if(rough){
        let rescueGray:any=null,rescueBlur:any=null,rescueThreshold:any=null;
        try{
          const processed=preprocessImage(rough.canvas);
          rescueGray=processed.gray;rescueBlur=processed.blurred;
          rescueThreshold=processed.thresholded;
          const rescueAruco=detectArucoMarkers(rescueGray,rescueThreshold);
          const rescueCorner=detectMarkers(rescueThreshold,rough.canvas.width,rough.canvas.height);
          const rescueMid=detectMidpointMarkers(rescueThreshold,rough.canvas.width,rough.canvas.height);
          const guidedPrediction=predictMidpointsFromArucos(rescueAruco);
          const candidates:Hypothesis[]=[];
          // Stable identity-bearing ArUco first when all IDs are decoded.
          if(rescueAruco.found)candidates.push({kind:'aruco',
            name:'boundary/aruco',markers:rescueAruco});
          if(guidedPrediction){
            const guided=detectMidpointMarkers(rescueThreshold,
              rough.canvas.width,rough.canvas.height,guidedPrediction);
            if(guided.found)candidates.push({kind:'midpoint',
              name:'boundary/guided-midpoint',markers:guided});
          }
          if(rescueMid.found)candidates.push({kind:'midpoint',
            name:'boundary/midpoint',markers:rescueMid});
          if(rescueCorner.found)candidates.push({kind:'corner',
            name:'boundary/corner',markers:rescueCorner});
          logger.info('perspective','Outer-page fiducial redetection',{
            arucoIds:rescueAruco.count,cornerCount:rescueCorner.count,
            midpointComplete:rescueMid.found,candidates:candidates.map(c=>c.name)});
          for(const hypothesis of candidates){
            warpAttempts++;
            const candidate=evaluateHypothesis(rough.canvas,hypothesis,dpi,curveBudget);
            if(!candidate)continue;
            const score=registrationScore({
              kind:candidate.hypothesis.kind,timingMatched:candidate.check.matched,
              leftMatched:candidate.check.leftMatched,rightMatched:candidate.check.rightMatched,
              qrVerified:candidate.qr.valid});
            const previous=selected?registrationScore({
              kind:selected.hypothesis.kind,timingMatched:selected.check.matched,
              leftMatched:selected.check.leftMatched,rightMatched:selected.check.rightMatched,
              qrVerified:selected.qr.valid}):-Infinity;
            if(score>previous){
              if(selected)disposeAlignment(selected);
              selected=candidate;
              images.markerOverlay=generateArucoOverlay(rough.canvas,rescueAruco,
                hypothesis.name,candidate.check.matched);
            }else disposeAlignment(candidate);
            if(selected&&canStopRegistrationSearch(selected.qr.valid,
              selected.check.matched,selected.check.leftMatched,
              selected.check.rightMatched))break;
          }
        }catch(error){
          logger.warning('perspective','Outer-page recovery aborted',{reason:String(error)});
        }finally{cleanupMats(rescueGray,rescueBlur,rescueThreshold);}
      }
      if(!selected)logger.warning('perspective','Recovery conclusion: no QR-and-timing-verified registration',{
        normalHypotheses:hypotheses.map(h=>h.name),
        attemptedWarps:warpAttempts,
        nextStep:'Check that all four page corners and the printed QR are visible; photograph the full sheet with even lighting.'
      });
      logger.info('perspective','Outer-page rescue timing',{
        durationMs:Date.now()-boundaryStart,verified:Boolean(selected)});
    }
    finishStage('registration');
    logger.info('perspective','Registration performance summary',{
      durationMs:Date.now()-registrationStarted,warpAttempts,
      boundaryAttempted,curveAttempts:1-curveBudget.remaining,
      selected:selected?.hypothesis.name??null,
      timing:selected?.check.matched??0});

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
      finishStage('calibrationAndOverlay');
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
      finishStage('gridAlignment');
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
      finishStage('testIdDetection');
      testId = detectedId.testId;
      logger.info('testIdDetection', `Test ID: ${testId}`, detectedId);
      // Compare original and seven-tone readings under exactly the same
      // verified registration, grid offsets and ink ceiling. This separates
      // geometry from tone-mapping changes and protects against Q18-like
      // disappearing filled marks without promoting Q42-like faint debris.
      const rawInkThreshold=computeAdaptiveDarkThreshold(chosen.gray);
      const rawAnswers=detectAllAnswers(chosen.gray,dpi,inkCeiling??undefined,
        q=>offsetForQuestion(grid,q),rawInkThreshold);
      finishStage('rawBubbleDetection');
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
      finishStage('toneCorrectionAndConsensus');
      logger.info('bubbleDetection',
        `Detected ${answers.filter(a => a.status === 'detected').length}/50 answers`);
      images.bubbleOverlay = generateBubbleOverlay(
        chosen.canvas, answers, { tens: detectedId.tens, units: detectedId.units }, dpi, idOffset
      );
      finishStage('bubbleOverlay');
    } else {
      logger.error('perspective',
        'No trustworthy registration: corner, midpoint and ArUco attempts failed independent QR/timing validation.');
    }

    finishStage('resultPreparation');
    logger.info('complete', 'Scan stage timings (milliseconds)', {
      stages: stageTimes,
      measuredMs: Object.values(stageTimes).reduce((sum, ms) => sum + ms, 0),
      elapsedMs: Date.now() - start,
      note: 'Timings are sequential wall-clock stages; OpenCV startup before scanning is not included.'
    });
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
