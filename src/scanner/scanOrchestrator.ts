import type { ScanResult, IntermediateImages, QuestionResult, MarkerDetectionResult } from '../types';
import { loadImageFromFile, validateImage } from './imageLoader';
import { preprocessImage, checkOpenCV, cleanupMats } from './imagePreprocessor';
import { detectMarkers } from './markerDetector';
import { detectMidpointMarkers, generateMidpointOverlay } from './midpointDetector';
import type { MidpointRegistration } from './midpointDetector';
import { verifyTimingMarks } from './alignmentValidator';
import { canStopUnifiedRegistration } from './unifiedGeometryPolicy';
import { chooseGeometryAction } from './geometryRouter';
import { auditBubbleDecision, applyDecisionReview } from './decisionProof';
import { inspectLocalBubble } from './localVisualProof';
import { summarizePredictedGrid } from './predictiveGrid';
import { validateLocalMesh } from './validatedMesh';
import { fitMaskedLatentPredictor } from './latentPredictor';
import { predictSyntheticDecision, SYNTHETIC_MODEL_INFO } from './trainedDecisionHead';
import { recoverPaperBoundary } from './pageBoundaryRecovery';
import { recoverPageWithScanic } from './scanicPageRescue';
import { hybridAnchorEvidence, correctPerspectiveFromHybrid } from './hybridRegistration';
import { correctPerspectiveFromQrAruco } from './qrArucoRegistration';
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
import { decodeQRFromRegion, locateQRInPhoto } from './qrDecoder';
import { detectAllAnswers, detectTestId, computeAdaptiveDarkThreshold } from './bubbleDetector';
import { measureGrayCalibration, grayStripInkCeiling, investigateGrayStrip } from './grayCalibration';
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
  | { kind: 'aruco'; name: string; markers: ArucoRegistration }
  | { kind: 'hybrid'; name: string; corners: MarkerDetectionResult; aruco: ArucoRegistration; qrLocated?: ReturnType<typeof locateQRInPhoto> };
interface AcceptedAlignment {
  hypothesis: Hypothesis;
  perspective: PerspectiveResult;
  gray: any;
  canvas: HTMLCanvasElement;
  qr: QRStatus;
  check: AlignmentCheck;
  rotated: boolean;
  provisional?: boolean;
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
  curveBudget: { remaining: number },
  allowQrlessProvisional = false
): AcceptedAlignment | null {
  let persp: PerspectiveResult | null = null;
  let gray: any = null;
  let keep = false;
  try {
    persp = hypothesis.kind === 'corner'
      ? correctPerspective(source, hypothesis.markers)
      : hypothesis.kind === 'midpoint'
      ? correctPerspectiveFromMidpoints(source, hypothesis.markers)
      : hypothesis.kind === 'hybrid'
      ? hypothesis.qrLocated
         ? correctPerspectiveFromQrAruco(source,hypothesis.qrLocated,hypothesis.aruco)
         : correctPerspectiveFromHybrid(source,hypothesis.corners,hypothesis.aruco)
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
    if (!qr.valid && allowQrlessProvisional && !rotated) {
      // Independent fallback for READ-ONLY provisional measurements. Never
      // bypass QR for an automatically verified or gradable examination.
      let candidateGray:any=null;
      try {
        candidateGray=new cv.Mat();
        cv.cvtColor(persp.corrected,candidateGray,cv.COLOR_RGBA2GRAY);
        const timing=verifyTimingMarks(candidateGray,dpi);
        const strip=measureGrayCalibration(candidateGray,dpi);
        const strongTiming=timing.matched>=48 && timing.leftMatched>=23 && timing.rightMatched>=23;
        const stripValid=strip.status==='ok' && strip.ordered &&
          strip.patchMedians.length===7 && (strip.contrast??0)>=90;
        logger.info('perspective',`${hypothesis.name}: QR-less provisional geometry evidence`,{
          timing:timing.matched,left:timing.leftMatched,right:timing.rightMatched,
          requiredTiming:48,requiredPerSide:23,stripStatus:strip.status,
          stripContrast:strip.contrast,stripOrdered:strip.ordered,
          strongTiming,stripValid,accepted:strongTiming&&stripValid
        });
        if(strongTiming&&stripValid){
          gray=candidateGray;candidateGray=null;keep=true;
          logger.warning('perspective',`${hypothesis.name}: PROVISIONAL ONLY — QR not decoded; scoring prohibited`);
          return {hypothesis,perspective:persp,gray,canvas,qr,check:timing,
            rotated:false,provisional:true};
        }
      }finally{cleanupMats(candidateGray);}
    }
    if (!qr.valid) {
      // The grayscale strip is independent location evidence for a hybrid warp,
      // never a replacement for the required QR identity.
      // Record the independent timing-track evidence even when QR identity
      // cannot be decoded. Previous builds discarded this useful geometry
      // information and reported only a misleading 0/50 registration.
      // These measurements NEVER relax the QR identity gate.
      let probe:any=null;
      try{
        probe=new cv.Mat();
        cv.cvtColor(persp.corrected,probe,cv.COLOR_RGBA2GRAY);
        const timing=verifyTimingMarks(probe,dpi);
        logger.info('perspective',hypothesis.name+': QR-failed timing evidence',{
          matched:timing.matched,left:timing.leftMatched,
          right:timing.rightMatched,passed:timing.passed,
          qrVerified:false,scoringAllowed:false
        });
        if(hypothesis.kind==='hybrid'){
          const calibration=measureGrayCalibration(probe,dpi);
          logger.info('perspective',hypothesis.name+': grayscale landmark cross-check',{
            status:calibration.status,patches:calibration.patchMedians,
            contrast:calibration.contrast,ordered:calibration.ordered,
            note:calibration.note
          });
        }
      }catch(error){logger.warning('perspective','QR-failed geometry probe unavailable',{
        method:hypothesis.name,reason:String(error)});}
      finally{cleanupMats(probe);}
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

    const registrationStarted=Date.now();
    const hypotheses: Hypothesis[] = [];
    let fastWarpAttempts=0;
    const primary=detectMarkers(preprocessed.thresholded,loaded.width,loaded.height);
    const dpi=getSettings().scanDpi;
    const curveBudget={remaining:1};
    let arucoAdaptive:ArucoRegistration={found:false,count:0,points:{}};
    let arucoOtsu:ArucoRegistration=arucoAdaptive;
    let cornerOtsuForHybrid:MarkerDetectionResult=primary;
    // A genuinely cheap fast path: full QR identity and dual-side timing
    // verification BEFORE expensive ArUco, Otsu and midpoint discovery.
    if(primary.found){
      const hypothesis:Hypothesis={kind:'corner',name:'corner/adaptive',markers:primary};
      const t=Date.now();
      logger.info('markerDetection','corner/adaptive: candidate coordinates',{
        topLeft:primary.topLeft,topRight:primary.topRight,
        bottomLeft:primary.bottomLeft,bottomRight:primary.bottomRight,
        validGeometry:primary.validGeometry});
      fastWarpAttempts++;
      const candidate=evaluateHypothesis(loaded.canvas,hypothesis,dpi,curveBudget);
      if(candidate)selected=candidate;
      if(candidate&&canStopUnifiedRegistration(candidate.qr.valid,candidate.check.matched,
        candidate.check.leftMatched,candidate.check.rightMatched)){
        logger.info('perspective','Verified corner-first fast path: skipped ArUco/Otsu/midpoint discovery',{
          durationMs:Date.now()-t,timing:candidate.check.matched,
          left:candidate.check.leftMatched,right:candidate.check.rightMatched,qrValid:candidate.qr.valid});
      }else if(!candidate)hypotheses.push(hypothesis);
    }
    if(!selected||!canStopUnifiedRegistration(selected.qr.valid,selected.check.matched,
      selected.check.leftMatched,selected.check.rightMatched)){
    // Recovery-only independent marker families.
    arucoAdaptive=detectArucoMarkers(preprocessed.gray,preprocessed.thresholded);
    const arucoMidpointPrediction=predictMidpointsFromArucos(arucoAdaptive);
    logger.info('markerDetection','ArUco 4x4 marker identification (adaptive)',{
      identified:arucoAdaptive.count,ids:Object.keys(arucoAdaptive.points),
      readyForRescue:arucoAdaptive.found});
    // Initial corner already evaluated; do not warp it again.

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
    arucoOtsu=arucoAdaptive;
    cornerOtsuForHybrid=primary;
    try {
      cv.threshold(preprocessed.gray, alternate, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
      const cornerOtsu = detectMarkers(alternate, loaded.width, loaded.height);
      cornerOtsuForHybrid=cornerOtsu;
      const midOtsu = detectMidpointMarkers(alternate, loaded.width, loaded.height);
      if (cornerOtsu.found) hypotheses.push({ kind: 'corner', name: 'corner/Otsu', markers: cornerOtsu });
      if (midOtsu.found) hypotheses.push({ kind: 'midpoint', name: 'midpoint/Otsu', markers: midOtsu });
      if(arucoMidpointPrediction){
        const guidedOtsu=detectMidpointMarkers(alternate,loaded.width,loaded.height,arucoMidpointPrediction);
        if(guidedOtsu.found)hypotheses.push({
          kind:'midpoint',name:'midpoint/aruco-guided-Otsu',markers:guidedOtsu,
        });
      }
      arucoOtsu=detectArucoMarkers(preprocessed.gray,alternate);
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
    let warpAttempts=fastWarpAttempts;
    let boundaryAttempted=false;
    for (const hypothesis of hypotheses) {
      if(selected&&canStopUnifiedRegistration(selected.qr.valid,selected.check.matched,
        selected.check.leftMatched,selected.check.rightMatched))break;
      logger.info('markerDetection', `${hypothesis.name}: candidate coordinates`,
        hypothesis.kind === 'corner'
          ? { topLeft:hypothesis.markers.topLeft, topRight:hypothesis.markers.topRight, bottomLeft:hypothesis.markers.bottomLeft,
              bottomRight:hypothesis.markers.bottomRight, validGeometry:hypothesis.markers.validGeometry }
          : hypothesis.kind === 'midpoint'
          ? { top:hypothesis.markers.top, right:hypothesis.markers.right, bottom:hypothesis.markers.bottom, left:hypothesis.markers.left }
          : hypothesis.kind === 'aruco'
          ? { ids:Object.keys(hypothesis.markers.points),points:hypothesis.markers.points }
          : {hybrid:true,anchors:hypothesis.aruco.points});
      // Clean photos should not pay for two extra full-resolution warps.
      // We still compare the independent adaptive midpoint candidate before
      // skipping Otsu alternatives, and retry Otsu for marginal alignments.
      if (skipRedundantFallback(selected?.check.matched ?? null, hypothesis.name,
        hypothesis.kind==='hybrid'?'corner':hypothesis.kind)) {
        logger.info('markerDetection', `${hypothesis.name}: skipped redundant expensive fallback after strong verification`);
        continue;
      }
      warpAttempts++;
      const evaluated = evaluateHypothesis(loaded.canvas, hypothesis, dpi, curveBudget);
      if (!evaluated) continue;
      // Prefer the hypothesis that aligns the most timing marks; tie-break in
      // favour of actual corner squares (less extrapolation than midpoints).
      const rank = (a: AcceptedAlignment) => registrationScore({
        kind: a.hypothesis.kind==='hybrid'?'corner':a.hypothesis.kind, timingMatched: a.check.matched,
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
      if (selected && canStopUnifiedRegistration(
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
          kind:selected.hypothesis.kind==='hybrid'?'corner':selected.hypothesis.kind,timingMatched:selected.check.matched,
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

    // Failure-only hybrid: two bottom ArUco IDs cross-referenced with independently
    // detected top corner squares. The original QR/timing gates remain mandatory.
    if(!selected){
      const hybridSources=[{name:'adaptive',corners:primary,aruco:arucoAdaptive},
        {name:'Otsu',corners:cornerOtsuForHybrid,aruco:arucoOtsu}];
      for(const source of hybridSources){
        const evidence=hybridAnchorEvidence(source.corners,source.aruco);
        logger.info('perspective','Hybrid cross-family recovery evidence',{
          source:source.name,reason:evidence.reason,usable:evidence.usable,
          cornerTopLeft:source.corners.topLeft,cornerTopRight:source.corners.topRight,
          arucoIds:Object.keys(source.aruco.points),arucoPositions:source.aruco.points,
          imageAnchors:evidence.imagePoints,templateAnchorsMm:evidence.templateMm
        });
        if(!evidence.usable)continue;
        const hypothesis:Hypothesis={kind:'hybrid',name:'hybrid/corner-aruco-'+source.name,
          corners:source.corners,aruco:source.aruco};
        warpAttempts++;
        const evaluated=evaluateHypothesis(loaded.canvas,hypothesis,dpi,curveBudget);
        if(!evaluated)continue;
        selected=evaluated;
        logger.info('perspective','Hybrid cross-family candidate passed QR and timing verification',{
          name:hypothesis.name,timing:evaluated.check.matched,
          left:evaluated.check.leftMatched,right:evaluated.check.rightMatched});
        break;
      }
    }

    // v2.4.612: recover from an incorrectly detected single top square.
    // Both thresholding methods share the independently decoded bottom ArUco
    // IDs but propose different top positions. Test the two cross-combinations
    // individually, without merging observations from different warps. This
    // bounded hypothesis search is failure-only and cannot bypass QR or timing.
    if(!selected && primary.topLeft && primary.topRight &&
        cornerOtsuForHybrid.topLeft && cornerOtsuForHybrid.topRight){
      const mixed=[
        {name:'adaptive-TL/Otsu-TR',topLeft:primary.topLeft,
          topRight:cornerOtsuForHybrid.topRight},
        {name:'Otsu-TL/adaptive-TR',topLeft:cornerOtsuForHybrid.topLeft,
          topRight:primary.topRight}
      ];
      for(const pair of mixed){
        const markers:MarkerDetectionResult={...primary,found:true,count:4,
          topLeft:pair.topLeft,topRight:pair.topRight,validGeometry:true};
        const evidence=hybridAnchorEvidence(markers,arucoAdaptive);
        logger.info('perspective','Cross-threshold corner-repair hypothesis',{
          method:pair.name,usable:evidence.usable,reason:evidence.reason,
          topLeft:pair.topLeft,topRight:pair.topRight,
          bottomArucoIds:Object.keys(arucoAdaptive.points)});
        if(!evidence.usable)continue;
        warpAttempts++;
        const hypothesis:Hypothesis={kind:'hybrid',
          name:'hybrid/corner-repair-'+pair.name,
          corners:markers,aruco:arucoAdaptive};
        const accepted=evaluateHypothesis(loaded.canvas,hypothesis,dpi,curveBudget);
        if(!accepted)continue;
        selected=accepted;
        logger.info('perspective','Cross-threshold corner repair strictly verified',{
          method:hypothesis.name,qr:true,timing:accepted.check.matched,
          left:accepted.check.leftMatched,right:accepted.check.rightMatched});
        break;
      }
    }

    // Geometric QR finder search on the ORIGINAL photo is independent of
    // a failed perspective warp. It is diagnostic evidence, not scan approval.
    if(!selected){
      const qrLocatorStart=Date.now();
      const located=locateQRInPhoto(loaded.canvas);
      logger.info('qrDecoding','Independent original-photo QR locator',{
        found:located.found,valid:located.valid,center:located.center,
        corners:located.corners,raw:located.raw,attempts:located.attempts,
        error:located.error,durationMs:Date.now()-qrLocatorStart
      });
      // New v2.3.46 failure-only cross-family registration. It combines
      // independently located QR corners with two decoded bottom ArUco IDs.
      // evaluateHypothesis still enforces QR identity and both timing tracks.
      if(located.valid){
        for(const source of [{name:'adaptive',aruco:arucoAdaptive},
          {name:'Otsu',aruco:arucoOtsu}]){
          if(!source.aruco.points[2]||!source.aruco.points[3])continue;
          const proposal:Hypothesis={
            kind:'hybrid',name:'hybrid/qr-aruco-'+source.name,
            corners:primary,aruco:source.aruco,qrLocated:located
          };
          warpAttempts++;
          const evaluated=evaluateHypothesis(loaded.canvas,proposal,dpi,curveBudget);
          logger.info('perspective','v2.3.46 QR-ArUco rescue result',{
            method:proposal.name,qrLocated:true,verified:Boolean(evaluated),
            timing:evaluated?.check.matched??0
          });
          if(evaluated){selected=evaluated;break;}
        }
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
              kind:candidate.hypothesis.kind==='hybrid'?'corner':candidate.hypothesis.kind,timingMatched:candidate.check.matched,
              leftMatched:candidate.check.leftMatched,rightMatched:candidate.check.rightMatched,
              qrVerified:candidate.qr.valid});
            const previous=selected?registrationScore({
              kind:selected.hypothesis.kind==='hybrid'?'corner':selected.hypothesis.kind,timingMatched:selected.check.matched,
              leftMatched:selected.check.leftMatched,rightMatched:selected.check.rightMatched,
              qrVerified:selected.qr.valid}):-Infinity;
            if(score>previous){
              if(selected)disposeAlignment(selected);
              selected=candidate;
              images.markerOverlay=generateArucoOverlay(rough.canvas,rescueAruco,
                hypothesis.name,candidate.check.matched);
            }else disposeAlignment(candidate);
            if(selected&&canStopUnifiedRegistration(selected.qr.valid,
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
    // LAST RESORT: load the ~4.5 MB document corner model only after all
    // deterministic registration and page-boundary methods have failed.
    // AI provides candidate geometry, never permission to grade. Every
    // candidate must pass the original QR identity and two timing-track gates.
    if(!selected){
      const aiStart=Date.now();
      let aiAttempted=0;
      let aiStatus='not-started';
      let aiRejections:{method:string;reason:string}[]=[];
      try{
        onProgress?.({stage:'Last resort: detecting page corners with local AI…',percent:52});
        const ai=await recoverPageWithScanic(loaded.canvas,(event,data)=>{
          logger.info('perspective','AI trace: '+event,data);
        });
        aiStatus=ai?'page-detected':'page-not-detected';
        logger.info('perspective','AI document boundary recovery',{
          model:'Scanic DocCornerNet SimCC',invoked:true,
          found:Boolean(ai),confidence:ai?.confidence??null,
          corners:ai?.corners??[],variant:ai?.variant??null,allCandidates:ai?.allCandidates??[],
          durationMs:Date.now()-aiStart
        });
        if(ai){
          // Scanic returns an already rectified A4 canvas. Before attempting a
          // second fiducial homography, directly test its native printed QR
          // and two timing tracks. This prevents a good first warp being
          // degraded by falsely detected corner squares on the warped image.
          let directGray:any=null;
          let directColor:any=null;
          let directAccepted=false;
          try{
            directColor=cv.imread(ai.canvas);
            directGray=new cv.Mat();
            cv.cvtColor(directColor,directGray,cv.COLOR_RGBA2GRAY);
            const directTiming=verifyTimingMarks(directGray,dpi);
            const directQR=decodeQRFromRegion(ai.canvas,
              OMR_LAYOUT.qr.xMm,OMR_LAYOUT.qr.yMm,OMR_LAYOUT.qr.sizeMm,dpi);
            const directStrip=measureGrayCalibration(directGray,dpi);
            logger.info('perspective','AI first-warp independent landmark verification',{
              method:'ai-boundary/direct-no-second-warp',
              timing:directTiming.matched,left:directTiming.leftMatched,
              right:directTiming.rightMatched,timingPassed:directTiming.passed,
              qrFound:directQR.found,qrValid:directQR.valid,
              stripStatus:directStrip.status,stripContrast:directStrip.contrast,
              stripOrdered:directStrip.ordered,
              note:'No second homography; QR and both timing tracks remain mandatory'
            });
            if(directQR.valid&&directTiming.passed){
              // The paper-edge hypothesis itself is not proof; only the QR
              // identity and the independently detected timing lattice are.
              const directCanvas=document.createElement('canvas');
              directCanvas.width=ai.canvas.width;directCanvas.height=ai.canvas.height;
              directCanvas.getContext('2d')?.drawImage(ai.canvas,0,0);
              selected={
                hypothesis:{kind:'corner',name:'ai-boundary/direct-verified',
                  markers:primary},
                perspective:{corrected:directColor,correctedDataUrl:'',
                  transform:null,success:true},
                gray:directGray,canvas:directCanvas,qr:directQR,
                check:directTiming,rotated:false
              };
              directAccepted=true;
              aiStatus='verified-direct-first-warp';
              logger.info('perspective','AI first-warp accepted via strict QR/timing',{
                timing:directTiming.matched,left:directTiming.leftMatched,
                right:directTiming.rightMatched});
            }
          }catch(error){
            logger.warning('perspective','AI first-warp verification unavailable',{
              reason:String(error)});
          }finally{
            if(!directAccepted)cleanupMats(directGray,directColor);
          }
          if(!selected){
          const processed=preprocessImage(ai.canvas);
          let aiOtsu:any=null;
          try{
            const variants=[{name:'adaptive',binary:processed.thresholded}];
            aiOtsu=new cv.Mat();
            cv.threshold(processed.gray,aiOtsu,0,255,cv.THRESH_BINARY_INV|cv.THRESH_OTSU);
            variants.push({name:'Otsu',binary:aiOtsu});
            for(const variant of variants){
              const corner=detectMarkers(variant.binary,ai.canvas.width,ai.canvas.height);
              const midpoint=detectMidpointMarkers(variant.binary,ai.canvas.width,ai.canvas.height);
              const aruco=detectArucoMarkers(processed.gray,variant.binary);
              const candidateList:Hypothesis[]=[];
              if(corner.found)candidateList.push({kind:'corner',name:'ai-boundary/corner-'+variant.name,markers:corner});
              if(midpoint.found)candidateList.push({kind:'midpoint',name:'ai-boundary/midpoint-'+variant.name,markers:midpoint});
              if(aruco.found)candidateList.push({kind:'aruco',name:'ai-boundary/aruco-'+variant.name,markers:aruco});
              logger.info('markerDetection','AI-prewarped fiducial discovery',{
                variant:variant.name,cornerCount:corner.count,
                midpointCount:midpoint.count,arucoIds:Object.keys(aruco.points),
                candidates:candidateList.map(h=>h.name)
              });
              if(candidateList.length===0){
                aiRejections.push({method:'ai-boundary/'+variant.name,reason:'no-complete-fiducials'});
              }
              for(const hypothesis of candidateList){
                aiAttempted++;warpAttempts++;
                const attemptStart=Date.now();
                const allowProvisional=corner.found && midpoint.found &&
                  ai.confidence>=.5 && variant.name==='adaptive';
                const evaluated=evaluateHypothesis(ai.canvas,hypothesis,dpi,curveBudget,allowProvisional);
                logger.info('perspective','AI candidate verification result',{
                  method:hypothesis.name,accepted:Boolean(evaluated),
                  reason:evaluated?(evaluated.provisional?'provisional-geometry-only':'qr-and-timing-verified'):
                    'qr-or-strong-independent-geometry-rejected-see-stage-logs',
                  durationMs:Date.now()-attemptStart,
                  timing:evaluated?.check.matched??0,
                  left:evaluated?.check.leftMatched??0,right:evaluated?.check.rightMatched??0,
                  qrValid:evaluated?.qr.valid??false
                });
                if(!evaluated){aiRejections.push({method:hypothesis.name,
                  reason:'qr-or-timing-validation-failed'});continue;}
                selected=evaluated;
                aiStatus=evaluated.provisional?'provisional-only':'verified';
                logger.info('perspective',evaluated.provisional?
                  'AI-assisted provisional geometry available (NO scoring)':
                  'AI-assisted registration independently verified',{
                  method:hypothesis.name,qrValid:evaluated.qr.valid,
                  left:evaluated.check.leftMatched,right:evaluated.check.rightMatched
                });
                break;
              }
              if(selected)break;
            }
          }finally{cleanupMats(aiOtsu,processed.gray,processed.blurred,processed.thresholded);}
          }
        }
      }catch(error){
        aiStatus='runtime-or-inference-error';
        logger.warning('perspective','Optional AI recovery unavailable',{
          reason:String(error),stage:'runtime/model/inference or preprocessing',
          note:'AI errors do not relax the existing verification requirements'
        });
      }finally{
        logger.info('perspective','AI last-resort summary',{
          invoked:true,model:'Scanic DocCornerNet SimCC',modelLibrary:'scanic@1.8.0',
          status:aiStatus,attempts:aiAttempted,verified:Boolean(selected),
          rejections:aiRejections,durationMs:Date.now()-aiStart
        });
      }
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
    let provisional = false;
    let alignmentMatched = 0;
    let registrationMethod: string | null = null;
    let rotated = false;
    let grayCalibration: ReturnType<typeof measureGrayCalibration> | undefined;

    if (selected) {
      const chosen = selected;
      corrected = true;
      provisional=Boolean(chosen.provisional);
      qrValid = chosen.qr.valid;
      studentId = chosen.qr.studentId;
      qrRaw = chosen.qr.raw;
      alignmentVerified = !chosen.provisional && chosen.qr.valid;
      alignmentMatched = chosen.check.matched;
      registrationMethod = chosen.hypothesis.name;
      rotated = chosen.rotated;
      markerCount = 4;
      logger.info('perspective', `Selected ${registrationMethod} registration`,
        { timingMarks: alignmentMatched, rotated,
          provisional:Boolean(chosen.provisional),qrValid });
      const geometryDecision=chooseGeometryAction({
        qrValid:chosen.qr.valid,timingMatched:chosen.check.matched,
        leftMatched:chosen.check.leftMatched,rightMatched:chosen.check.rightMatched
      });
      logger.info('perspective','v2.5.1 geometry decision router',geometryDecision);
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
      if(grayCalibration.status!=='ok'){
        const investigation=investigateGrayStrip(chosen.gray,dpi);
        logger.info('bubbleDetection','Grayscale strip geometry diagnostic (no scoring effect)',{
          ...investigation,selectedRegistration:registrationMethod,
          note:'Offset hypotheses are diagnostic only; never used to relax calibration or grading.'
        });
      }
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
      logger.info('perspective','v2.5.1 predictive local grid shadow analysis',
        summarizePredictedGrid(grid));
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
      const experimentalParams=typeof window!=='undefined'
        ?new URLSearchParams(window.location.search):new URLSearchParams();
      const proofMeshEnabled=experimentalParams.get('proofmesh')==='1';
      const proofModelEnabled=experimentalParams.get('proofmodel')==='1';
      let activeGridOffset=(q:number)=>offsetForQuestion(grid,q);
      let rawAnswers=detectAllAnswers(chosen.gray,dpi,inkCeiling??undefined,
        activeGridOffset,rawInkThreshold);
      const excludedInkQuestions=new Set(rawAnswers.filter(row=>
        row.measurements.some(m=>m.fillPercent>=15)).map(row=>row.question));
      const verifiedMesh=validateLocalMesh(chosen.gray,dpi,grid,excludedInkQuestions);
      const adoptedMesh=proofMeshEnabled&&verifiedMesh.accepted;
      if(adoptedMesh){
        activeGridOffset=(q:number)=>verifiedMesh.predicted[q]??offsetForQuestion(grid,q);
        rawAnswers=detectAllAnswers(chosen.gray,dpi,inkCeiling??undefined,
          activeGridOffset,rawInkThreshold);
      }
      logger.info('perspective','v2.5.2 withheld-print-validated local mesh',{
        requested:proofMeshEnabled,accepted:verifiedMesh.accepted,
        adopted:adoptedMesh,
        heldOutCount:verifiedMesh.heldOutCount,
        referenceScore:verifiedMesh.referenceScore,
        candidateScore:verifiedMesh.candidateScore,
        relativeGain:verifiedMesh.relativeGain,
        maxDisplacementPx:verifiedMesh.maxDisplacementPx,
        reason:verifiedMesh.reason,
        note:'Candidate based only on printed rings; cannot override QR identity'
      });
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
            activeGridOffset,correctedInkThreshold);
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
      // Decision-model-inspired SELECTIVE proof audit. The baseline scanner
      // remains unchanged unless ?proofscan=1 is explicitly enabled.
      // No external model/API, no duplicate full-page warp or crop inference.
      const proofEnabled = experimentalParams.get('proofscan')==='1';
      const proofs=answers.map(row=>auditBubbleDecision(row,
        activeGridOffset(row.question),rawAnswers.find(raw=>raw.question===row.question)));
      const latent=fitMaskedLatentPredictor(answers);
      logger.info('bubbleDetection','v2.5.2 masked latent template predictor',{
        ...latent,note:'Self-supervised predictor trained on current-sheet blank features; not full JEPA, never auto-grades'
      });
      const learnedProposals=answers.flatMap(row=>{
        const m=[...row.measurements].sort((a,b)=>b.fillPercent-a.fillPercent)[0];
        if(!m||m.fillPercent<18||row.status==='multiple')return [];
        const prediction=predictSyntheticDecision(m);
        return [{question:row.question,option:m.option,
          opticalStatus:row.status,modelLabel:prediction.label,
          margin:Number(prediction.margin.toFixed(3)),
          scoreSolid:Number(prediction.scores.solid.toFixed(3))}];
      });
      const modelReview=new Set(learnedProposals.filter(p=>
        p.opticalStatus==='detected'&&p.modelLabel!=='solid'&&
        p.margin>=0.20&&p.scoreSolid<0.30).map(p=>p.question));
      logger.info('bubbleDetection','v2.5.2 synthetic-trained closed-set head',{
        enabled:proofModelEnabled,model:SYNTHETIC_MODEL_INFO,
        proposals:learnedProposals,acceptedReviewCandidates:[...modelReview],
        note:'Uncalibrated synthetic-only model; no automatic promotion of rejected ink'
      });
      const reviewProofs=proofs.filter(p=>p.action==='review');
      // Only ambiguous or previously accepted ink gets the 15 tiny
      // local counterfactuals; blank 0%-ink rows do no extra work.
      const localVisualProofs=answers.flatMap(row=>{
        const top=[...row.measurements].sort((a,b)=>b.fillPercent-a.fillPercent)[0];
        if(!top||top.fillPercent<35||row.status==='multiple')return [];
        if(top.sampleXPx===undefined||top.sampleYPx===undefined||
           top.inkThreshold===undefined)return [];
        const proof=inspectLocalBubble(chosen.gray,top.sampleXPx,
          top.sampleYPx,dpi,top.inkThreshold);
        return proof.available?[{question:row.question,option:top.option,
          status:row.status,fill:top.fillPercent,...proof}]:[];
      });
      // Counterfactual failure only demotes an already accepted answer in
      // explicit experimental mode. Deliberate partial marks remain blank.
      const unstableAccepted=new Set(localVisualProofs.filter(p=>
        p.status==='detected'&&!p.stable&&p.spread>=35&&p.minFill<45)
        .map(p=>p.question));
      if(proofEnabled||proofModelEnabled){
        const lookup=new Map(proofs.map(p=>[p.question,p]));
        answers=answers.map(row=>{
          const reviewed=applyDecisionReview(row,lookup.get(row.question)!,true);
          return reviewed.status==='detected'&&(
            unstableAccepted.has(row.question)||
            (proofModelEnabled&&modelReview.has(row.question)))
            ? {...reviewed,status:'uncertain' as const,detectedAnswer:null,confidence:0}
            : reviewed;
        });
      }
      logger.info('bubbleDetection','v2.5.1 selective DecisionScan audit',{
        enabled:proofEnabled||proofModelEnabled,
        mode:proofEnabled?'conservative review':'shadow or trained-head selective review',
        evaluated:proofs.length,reviewCount:reviewProofs.length,
        localCounterfactualCount:localVisualProofs.length,
        unstableAccepted:[...unstableAccepted],
        localVisualProofs,
        reviewCandidates:reviewProofs.map(p=>({
          question:p.question,option:p.option,markClass:p.markClass,
          reason:p.reason,evidence:p.evidence
        })),
        note:'No trained model or calibrated probabilities; only suspicious accepted marks can be demoted, never auto-promoted'
      });
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
      provisional,
      registrationMethod, orientationRotated: rotated,
      processingTimeMs: Date.now() - start,
      grayCalibration,
      stageLogs: [],
      warnings: provisional?['PROVISIONAL extraction: QR identity unverified. Answers require human review; automatic scoring disabled.']:[],
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
