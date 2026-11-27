import type { ScanResult, IntermediateImages, QuestionResult, MarkerDetectionResult } from '../types';
import { loadImageFromFile, validateImage } from './imageLoader';
import { orientLandscapePhoto } from './pageOrientation';
import { preprocessImage, checkOpenCV, cleanupMats } from './imagePreprocessor';
import { detectMarkers } from './markerDetector';
import { proposeQrGuidedCorners } from './rotationInvariantCorners';
import { detectCoarseToFineCorners } from './coarseToFineCorners';
import { fitRobustSheetWarp, type FusionEvidence } from './robustSheetHomography';
import {discoverUpperPairs} from './partialMarkerRescue';
import { measureOpenCv5Simd } from './opencv5SimdLab';
import { measureTtop32Fork } from './ttop32ForkLab';
import { detectMidpointMarkers, generateMidpointOverlay } from './midpointDetector';
import type { MidpointRegistration } from './midpointDetector';
import { verifyTimingMarks } from './alignmentValidator';
import { diagnosticTimingResiduals } from './timingResidualDiagnostics';
import { canStopUnifiedRegistration } from './unifiedGeometryPolicy';
import { chooseGeometryAction } from './geometryRouter';
import { auditBubbleDecision, applyDecisionReview } from './decisionProof';
import { inspectLocalBubble } from './localVisualProof';
import { summarizePredictedGrid } from './predictiveGrid';
import { validateLocalMesh } from './validatedMesh';
import { orderFallbackCandidates } from './registrationPriority';
import { makeReviewCropSheet } from './reviewCropSheet';
import { fitMaskedLatentPredictor } from './latentPredictor';
import { predictSyntheticDecision, SYNTHETIC_MODEL_INFO } from './trainedDecisionHead';
import { recoverPaperBoundary } from './pageBoundaryRecovery';
import { warpQrAnchoredPaper, type QrAnchoredVariant } from './qrAnchoredPaperRecovery';
import { warpBoundaryOrientation } from './omniBoundary';
import { recoverPageWithScanic } from './scanicPageRescue';
import { recoverPageWithAI } from './aiPageRescue';
import { hybridAnchorEvidence, correctPerspectiveFromHybrid } from './hybridRegistration';
import { correctPerspectiveFromQrAruco } from './qrArucoRegistration';
import { correctPerspectiveFromQrCorners } from './qrCornerRegistration';
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
import {refineQuestionRings} from './answerCentricRings';
import {probeSourceInk} from './sourceInkProbe';
import {refineGeometryOnlyRings} from './templatePoseRefinement';
import { rescueTestIdOffset } from './testIdAlignment';
import { validateScanResult } from './scanValidator';
import { getSettings } from '../config/scannerSettings';
import { OMR_LAYOUT, mmToPx } from '../config/omrLayout';
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
  | { kind: 'hybrid'; name: string; corners: MarkerDetectionResult; aruco: ArucoRegistration; qrLocated?: ReturnType<typeof locateQRInPhoto> }
  | { kind: 'fusion'; name: string; corners: MarkerDetectionResult; midpoint?: MidpointRegistration; aruco: ArucoRegistration };
/** Deduplicate only EXACT reference coordinates on the SAME source image.
 * No near-match tolerance: a subpixel difference can affect printed rings.
 * All QR and timing gates are still enforced for the first occurrence.
 */
function geometryFingerprint(h:Hypothesis):string|null {
  if(h.kind==='hybrid'||h.kind==='fusion')return null;
  if(h.kind==='corner')return JSON.stringify(['corner',h.markers.topLeft,
    h.markers.topRight,h.markers.bottomLeft,h.markers.bottomRight]);
  if(h.kind==='midpoint')return JSON.stringify(['midpoint',h.markers.top,
    h.markers.right,h.markers.bottom,h.markers.left]);
  return JSON.stringify(['aruco',Object.entries(h.markers.points)
    .sort(([a],[b])=>a.localeCompare(b))]);
}

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
/** Decode only the expected 25mm QR patch from the rectified CV Mat.
 * This avoids rendering/encoding the entire A4 image during failed probes.
 * The existing regional jsQR fallback and strict SFGOMR1: parser are reused.
 */
function decodeWarpedQrAt(mat:any,xMm:number,yMm:number,sizeMm:number,dpi:number):QRStatus {
  const scale=dpi/25.4,padMm=2;
  const x=Math.max(0,Math.round((xMm-padMm)*scale));
  const y=Math.max(0,Math.round((yMm-padMm)*scale));
  const side=Math.round((sizeMm+2*padMm)*scale);
  if(x+side>mat.cols||y+side>mat.rows||side<=0)
    return {found:false,raw:null,valid:false,studentId:null,
      error:'Expected QR region outside registered A4 page'};
  let crop:any=null;
  try{
    crop=mat.roi(new cv.Rect(x,y,side,side));
    const canvas=document.createElement('canvas');
    canvas.width=side;canvas.height=side;
    cv.imshow(canvas,crop);
    // In a 25.25mm crop, the printed QR begins 2mm from its top-left.
    // decodeQRFromRegion preserves all its normal low-contrast rescue steps.
    return decodeQRFromRegion(canvas,padMm,padMm,sizeMm,dpi);
  }finally{crop?.delete?.();}
}

type RegistrationProbe = {
  phase:'warp'|'qr'|'timing'|'accepted'|'error';
  reason:string;qrValid:boolean;
  timing:number;left:number;right:number;
  warpMs?:number;qrMs?:number;previewMs?:number;
  fusionEvidence?:FusionEvidence;
};
function evaluateHypothesis(
  source: HTMLCanvasElement,
  hypothesis: Hypothesis,
  dpi: number,
  curveBudget: { remaining: number },
  allowQrlessProvisional = false,
  evidence?: RegistrationProbe,
  fastQrRoi = true
): AcceptedAlignment | null {
  let persp: PerspectiveResult | null = null;
  let gray: any = null;
  let keep = false;
  const warpStart=performance.now();
  if(evidence){evidence.phase='warp';evidence.reason='Warp did not produce an image';}
  try {
    persp = hypothesis.kind === 'corner'
      ? correctPerspective(source, hypothesis.markers, !fastQrRoi)
      : hypothesis.kind === 'midpoint'
      ? correctPerspectiveFromMidpoints(source, hypothesis.markers, !fastQrRoi)
      : hypothesis.kind === 'hybrid'
      ? hypothesis.qrLocated
         ? hypothesis.name.startsWith('hybrid/qr-only')
            ? correctPerspectiveFromQrCorners(source,hypothesis.qrLocated,!fastQrRoi)
            : correctPerspectiveFromQrAruco(source,hypothesis.qrLocated,hypothesis.aruco,!fastQrRoi)
         : correctPerspectiveFromHybrid(source,hypothesis.corners,hypothesis.aruco,!fastQrRoi)
      : hypothesis.kind === 'fusion'
      ? fitRobustSheetWarp(source,hypothesis.corners,hypothesis.midpoint,
          hypothesis.aruco,dpi,(fusion)=>{
          if(evidence)evidence.fusionEvidence=fusion;
          logger.info('perspective','v2.5.3 robust homography evidence',{...fusion});
        })?.perspective ?? {corrected:null,correctedDataUrl:'',
            transform:null,success:false,error:'RANSAC failed independent marker agreement'}
      : correctPerspectiveFromArucos(source,hypothesis.markers,!fastQrRoi);
    if(evidence)evidence.warpMs=Math.round(performance.now()-warpStart);
    if (!persp.success || !persp.corrected) return null;
    if(hypothesis.kind==='hybrid' && hypothesis.qrLocated?.valid &&
      hypothesis.qrLocated.center && persp.transform){
      // Source QR projected into the candidate template: distinguishes
      // unreadable QR from a correct source QR displaced by a poor warp.
      const m=persp.transform.data64F as Float64Array;
      const q=hypothesis.qrLocated.center;
      if(m?.length>=9){
        const d=m[6]*q.x+m[7]*q.y+m[8];
        if(Math.abs(d)>1e-8){
          const px=(m[0]*q.x+m[1]*q.y+m[2])/d;
          const py=(m[3]*q.x+m[4]*q.y+m[5])/d;
          const expectedX=mmToPx(OMR_LAYOUT.qr.xMm+OMR_LAYOUT.qr.sizeMm/2,dpi);
          const expectedY=mmToPx(OMR_LAYOUT.qr.yMm+OMR_LAYOUT.qr.sizeMm/2,dpi);
          logger.info('perspective','Exp3.7.3 source QR homography projection',{
            hypothesis:hypothesis.name,
            projectedPx:{x:Number(px.toFixed(1)),y:Number(py.toFixed(1))},
            errorMm:{dx:Number(((px-expectedX)*25.4/dpi).toFixed(2)),
              dy:Number(((py-expectedY)*25.4/dpi).toFixed(2))},
            registrationAcceptanceUnchanged:true
          });
        }
      }
    }
    // Only Experimental 4's failure-only partial-ArUco candidates receive
    // this cheap preflight. A real verified 48+/50 timing lattice cannot
    // fail these deliberately permissive preliminary bounds.
    if(hypothesis.name.startsWith('partial-aruco/')){
      let preflight:any=null;
      try{
        preflight=new cv.Mat();
        cv.cvtColor(persp.corrected,preflight,cv.COLOR_RGBA2GRAY);
        const t=verifyTimingMarks(preflight,dpi);
        const possible=t.matched>=16&&t.leftMatched>=5&&t.rightMatched>=5;
        logger.info('perspective','v2.5.4 partial-ArUco timing preflight',{
          method:hypothesis.name,matched:t.matched,
          left:t.leftMatched,right:t.rightMatched,passed:possible,
          note:'Cheap rejection only; QR + full dual timing remain mandatory for acceptance'
        });
        if(!possible){
          if(evidence){evidence.phase='timing';evidence.timing=t.matched;
            evidence.left=t.leftMatched;evidence.right=t.rightMatched;
            evidence.reason='Partial ArUco candidate rejected by permissive preliminary timing';}
          return null;
        }
      }finally{cleanupMats(preflight);}
    }
    const qrStart=performance.now();
    if(evidence){evidence.phase='qr';evidence.reason='QR not yet independently verified';}
    const canvas = document.createElement('canvas');
    canvas.width = persp.corrected.cols;
    canvas.height = persp.corrected.rows;
    if(!fastQrRoi)cv.imshow(canvas,persp.corrected);
    let qr=fastQrRoi
      ?decodeWarpedQrAt(persp.corrected,OMR_LAYOUT.qr.xMm,
        OMR_LAYOUT.qr.yMm,OMR_LAYOUT.qr.sizeMm,dpi)
      :decodeQRFromRegion(canvas,OMR_LAYOUT.qr.xMm,
        OMR_LAYOUT.qr.yMm,OMR_LAYOUT.qr.sizeMm,dpi);
    let rotated = false;
    if (!qr.valid) {
      const x = OMR_LAYOUT.page.widthMm - OMR_LAYOUT.qr.xMm - OMR_LAYOUT.qr.sizeMm;
      const y = OMR_LAYOUT.page.heightMm - OMR_LAYOUT.qr.yMm - OMR_LAYOUT.qr.sizeMm;
      const opposite=fastQrRoi?decodeWarpedQrAt(persp.corrected,x,y,OMR_LAYOUT.qr.sizeMm,dpi):decodeQRFromRegion(canvas,x,y,OMR_LAYOUT.qr.sizeMm,dpi);
      if (opposite.valid) {
        cv.rotate(persp.corrected, persp.corrected, cv.ROTATE_180);
        if(!fastQrRoi)cv.imshow(canvas,persp.corrected);
        qr=fastQrRoi
          ?decodeWarpedQrAt(persp.corrected,OMR_LAYOUT.qr.xMm,
            OMR_LAYOUT.qr.yMm,OMR_LAYOUT.qr.sizeMm,dpi)
          :decodeQRFromRegion(canvas,OMR_LAYOUT.qr.xMm,
            OMR_LAYOUT.qr.yMm,OMR_LAYOUT.qr.sizeMm,dpi);
        rotated = true;
      }
    }
    if(evidence)evidence.qrMs=Math.round(performance.now()-qrStart);
    if(evidence){evidence.qrValid=qr.valid;evidence.reason=qr.valid?'QR valid; checking timing':'QR invalid at both expected corners';}
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
        const independentMarkers=hypothesis.kind==='aruco' && hypothesis.markers.found ||
          hypothesis.kind==='midpoint' && hypothesis.markers.found ||
          hypothesis.kind==='fusion' && hypothesis.aruco.count>=2;
        const independentGeometry=strongTiming &&
          (independentMarkers || (stripValid && timing.matched===50));
        logger.info('perspective',`${hypothesis.name}: QR-less provisional geometry evidence`,{
          timing:timing.matched,left:timing.leftMatched,right:timing.rightMatched,
          requiredTiming:48,requiredPerSide:23,stripStatus:strip.status,
          stripContrast:strip.contrast,stripOrdered:strip.ordered,
          strongTiming,stripValid,independentMarkers,independentGeometry,
          accepted:independentGeometry
        });
        if(independentGeometry){
          gray=candidateGray;candidateGray=null;keep=true;
          logger.warning('perspective',`${hypothesis.name}: PROVISIONAL ONLY — QR not decoded; scoring prohibited`);
          cv.imshow(canvas,persp.corrected);
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
    if(evidence){
      evidence.phase='timing';evidence.qrValid=true;
      evidence.timing=check.matched;evidence.left=check.leftMatched;
      evidence.right=check.rightMatched;
      evidence.reason=check.passed?'Timing passed, checking final geometry':'Timing failed; retrying verified correction';
    }
    logger.info('perspective', `${hypothesis.name}: timing marks ${check.matched}/50`,
      { left: check.leftMatched, right: check.rightMatched, rotated });
    // Even a QR-valid ArUco candidate with 45–49 matched timing marks may
    // have measurable warp drift in the distant right column. Recheck with
    // four extreme printed timing squares, but only adopt a strictly better
    // independently verified result. Perfect 50/50 warps stay untouched.
    if (!check.passed || (check.matched >= 30 && check.matched < 50)) {
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
              persp.correctedDataUrl=fastQrRoi?'':candidate.toDataURL('image/png');
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
              const correctedUrl=fastQrRoi?'':candidate.toDataURL('image/png');
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
      // Exp3.7.9: one diagnostic-only local search around each expected
      // timing square after a QR-verified but rejected corner warp.
      // The nearest dark patch is not proof of a timing marker. This cannot
      // influence geometry adoption or threshold/sampling requirements.
      if(hypothesis.name==='corner/adaptive'||
         hypothesis.name.startsWith('corner/qr-frame-')||
         hypothesis.name.startsWith('ai-boundary/')){
        try{
          const residuals=diagnosticTimingResiduals(gray,dpi);
          logger.info('perspective','Exp3.7.9 rejected bilateral timing offsets',{
            method:hypothesis.name,
            nearby:residuals.foundNearby,
            left:residuals.leftNearby,right:residuals.rightNearby,
            medianAbsDxMm:residuals.medianAbsDxMm,
            medianAbsDyMm:residuals.medianAbsDyMm,
            samples:residuals.samples,
            warning:residuals.warning
          });
        }catch(error){logger.warning('perspective','Exp3.7.9 offset diagnostic failed',{
          method:hypothesis.name,reason:String(error)});}
      }
      if(evidence){evidence.phase='timing';evidence.reason='QR valid, timing gate rejected';
        evidence.timing=check.matched;evidence.left=check.leftMatched;evidence.right=check.rightMatched;}
      logger.warning('perspective', `${hypothesis.name}: rejected, insufficient independent timing-mark alignment`);
      return null;
    }
    if(evidence){evidence.phase='accepted';evidence.reason='QR valid and timing accepted';
      evidence.qrValid=qr.valid;evidence.timing=check.matched;
      evidence.left=check.leftMatched;evidence.right=check.rightMatched;}
    // The verified image is rendered once, and only when actually selected.
    const previewStart=performance.now();
    cv.imshow(canvas,persp.corrected);
    if(evidence)evidence.previewMs=Math.round(performance.now()-previewStart);
    keep = true;
    return { hypothesis, perspective: persp, gray, canvas, qr, check, rotated };
  } catch (error) {
    if(evidence){evidence.phase='error';evidence.reason=String(error);}
    logger.warning('perspective', `${hypothesis.name}: registration attempt failed`,
      { reason: String(error) });
    return null;
  } finally {
    if (!keep) cleanupMats(gray, persp?.corrected, persp?.transform);
  }
}

export interface ScanModeOptions {
  proofscan?: boolean;
  proofmodel?: boolean;
  proofmesh?: boolean;
  /** 3.8: holdout-verified per-question ring localisation; no ink threshold change. */
  answerCentricRings?: boolean;
  /** 3.8: original-source pixel probe; diagnostic only. */
  sourceInkProbe?: boolean;
  fastQrRoi?: boolean;
  coarseToFine?: boolean;
  robustFusion?: boolean;
  simdProbe?: boolean;
  ttopProbe?: boolean;
  /** Avoid retaining PNG overlays and base64 originals in batch diagnostic scans. */
  compact?: boolean;
  /** Exp3.7.2 only: QR-less geometry may produce non-scoring provisional data. */
  qrOptionalExperiment?: boolean;
  /** Disable ML document recovery to benchmark classical CV independently. */
  disableAiRecovery?: boolean;
}
export async function runFullScan(
  file: File,
  onProgress?: (p: ScanProgress) => void,
  options?: ScanModeOptions
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

  const loaded = await loadImageFromFile(file,{compact:options?.compact===true});
  finishStage('imageDecode');
  // A horizontal camera capture can contain a vertically printed sheet
  // turned 90°. Normalize before all existing reference detectors run.
  // Landmark hints never bypass QR and 50 timing-mark verification.
  const landscape=orientLandscapePhoto(loaded);
  if(landscape.rotation!=='none')
    logger.info('loading','Sideways OMR orientation recovery',{
      ...landscape,sourceQrIdentityOnlyHint:true,
      strictRegisteredQrAndTimingStillRequired:true
    });
  images.original = loaded.dataUrl;
  const validation = validateImage(loaded);
  if (!validation.valid) throw new Error(validation.errors.join('\n'));
  logger.info('loading', `Image loaded: ${loaded.width}×${loaded.height}px`, { validation });
  onProgress?.({ stage: 'Preparing grayscale and threshold images…', percent: 15 });

  if(options?.simdProbe){
    const simd=await measureOpenCv5Simd(loaded.canvas);
    logger.info('preprocessing','v2.5.3 OpenCV 5 SIMD separate runtime probe',{...simd});
  }
  if(options?.ttopProbe){
    const fork=await measureTtop32Fork(loaded.canvas);
    logger.info('preprocessing','v2.5.5 ttop32 OpenCV 4.12.0 WASM isolated runtime benchmark',{...fork,
      scoringRuntimeUnchanged:true,qrTimingGatesUnchanged:true});
  }
  const preprocessed = preprocessImage(loaded.canvas);
  finishStage('preprocessing');
  let selected: AcceptedAlignment | null = null;
  try {
    images.grayscale = preprocessed.grayDataUrl;
    images.thresholded = preprocessed.thresholdedDataUrl;
    onProgress?.({ stage: 'Finding reference markers (corner and edge midpoint)…', percent: 30 });

    const registrationStarted=Date.now();
    let originalQrLocatorMs=0;
    let failureQrHint:ReturnType<typeof locateQRInPhoto>|null=null;
    let boundaryQrMs=0;
    let boundaryQrAttempts=0;
    const hypotheses: Hypothesis[] = [];
    let fastWarpAttempts=0;
    const usedGeometries=new Set<string>();
    const markerProfile={cornerDetectionMs:0,cornerVerificationMs:0,
      fallbackDiscoveryMs:0,registrationProbeMs:0,
      fallbackDiscoveryTriggered:false,fastPathVerified:false,
      hypothesesEvaluated:0};
    const cornerStart=Date.now();
    const coarse=options?.coarseToFine!==false
      ?detectCoarseToFineCorners(preprocessed.thresholded,loaded.width,loaded.height)
      :null;
    const primary=coarse?.markers.found?coarse.markers
      :detectMarkers(preprocessed.thresholded,loaded.width,loaded.height);
    markerProfile.cornerDetectionMs=Date.now()-cornerStart;
    logger.info('markerDetection','v2.5.3 coarse-to-fine corner evidence',{
      enabled:options?.coarseToFine!==false,coarse:coarse?.stats??null,
      source:coarse?.markers.found?'coarse-refined':'legacy/full-resolution',
      originalPixels:loaded.width*loaded.height,
      coarsePixels:coarse?coarse.stats.coarseWidth*coarse.stats.coarseHeight:null,
      legacyRescueAvailable:true});
    logger.info('perspective','v2.5.3 registration optimization mode',{fastQrRoi:options?.fastQrRoi!==false,
      method:options?.fastQrRoi===false?'v3 legacy full-page PNG and QR scan':'ROI-only QR + deferred preview PNG',
      gates:'QR identity and 25+25 timing unchanged'});
    const dpi=getSettings().scanDpi;
    const curveBudget={remaining:1};
    let arucoAdaptive:ArucoRegistration={found:false,count:0,points:{}};
    let arucoOtsu:ArucoRegistration=arucoAdaptive;
    let cornerOtsuForHybrid:MarkerDetectionResult=primary;
    const provisionalCandidates:Array<{source:HTMLCanvasElement;hypothesis:Hypothesis}>=[];
    const registrationAttempts:{
      method:string;source:string;durationMs:number;phase:string;reason:string;
      qrValid:boolean;timing:number;left:number;right:number;
      accepted:boolean;provisional:boolean;
      warpMs?:number;qrMs?:number;previewMs?:number;
      fusionEvidence?:FusionEvidence;
    }[]=[];
    const traceRegistration=(
      source:HTMLCanvasElement,hypothesis:Hypothesis,dpi:number,
      budget:{remaining:number},allowProvisional=false
    ):AcceptedAlignment|null=>{
      const t=Date.now();
      const evidence:RegistrationProbe={phase:'warp',reason:'Not attempted',
        qrValid:false,timing:0,left:0,right:0};
      const result=evaluateHypothesis(source,hypothesis,dpi,budget,allowProvisional,evidence,
        options?.fastQrRoi!==false);
      const item={
        method:hypothesis.name,source:source===loaded.canvas?'original':'recovered',
        durationMs:Date.now()-t,phase:evidence.phase,reason:evidence.reason,
        qrValid:result?.qr.valid??evidence.qrValid,
        timing:result?.check.matched??evidence.timing,
        left:result?.check.leftMatched??evidence.left,
        right:result?.check.rightMatched??evidence.right,
        accepted:Boolean(result),provisional:Boolean(result?.provisional),
        warpMs:evidence.warpMs,qrMs:evidence.qrMs,previewMs:evidence.previewMs,
        fusionEvidence:evidence.fusionEvidence
      };
      registrationAttempts.push(item);
      if(options?.qrOptionalExperiment && !result && provisionalCandidates.length<32){
        const already=provisionalCandidates.some(x=>x.source===source &&
          x.hypothesis.kind===hypothesis.kind && x.hypothesis.name===hypothesis.name);
        if(!already)provisionalCandidates.push({source,hypothesis});
      }
      logger.info('perspective','v2.5.2 detailed registration candidate',item);
      return result;
    };

    // A genuinely cheap fast path: full QR identity and dual-side timing
    // verification BEFORE expensive ArUco, Otsu and midpoint discovery.
    if(primary.found){
      const hypothesis:Hypothesis={kind:'corner',name:'corner/adaptive',markers:primary};
      const fingerprint=geometryFingerprint(hypothesis);
      if(fingerprint)usedGeometries.add(fingerprint);
      const t=Date.now();
      logger.info('markerDetection','corner/adaptive: candidate coordinates',{
        topLeft:primary.topLeft,topRight:primary.topRight,
        bottomLeft:primary.bottomLeft,bottomRight:primary.bottomRight,
        validGeometry:primary.validGeometry});
      fastWarpAttempts++;
      const candidate=traceRegistration(loaded.canvas,hypothesis,dpi,curveBudget);
      markerProfile.cornerVerificationMs=Date.now()-t;
      markerProfile.hypothesesEvaluated++;
      if(candidate)selected=candidate;
      if(candidate&&canStopUnifiedRegistration(candidate.qr.valid,candidate.check.matched,
        candidate.check.leftMatched,candidate.check.rightMatched)){
        markerProfile.fastPathVerified=true;
        logger.info('perspective','Verified corner-first fast path: skipped ArUco/Otsu/midpoint discovery',{
          durationMs:Date.now()-t,timing:candidate.check.matched,
          left:candidate.check.leftMatched,right:candidate.check.rightMatched,qrValid:candidate.qr.valid});
      }else if(!candidate)hypotheses.push(hypothesis);
    }
    // Fail back to the established full-resolution corner selection when the
    // coarse estimate fails QR verification; never silently discard valid sheets.
    if(coarse?.markers.found&&(!selected||!canStopUnifiedRegistration(
      selected.qr.valid,selected.check.matched,
      selected.check.leftMatched,selected.check.rightMatched))){
      const legacy=detectMarkers(preprocessed.thresholded,loaded.width,loaded.height);
      if(legacy.found){
        const alternative:Hypothesis={kind:'corner',name:'corner/full-resolution-fallback',markers:legacy};
        const fingerprint=geometryFingerprint(alternative);
        if(fingerprint&&!usedGeometries.has(fingerprint)){
          usedGeometries.add(fingerprint);fastWarpAttempts++;
          markerProfile.hypothesesEvaluated++;
          const fallback=traceRegistration(loaded.canvas,alternative,dpi,curveBudget);
          const previousScore=selected?registrationScore({kind:'corner',
            timingMatched:selected.check.matched,leftMatched:selected.check.leftMatched,
            rightMatched:selected.check.rightMatched,qrVerified:selected.qr.valid}):-Infinity;
          const newScore=fallback?registrationScore({kind:'corner',
            timingMatched:fallback.check.matched,leftMatched:fallback.check.leftMatched,
            rightMatched:fallback.check.rightMatched,qrVerified:fallback.qr.valid}):-Infinity;
          const adopt=Boolean(fallback&&newScore>previousScore);
          logger.info('markerDetection','v2.5.3 full-resolution corner retry',{
            previous:'coarse-refined',result:fallback?'verified':'unverified',
            adopted:adopt,priorTiming:selected?.check.matched??null,
            candidateTiming:fallback?.check.matched??null,
            sameSource:false});
          if(adopt&&fallback){
            if(selected)disposeAlignment(selected);
            selected=fallback;
          }else if(fallback)disposeAlignment(fallback);
          else hypotheses.push(alternative);
        }
      }
    }
    // Exp3.7.9 — failure-only classical geometry, without camera quadrants.
    // The original camera-TL/TR/BL/BR detector remains the first/fast path.
    // When it fails, decode the SOURCE QR to recover the sheet's physical
    // directions and classify eligible printed square contours in that frame.
    // This permits 35° roll, sideways 90° and upside-down 180° captures;
    // only independent QR+bilateral timing can accept any proposed warp.
    if(!selected){
      const qrStart=Date.now();
      failureQrHint=locateQRInPhoto(loaded.canvas);
      originalQrLocatorMs+=Date.now()-qrStart;
      logger.info('markerDetection','Exp3.7.9 original-photo QR orientation hint',{
        found:failureQrHint.found,valid:failureQrHint.valid,
        center:failureQrHint.center,
        corners:failureQrHint.corners,attempts:failureQrHint.attempts,
        elapsedMs:Date.now()-qrStart,
        note:'Source QR is only a hint; never identity or timing approval'
      });
      if(failureQrHint.valid){
        const tryQrFrame=(binary:any,family:string,maxCandidates:number)=>{
          const {proposals,diagnostics}=proposeQrGuidedCorners(
            binary,loaded.width,loaded.height,failureQrHint!,maxCandidates);
          logger.info('markerDetection','Exp3.7.9 rotation-invariant corner search',{
            family,...diagnostics,proposals:proposals.map(p=>({
              score:p.score,quadrantViolations:p.quadrantViolations,
              corners:{tl:p.markers.topLeft,tr:p.markers.topRight,
                bl:p.markers.bottomLeft,br:p.markers.bottomRight}
            }))
          });
          for(const [i,proposal] of proposals.entries()){
            const hypothesis:Hypothesis={kind:'corner',
              name:'corner/qr-frame-'+family+'-'+(i+1),markers:proposal.markers};
            const fingerprint=geometryFingerprint(hypothesis);
            if(fingerprint&&usedGeometries.has(fingerprint))continue;
            if(fingerprint)usedGeometries.add(fingerprint);
            markerProfile.hypothesesEvaluated++;
            fastWarpAttempts++;
            const candidate=traceRegistration(loaded.canvas,hypothesis,dpi,curveBudget);
            // A background QR with a valid prefix must not substitute for
            // the decoded physical-sheet QR which oriented this proposal.
            if(candidate&&candidate.qr.raw!==failureQrHint!.raw){
              logger.warning('perspective','Exp3.7.9 source/warped QR identity mismatch',{
                name:hypothesis.name,accepted:false});
              disposeAlignment(candidate);continue;
            }
            if(!candidate)continue;
            selected=candidate;
            logger.info('perspective','Exp3.7.9 rotation-invariant corners verified',{
              name:hypothesis.name,qrIdentity:true,
              timing:candidate.check.matched,left:candidate.check.leftMatched,
              right:candidate.check.rightMatched,
              quadrantViolations:proposal.quadrantViolations});
            break;
          }
        };
        tryQrFrame(preprocessed.thresholded,'adaptive',4);
        if(!selected){
          let otsu:any=null;
          try{
            otsu=new cv.Mat();
            cv.threshold(preprocessed.gray,otsu,0,255,
              cv.THRESH_BINARY_INV|cv.THRESH_OTSU);
            tryQrFrame(otsu,'otsu',3);
          }finally{cleanupMats(otsu);}
        }
      }
    }
    if(!selected||!canStopUnifiedRegistration(selected.qr.valid,selected.check.matched,
      selected.check.leftMatched,selected.check.rightMatched)){
    markerProfile.fallbackDiscoveryTriggered=true;
    const fallbackDiscoveryStart=Date.now();
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
    const partialArucoCount=Object.keys(arucoAdaptive.points).length;
    const fusionAnchors=(primary.found?4:0)+(mid.found?4:0)+partialArucoCount;
    const fusionFamilies=(primary.found?1:0)+(mid.found?1:0)+(partialArucoCount?1:0);
    const fusionEligible=options?.robustFusion!==false&&fusionAnchors>=6&&fusionFamilies>=2;
    logger.info('markerDetection','v2.5.4 RANSAC fusion eligibility',{
      enabled:options?.robustFusion!==false,arucoCount:partialArucoCount,
      arucoFound:arucoAdaptive.found,midpointCount:mid.count,
      midpointFound:mid.found,cornerCount:primary.count,
      anchors:fusionAnchors,families:fusionFamilies,eligible:fusionEligible,
      note:'Partial independently decoded ArUco IDs permitted; QR and timing remain mandatory'});
    if(fusionEligible){
      hypotheses.push({kind:'fusion',name:'fusion/ransac-partial-aruco',
        corners:primary,midpoint:mid,aruco:arucoAdaptive});
    }
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

      markerProfile.fallbackDiscoveryMs=Date.now()-fallbackDiscoveryStart;
    }
    finishStage('markerDiscovery');
    logger.info('markerDetection','Registration engine budget and measured work',{
      ...markerProfile,
      phaseAccounting:'markerDiscovery stage includes corner registration verification, not only marker finding',
      skippedFamilies:markerProfile.fastPathVerified?
        ['ArUco adaptive','Otsu','midpoint','boundary','AI'] : [],
      note:'Never skip identity (QR) and both 25-row timing tracks'
    });
    logger.info('markerDetection', `${hypotheses.length} reference hypotheses available`,
      { cornerCandidates: hypotheses.filter(h => h.kind === 'corner').length,
        midpointCandidates: hypotheses.filter(h => h.kind === 'midpoint').length,
        arucoCandidates: hypotheses.filter(h => h.kind === 'aruco').length,
        methodNames: hypotheses.map(h => h.name) });
    if(!options?.compact)images.markerOverlay = arucoAdaptive.found
      ? generateArucoOverlay(loaded.canvas,arucoAdaptive)
      : generateMarkerOverlay(loaded.canvas, primary);
    onProgress?.({ stage: 'Verifying candidate registrations with QR and timing marks…', percent: 48 });
    let warpAttempts=fastWarpAttempts;
    let boundaryAttempted=false;
    const routing=orderFallbackCandidates(hypotheses,{
      cornerFailed:!selected,arucoCount:arucoAdaptive.count,arucoFound:arucoAdaptive.found
    });
    logger.info('markerDetection','v2.5.2 adaptive fallback registration order',{
      strategy:routing.strategy,
      actualOrder:routing.candidates.map(h=>h.name),
      markerIds:Object.keys(arucoAdaptive.points)
    });
    for (const hypothesis of routing.candidates) {
      if(selected&&canStopUnifiedRegistration(selected.qr.valid,selected.check.matched,
        selected.check.leftMatched,selected.check.rightMatched))break;
      const fingerprint=geometryFingerprint(hypothesis);
      if(fingerprint&&usedGeometries.has(fingerprint)){
        logger.info('markerDetection','v2.5.2 duplicate exact marker geometry skipped',{
          candidate:hypothesis.name,reason:'Identical coordinates already verified on original photo'
        });
        continue;
      }
      if(fingerprint)usedGeometries.add(fingerprint);
      logger.info('markerDetection', `${hypothesis.name}: candidate coordinates`,
        hypothesis.kind === 'corner'
          ? { topLeft:hypothesis.markers.topLeft, topRight:hypothesis.markers.topRight, bottomLeft:hypothesis.markers.bottomLeft,
              bottomRight:hypothesis.markers.bottomRight, validGeometry:hypothesis.markers.validGeometry }
          : hypothesis.kind === 'midpoint'
          ? { top:hypothesis.markers.top, right:hypothesis.markers.right, bottom:hypothesis.markers.bottom, left:hypothesis.markers.left }
          : hypothesis.kind === 'aruco'
          ? { ids:Object.keys(hypothesis.markers.points),points:hypothesis.markers.points }
          : {fusion:hypothesis.kind==='fusion',anchors:hypothesis.aruco.points});
      // Clean photos should not pay for two extra full-resolution warps.
      // We still compare the independent adaptive midpoint candidate before
      // skipping Otsu alternatives, and retry Otsu for marginal alignments.
      if (skipRedundantFallback(selected?.check.matched ?? null, hypothesis.name,
        hypothesis.kind==='hybrid'||hypothesis.kind==='fusion'?'corner':hypothesis.kind)) {
        logger.info('markerDetection', `${hypothesis.name}: skipped redundant expensive fallback after strong verification`);
        continue;
      }
      warpAttempts++;
      markerProfile.hypothesesEvaluated++;
      const probeStart=Date.now();
      const evaluated = traceRegistration(loaded.canvas, hypothesis, dpi, curveBudget);
      markerProfile.registrationProbeMs+=Date.now()-probeStart;
      if (!evaluated) continue;
      // Prefer the hypothesis that aligns the most timing marks; tie-break in
      // favour of actual corner squares (less extrapolation than midpoints).
      const rank = (a: AcceptedAlignment) => registrationScore({
        kind: a.hypothesis.kind==='hybrid'||a.hypothesis.kind==='fusion'?'corner':a.hypothesis.kind, timingMatched: a.check.matched,
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
        const attempt=traceRegistration(loaded.canvas,hypothesis,dpi,curveBudget);
        if(!attempt)continue;
        const score=registrationScore({kind:'midpoint',
          timingMatched:attempt.check.matched,
          leftMatched:attempt.check.leftMatched,
          rightMatched:attempt.check.rightMatched,
          qrVerified:attempt.qr.valid});
        const prior=selected?registrationScore({
          kind:selected.hypothesis.kind==='hybrid'||selected.hypothesis.kind==='fusion'?'corner':selected.hypothesis.kind,timingMatched:selected.check.matched,
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
        const evaluated=traceRegistration(loaded.canvas,hypothesis,dpi,curveBudget);
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
        const accepted=traceRegistration(loaded.canvas,hypothesis,dpi,curveBudget);
        if(!accepted)continue;
        selected=accepted;
        logger.info('perspective','Cross-threshold corner repair strictly verified',{
          method:hypothesis.name,qr:true,timing:accepted.check.matched,
          left:accepted.check.leftMatched,right:accepted.check.rightMatched});
        break;
      }
    }

    // EXPERIMENT 4: two independently decoded bottom ArUco IDs suffice to
    // propose alternative top corner squares. On clean images this never runs.
    if(!selected && ((arucoAdaptive.points[2]&&arucoAdaptive.points[3]) ||
       (arucoOtsu.points[2]&&arucoOtsu.points[3]))){
      const start=performance.now();
      const rescueOtsu=new cv.Mat();
      try{
        cv.threshold(preprocessed.gray,rescueOtsu,0,255,cv.THRESH_BINARY_INV|cv.THRESH_OTSU);
        const sources=[
          {name:'adaptive',binary:preprocessed.thresholded,aruco:arucoAdaptive},
          {name:'Otsu',binary:rescueOtsu,aruco:arucoOtsu}
        ];
        const candidates=sources.flatMap(source=>{
          const discovered=discoverUpperPairs(source.binary,source.aruco,source.name,8);
          logger.info('markerDetection','v2.5.4 partial-ArUco upper-corner discovery',{
            source:source.name,...discovered.evidence,
            proposals:discovered.candidates.map(p=>({
              topLeft:p.topLeft,topRight:p.topRight,rankScore:p.score
            }))
          });
          return discovered.candidates.map(p=>({...p,aruco:source.aruco}));
        }).sort((a,b)=>a.score-b.score);
        const visited=new Set<string>();
        let evaluated=0;
        for(const p of candidates){
          if(evaluated>=12)break;
          const fingerprint=JSON.stringify([p.topLeft,p.topRight,p.aruco.points[2],p.aruco.points[3]]);
          if(visited.has(fingerprint))continue;
          visited.add(fingerprint);evaluated++;
          const hypothesis:Hypothesis={kind:'hybrid',
            name:'partial-aruco/'+p.source+'/upper-'+evaluated,
            corners:p.markers,aruco:p.aruco};
          warpAttempts++;
          const attempt=traceRegistration(loaded.canvas,hypothesis,dpi,curveBudget);
          if(attempt){selected=attempt;break;}
        }
        logger.info('perspective','v2.5.4 partial-ArUco recovery summary',{
          proposed:candidates.length,evaluated,verified:Boolean(selected),
          selected:selected?.hypothesis.name??null,
          durationMs:Math.round(performance.now()-start),
          note:'All candidates require SFGOMR1 identity and independent dual timing acceptance'
        });
      }catch(error){
        logger.warning('perspective','v2.5.4 partial-ArUco recovery exception',{reason:String(error)});
      }finally{rescueOtsu.delete();}
    }

    let photoQr:ReturnType<typeof locateQRInPhoto>|null=null;
    // Geometric QR finder search on the ORIGINAL photo is independent of
    // a failed perspective warp. It is diagnostic evidence, not scan approval.
    if(!selected){
      const qrLocatorStart=Date.now();
      const located=failureQrHint??locateQRInPhoto(loaded.canvas);
      photoQr=located;
      if(!failureQrHint)originalQrLocatorMs+=Date.now()-qrLocatorStart;
      logger.info('qrDecoding','Independent original-photo QR locator',{
        found:located.found,valid:located.valid,center:located.center,
        corners:located.corners,raw:located.raw,attempts:located.attempts,
        error:located.error,durationMs:Date.now()-qrLocatorStart
      });
      // Z.ai P-2: independent QR corners are four valid correspondences.
      // They are spatially clustered and MUST pass the untouched full QR
      // and two timing-track checks; never trust them as page proof alone.
      if(located.valid){
        const qrOnly:Hypothesis={kind:'hybrid',name:'hybrid/qr-only-landmark',
          corners:primary,aruco:arucoAdaptive,qrLocated:located};
        warpAttempts++;
        const qrOnlyResult=traceRegistration(loaded.canvas,qrOnly,dpi,curveBudget);
        logger.info('perspective','Exp3.7.3 QR-only landmark proposal',{
          decodedInOriginal:true,accepted:Boolean(qrOnlyResult),
          timing:qrOnlyResult?.check.matched??null,
          note:'QR-corner extrapolation never bypasses timing verification'});
        if(qrOnlyResult)selected=qrOnlyResult;
      }
      // New v2.3.46 failure-only cross-family registration. It combines
      // independently located QR corners with two decoded bottom ArUco IDs.
      // evaluateHypothesis still enforces QR identity and both timing tracks.
      if(located.valid && !selected){
        for(const source of [{name:'adaptive',aruco:arucoAdaptive},
          {name:'Otsu',aruco:arucoOtsu}]){
          if(!source.aruco.points[2]||!source.aruco.points[3])continue;
          const proposal:Hypothesis={
            kind:'hybrid',name:'hybrid/qr-aruco-'+source.name,
            corners:primary,aruco:source.aruco,qrLocated:located
          };
          warpAttempts++;
          const evaluated=traceRegistration(loaded.canvas,proposal,dpi,curveBudget);
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
      let rough=recoverPaperBoundary(loaded.canvas,evidence=>{
        logger.info('perspective','Outer-page boundary recovery evidence',{
          reason:evidence.reason,candidates:evidence.candidates,
          contourAreaRatio:evidence.contourAreaRatio,
          rejectedBorder:evidence.rejectedBorder,
          rejectedImageCorner:evidence.rejectedImageCorner,
          rejectedGeometry:evidence.rejectedGeometry,
          rejectedQrOutside:evidence.rejectedQrOutside,mode:evidence.mode,
          candidateSummary:evidence.candidateSummary,
          thresholdsTried:evidence.thresholdsTried,
          method:evidence.method,
          quadrilateral:evidence.quadrilateral});
      });
      if(!rough){
        // Exp3.7.9 bounded second chance for a smaller, fully visible paper
        // against light patchwork. Do not relax frame-corner rejection and
        // use independently decoded source QR as an inside-quad constraint.
        // Even a candidate returned here must pass QR AND bilateral timing.
        rough=recoverPaperBoundary(loaded.canvas,evidence=>{
          logger.info('perspective','Exp3.7.9 small-page boundary rejection evidence',{
            mode:evidence.mode,reason:evidence.reason,
            candidates:evidence.candidates,rejectedGeometry:evidence.rejectedGeometry,
            rejectedBorder:evidence.rejectedBorder,
            rejectedImageCorner:evidence.rejectedImageCorner,
            rejectedQrOutside:evidence.rejectedQrOutside,
            candidateSummary:evidence.candidateSummary,
            quadrilateral:evidence.quadrilateral,
            alternatives:evidence.alternativeQuads
          });
        },{mode:'small-page-rescue',
          qrCenter:photoQr?.valid?photoQr.center:null});
      }
      if(!rough)logger.warning('perspective',
        'Both strict and QR-constrained small-page boundary searches returned no plausible sheet');
      // Experiment 3.6: independently orient any recovered paper quad at 0,
      // 90, 180, or 270 degrees. Each mapping is a true 4-point homography,
      // so the ORIGINAL sheet can be tilted at any angle and in perspective.
      // Cheap QR/geometry-verified fast registrations never enter this path.
      // A white-page contour alone is NEVER accepted as an OMR identity.
      if(rough?.evidence.quadrilateral && !selected){
        const pageCandidates=[
          {corners:rough.evidence.quadrilateral,method:rough.evidence.method??'primary'},
          ...(rough.evidence.alternativeQuads??[])
        ];
        logger.info('perspective','Exp3.7 alternative paper hypotheses',{
          alternatives:pageCandidates.length-1,
          methods:pageCandidates.map(x=>x.method),
          mandatoryGates:'QR SFGOMR1 and independent left/right timing'
        });
        // Preserve just one large source Mat and one output canvas through the
        // failure-only orientation loop; no additional memory per unsuccessful turn.
        let boundarySourceMat:any=null;
        const boundaryOutputCanvas=document.createElement('canvas');
        try{
          boundarySourceMat=cv.imread(loaded.canvas);
        for(const [candidateIndex,page] of pageCandidates.entries()){
        if(selected)break;
        // Exp 3.7.7: use the decoded source QR as a local anchor, with
        // independently found far paper corners constraining sheet perspective.
        // A candidate is NEVER accepted without the exact same QR and two
        // complete independently verified timing tracks.
        if(photoQr?.valid){
          for(const variant of ['top-pair','left-pair','diagonal'] as QrAnchoredVariant[]){
            let rescueCanvas:HTMLCanvasElement|null=null;
            let rescueMat:any=null,rescueGray:any=null;
            let kept=false;
            try{
              rescueCanvas=warpQrAnchoredPaper(
                loaded.canvas,photoQr,page.corners,dpi,variant,boundarySourceMat);
              if(!rescueCanvas)continue;
              const qrStart=performance.now();
              const checkedQr=decodeQRFromRegion(rescueCanvas,
                OMR_LAYOUT.qr.xMm,OMR_LAYOUT.qr.yMm,OMR_LAYOUT.qr.sizeMm,dpi);
              boundaryQrMs+=performance.now()-qrStart;
              boundaryQrAttempts++;
              if(!checkedQr.valid||checkedQr.raw!==photoQr.raw){
                logger.info('perspective','Exp3.7.7 QR-anchor proposal rejected',{
                  candidateIndex,method:page.method,variant,phase:'qr',
                  valid:checkedQr.valid,sourceIdentityMatched:checkedQr.raw===photoQr.raw});
                continue;
              }
              rescueMat=cv.imread(rescueCanvas);
              rescueGray=new cv.Mat();
              cv.cvtColor(rescueMat,rescueGray,cv.COLOR_RGBA2GRAY);
              const t=verifyTimingMarks(rescueGray,dpi);
              logger.info('perspective','Exp3.7.7 QR-anchor geometry evidence',{
                candidateIndex,method:page.method,variant,qrVerified:true,
                timing:t.matched,left:t.leftMatched,right:t.rightMatched,
                accepted:t.passed});
              if(!t.passed)continue;
              selected={hypothesis:{kind:'corner',name:'boundary/qr-anchor-'+variant,
                markers:primary},
                perspective:{corrected:rescueMat,correctedDataUrl:'',
                  transform:null,success:true},
                gray:rescueGray,canvas:rescueCanvas,qr:checkedQr,
                check:t,rotated:false};
              kept=true;rescueMat=null;rescueGray=null;
              break;
            }catch(error){
              logger.warning('perspective','Exp3.7.7 QR-anchor rescue exception',{
                candidateIndex,variant,reason:String(error)});
            }finally{if(!kept)cleanupMats(rescueMat,rescueGray);}
          }
        }
        if(selected)break;
        // Z.ai P-3 conservative prefilter: the independently decoded source QR
        // must lie inside the proposed physical paper quad. Reject only when
        // it is definitely outside, leaving near-edge cases for full checks.
        if(photoQr?.valid && photoQr.center){
          const q=photoQr.center;
          const cross=page.corners.map((p,i)=>{
            const n=page.corners[(i+1)%4];
            return (n.x-p.x)*(q.y-p.y)-(n.y-p.y)*(q.x-p.x);
          });
          const positive=cross.filter(v=>v>0).length;
          const negative=cross.filter(v=>v<0).length;
          if(positive>0&&negative>0){
            logger.info('perspective','Exp3.7.3 boundary candidate rejected by source QR location',{
              candidateIndex,method:page.method,qrCenter:q,reason:'located QR outside candidate quad'});
            continue;
          }
        }
        for(const turn of [0,1,2,3] as const){
          let candidateCanvas:HTMLCanvasElement|null=null;
          let candidateColor:any=null,candidateGray:any=null;
          let accepted=false;
          try{
            candidateCanvas=warpBoundaryOrientation(
              loaded.canvas,page.corners,turn,boundarySourceMat,boundaryOutputCanvas);
            if(!candidateCanvas)continue;
            const qrStart=performance.now();
            const qr=decodeQRFromRegion(candidateCanvas,
              OMR_LAYOUT.qr.xMm,OMR_LAYOUT.qr.yMm,OMR_LAYOUT.qr.sizeMm,dpi);
            boundaryQrMs+=performance.now()-qrStart;
            boundaryQrAttempts++;
            // QR-first short circuit avoids threshold scans on wrong orientations.
            if(!qr.valid){
              logger.info('perspective','Exp3.6 360-degree boundary orientation',{
                pageCandidate:candidateIndex,method:page.method,turnDegrees:turn*90,qrValid:false,timing:0,accepted:false});
              continue;
            }
            candidateColor=cv.imread(candidateCanvas);
            candidateGray=new cv.Mat();
            cv.cvtColor(candidateColor,candidateGray,cv.COLOR_RGBA2GRAY);
            const check=verifyTimingMarks(candidateGray,dpi);
            logger.info('perspective','Exp3.6 360-degree boundary orientation',{
              pageCandidate:candidateIndex,method:page.method,turnDegrees:turn*90,qrValid:true,
              timing:check.matched,left:check.leftMatched,right:check.rightMatched,
              accepted:check.passed});
            if(!check.passed)continue;
            selected={
              hypothesis:{kind:'corner',name:'boundary/360-quad-'+candidateIndex+'-'+(turn*90),
                markers:primary},
              perspective:{corrected:candidateColor,correctedDataUrl:'',
                transform:null,success:true},
              gray:candidateGray,canvas:candidateCanvas,qr,check,rotated:turn===2
            };
            candidateColor=null;candidateGray=null;accepted=true;
            logger.info('perspective','Exp3.6 verified all-angle geometry recovery',{
              pageCandidate:candidateIndex,method:page.method,turnDegrees:turn*90,qrIdentityVerified:true,
              timing:check.matched,note:'Both printed timing tracks mandatory'});
            break;
          }catch(error){
            logger.warning('perspective','Exp3.6 quadrilateral orientation error',{
              turnDegrees:turn*90,error:String(error)});
          }finally{
            if(!accepted)cleanupMats(candidateColor,candidateGray);
          }
        }
        } // after all rotations, try next independent page candidate
        }finally{cleanupMats(boundarySourceMat);}
      }
      if(rough && !selected){
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
            const candidate=traceRegistration(rough.canvas,hypothesis,dpi,curveBudget);
            if(!candidate)continue;
            const score=registrationScore({
              kind:candidate.hypothesis.kind==='hybrid'||candidate.hypothesis.kind==='fusion'?'corner':candidate.hypothesis.kind,timingMatched:candidate.check.matched,
              leftMatched:candidate.check.leftMatched,rightMatched:candidate.check.rightMatched,
              qrVerified:candidate.qr.valid});
            const previous=selected?registrationScore({
              kind:selected.hypothesis.kind==='hybrid'||selected.hypothesis.kind==='fusion'?'corner':selected.hypothesis.kind,timingMatched:selected.check.matched,
              leftMatched:selected.check.leftMatched,rightMatched:selected.check.rightMatched,
              qrVerified:selected.qr.valid}):-Infinity;
            if(score>previous){
              if(selected)disposeAlignment(selected);
              selected=candidate;
              if(!options?.compact)images.markerOverlay=generateArucoOverlay(rough.canvas,rescueAruco,
                hypothesis.name,candidate.check.matched);
            }else disposeAlignment(candidate);
            if(selected&&canStopUnifiedRegistration(selected.qr.valid,
              selected.check.matched,selected.check.leftMatched,
              selected.check.rightMatched))break;
          }
          // 3.8.0: run geometry-only template matching on the coarse A4 view
          // when all conventional fiducial re-detection has failed.
          // This fits printed bubble outlines (not student's answer ink),
          // then validates separately on withheld rings and finally QR +
          // left/right timing. No QR-less scoring is permitted.
          if(!selected){
            // Reuse the same source paper quadrilateral at each quarter-turn.
            // No camera-frame quadrant assumption: image orientation is unknown.
            for(const turn of [0,1,2,3] as const){
              if(selected)break;
              const oriented=turn===0?rough.canvas:
                rough.evidence.quadrilateral?
                  warpBoundaryOrientation(loaded.canvas,rough.evidence.quadrilateral,turn):null;
              if(!oriented)continue;
              const template=refineGeometryOnlyRings(oriented,dpi);
              logger.info('perspective','Exp3.8 correspondence-free geometry-only template proposal',
                {...template.evidence,turnDegrees:turn*90});
            if(template.canvas){
              let probeMat:any=null,probeGray:any=null;
              let adopted=false;
              try{
                const quickQr=decodeQRFromRegion(template.canvas,
                  OMR_LAYOUT.qr.xMm,OMR_LAYOUT.qr.yMm,OMR_LAYOUT.qr.sizeMm,dpi);
                if(quickQr.valid){
                  probeMat=cv.imread(template.canvas);
                  probeGray=new cv.Mat();
                  cv.cvtColor(probeMat,probeGray,cv.COLOR_RGBA2GRAY);
                  const timing=verifyTimingMarks(probeGray,dpi);
                  logger.info('perspective','Exp3.8 template proposal independently verified',{
                    qrValid:true,matched:timing.matched,left:timing.leftMatched,
                    right:timing.rightMatched,passed:timing.passed});
                  if(timing.passed){
                    selected={hypothesis:{kind:'corner',
                      name:'template-rings/affine-'+(turn*90),markers:primary},
                      perspective:{corrected:probeMat,correctedDataUrl:'',
                        transform:null,success:true},
                      gray:probeGray,canvas:template.canvas,qr:quickQr,
                      check:timing,rotated:turn===2};
                    adopted=true;probeMat=null;probeGray=null;
                  }
                }else logger.info('perspective','Exp3.8 template QR not verified',{
                  reason:'no-identifiable-QR-at-template-coordinate'});
                if(!selected){
                  const p=preprocessImage(template.canvas);
                  try{
                    const corner=detectMarkers(p.thresholded,template.canvas.width,template.canvas.height);
                    const mid=detectMidpointMarkers(p.thresholded,template.canvas.width,template.canvas.height);
                    const refinements:Hypothesis[]=[];
                    if(corner.found)refinements.push({kind:'corner',
                      name:'template-rings/corner',markers:corner});
                    if(mid.found)refinements.push({kind:'midpoint',
                      name:'template-rings/midpoint',markers:mid});
                    for(const hypothesis of refinements){
                      warpAttempts++;
                      const candidate=traceRegistration(template.canvas,hypothesis,dpi,curveBudget);
                      if(candidate){
                        selected=candidate;adopted=true;break;
                      }
                    }
                  }finally{cleanupMats(p.gray,p.blurred,p.thresholded);}
                }
                logger.info('perspective','Exp3.8 template rescue conclusion',{
                  adopted,method:selected?.hypothesis.name??null,
                  heldoutScore:template.evidence.heldoutBest});
              }finally{cleanupMats(probeMat,probeGray);}
            }
            } // 4 quarter-turn template hypotheses
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
    if(!selected && !options?.disableAiRecovery){
      const aiStart=Date.now();
      let aiAttempted=0;
      let aiStatus='not-started';
      let aiRejections:{method:string;reason:string}[]=[];
      let aiOrientationProbes=0;
      let aiQrVerifiedProbes=0;
      let aiBestTiming={matched:0,left:0,right:0,turnDegrees:null as number|null};
      try{
        onProgress?.({stage:'Last resort: detecting page corners with local AI…',percent:52});
        const ai=await recoverPageWithScanic(loaded.canvas,(event,data)=>{
          logger.info('perspective','AI trace: '+event,data);
        },{sourceQrCenter:photoQr?.valid?photoQr.center:null});
        aiStatus=ai?'page-detected':'page-not-detected';
        logger.info('perspective','AI document boundary recovery',{
          model:'Scanic DocCornerNet SimCC',invoked:true,
          found:Boolean(ai),confidence:ai?.confidence??null,
          corners:ai?.corners??[],variant:ai?.variant??null,allCandidates:ai?.allCandidates??[],
          durationMs:Date.now()-aiStart
        });
        if(ai){
          // Experiment 3.6: AI is a geometry proposer only. Independently
          // test all four physical A4 orientations using the detected corners
          // on the ORIGINAL source. No second marker fit is needed for a good
          // candidate, and every result must pass both QR and timing gates.
          for(const turn of [0,1,2,3] as const){
            let trial:HTMLCanvasElement|null=null;
            let color:any=null,gray:any=null,keep=false;
            try{
              trial=warpBoundaryOrientation(loaded.canvas,ai.corners,turn);
              if(!trial)continue;
              const qr=decodeQRFromRegion(trial,
                OMR_LAYOUT.qr.xMm,OMR_LAYOUT.qr.yMm,OMR_LAYOUT.qr.sizeMm,dpi);
              aiOrientationProbes++;
              if(!qr.valid){
                logger.info('perspective','Exp3.7.10 AI orientation evidence',{
                  turnDegrees:turn*90,qrValid:false,timingNotEvaluated:true,
                  accepted:false,reason:'warped-QR-not-at-expected-coordinate'
                });
                continue;
              }
              aiQrVerifiedProbes++;
              color=cv.imread(trial);gray=new cv.Mat();
              cv.cvtColor(color,gray,cv.COLOR_RGBA2GRAY);
              const timing=verifyTimingMarks(gray,dpi);
              if(timing.matched>aiBestTiming.matched)
                aiBestTiming={matched:timing.matched,left:timing.leftMatched,
                  right:timing.rightMatched,turnDegrees:turn*90};
              logger.info('perspective','Exp3.7.10 AI orientation evidence',{
                turnDegrees:turn*90,qrValid:true,timing:timing.matched,
                left:timing.leftMatched,right:timing.rightMatched,
                accepted:timing.passed,reason:timing.passed?'strictly-verified':'bilateral-timing-rejected'
              });
              if(!timing.passed && (timing.leftMatched>=8||timing.rightMatched>=8)){
                try{
                  logger.info('perspective','Exp3.7.10 AI rejected timing residuals',{
                    turnDegrees:turn*90,...diagnosticTimingResiduals(gray,dpi)
                  });
                }catch(error){logger.warning('perspective','Exp3.7.10 AI timing residual diagnostic error',{
                  turnDegrees:turn*90,reason:String(error)});
                }
              }
              logger.info('perspective','Exp3.6 AI 360-degree candidate',{
                turnDegrees:turn*90,qrValid:true,timing:timing.matched,
                left:timing.leftMatched,right:timing.rightMatched,
                accepted:timing.passed});
              if(!timing.passed)continue;
              selected={
                hypothesis:{kind:'corner',name:'ai-boundary/360-quad-'+turn*90,
                  markers:primary},
                perspective:{corrected:color,correctedDataUrl:'',
                  transform:null,success:true},
                gray,canvas:trial,qr,check:timing,rotated:turn===2
              };
              keep=true;aiStatus='verified-360-quad';
              logger.info('perspective','Exp3.6 AI 360-degree verified',
                {turnDegrees:turn*90,timing:timing.matched});
              break;
            }catch(error){
              logger.warning('perspective','Exp3.6 AI orientation probe error',{
                turnDegrees:turn*90,error:String(error)});
            }finally{if(!keep)cleanupMats(color,gray);}
          }
          if(!selected){
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
            if(directQR.valid && directTiming.matched>aiBestTiming.matched)
              aiBestTiming={matched:directTiming.matched,left:directTiming.leftMatched,
                right:directTiming.rightMatched,turnDegrees:null};
            logger.info('perspective','AI first-warp independent landmark verification',{
              method:'ai-boundary/direct-no-second-warp',
              timing:directTiming.matched,left:directTiming.leftMatched,
              right:directTiming.rightMatched,timingPassed:directTiming.passed,
              qrFound:directQR.found,qrValid:directQR.valid,
              stripStatus:directStrip.status,stripContrast:directStrip.contrast,
              stripOrdered:directStrip.ordered,
              note:'No second homography; QR and both timing tracks remain mandatory'
            });
            if(directQR.valid&&!directTiming.passed &&
               (directTiming.leftMatched>=8||directTiming.rightMatched>=8)){
              try{
                logger.info('perspective','Exp3.7.10 AI rejected timing residuals',{
                  method:'ai-boundary/direct-no-second-warp',...diagnosticTimingResiduals(directGray,dpi)
                });
              }catch(error){logger.warning('perspective','Exp3.7.10 AI timing residual diagnostic error',{
                method:'ai-boundary/direct-no-second-warp',reason:String(error)});
              }
            }
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
                const evaluated=traceRegistration(ai.canvas,hypothesis,dpi,curveBudget,allowProvisional);
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
          } // Normal AI-first-warp checks skipped if 360° quad already verified.
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
          orientationProbes:aiOrientationProbes,qrVerifiedProbes:aiQrVerifiedProbes,
          bestTiming:aiBestTiming,
          rejections:aiRejections,durationMs:Date.now()-aiStart
        });
      }
    }
    // v3.7.11: genuinely independent DocAligner ONNX fallback, only after
    // classical and Scanic failures. AI corners NEVER approve answer reading.
    if(!selected && !options?.disableAiRecovery){
      const dualStart=Date.now(),failures:string[]=[];
      let model='none';
      for(const variant of ['fastvit','lcnet'] as const){
        try{
          onProgress?.({stage:'Second local AI geometry: '+variant,percent:58});
          const proposal=await recoverPageWithAI(loaded.canvas,(event,data)=>
            logger.info('perspective','Exp3.7.11 dual AI trace: '+event,data),variant);
          if(!proposal){failures.push(variant+':invalid-quad');continue;}
          const canvas=proposal.canvas;
          let direct:any=null,gray:any=null,keep=false;
          try{
            direct=cv.imread(canvas);gray=new cv.Mat();
            cv.cvtColor(direct,gray,cv.COLOR_RGBA2GRAY);
            const qr=decodeQRFromRegion(canvas,OMR_LAYOUT.qr.xMm,
              OMR_LAYOUT.qr.yMm,OMR_LAYOUT.qr.sizeMm,dpi);
            const timing=verifyTimingMarks(gray,dpi);
            logger.info('perspective','Exp3.7.11 second model direct gate',{
              variant,qrValid:qr.valid,confidence:proposal.confidence,
              matched:timing.matched,left:timing.leftMatched,right:timing.rightMatched,
              accepted:qr.valid&&timing.passed});
            if(qr.valid&&timing.passed){
              selected={hypothesis:{kind:'corner',name:'ai-'+variant+'/direct',
                markers:primary},perspective:{corrected:direct,correctedDataUrl:'',
                transform:null,success:true},gray,canvas,qr,check:timing,rotated:false};
              keep=true;model=variant;
            }
          }finally{if(!keep)cleanupMats(direct,gray);}
          if(selected)break;
          // Classical refinement: neural paper edges are not printed OMR markers.
          const proc=preprocessImage(canvas);let otsu:any=null;
          try{
            otsu=new cv.Mat();
            cv.threshold(proc.gray,otsu,0,255,cv.THRESH_BINARY_INV|cv.THRESH_OTSU);
            for(const variantImage of [{name:'adaptive',mat:proc.thresholded},
              {name:'otsu',mat:otsu}]){
              const corners=detectMarkers(variantImage.mat,canvas.width,canvas.height);
              const midpoints=detectMidpointMarkers(variantImage.mat,canvas.width,canvas.height);
              const candidates:Hypothesis[]=[];
              if(corners.found)candidates.push({kind:'corner',
                name:'ai-'+variant+'/corner-'+variantImage.name,markers:corners});
              if(midpoints.found)candidates.push({kind:'midpoint',
                name:'ai-'+variant+'/midpoint-'+variantImage.name,markers:midpoints});
              logger.info('perspective','Exp3.7.11 adaptive printed-marker proposals',{
                variant,threshold:variantImage.name,cornerCount:corners.count,
                midpointFound:midpoints.found,candidates:candidates.length});
              for(const hypothesis of candidates){
                warpAttempts++;
                const result=traceRegistration(canvas,hypothesis,dpi,curveBudget);
                if(result){selected=result;model=variant;break;}
              }
              if(selected)break;
            }
          }finally{cleanupMats(otsu,proc.gray,proc.blurred,proc.thresholded);}
          if(selected)break;
          failures.push(variant+':QR-or-timing-unverified');
        }catch(error){
          failures.push(variant+':'+String(error));
          logger.warning('perspective','Exp3.7.11 second model unavailable',{variant,reason:String(error)});
        }
      }
      logger.info('perspective','Exp3.7.11 dual AI rescue summary',{
        invoked:true,model,verified:Boolean(selected),failures,
        durationMs:Date.now()-dualStart,
        acceptance:'Original QR + two independently verified timing tracks only'});
    }
    if(!selected && options?.disableAiRecovery){
      logger.info('perspective','Exp3.7.4 AI recovery deliberately disabled',{
        aiModelLoaded:false,attempts:0,
        classicalRegistrationOnly:true,
        warning:'Only geometrically verified QR+timing registrations can be scored'});
    }
    // Only in the isolated 3.7.2 laboratory: fall back to independently
    // verified timing + printed fiducials after ALL strict QR attempts fail.
    // A QR-less result is PROVISIONAL, has no student identity, and cannot score.
    if(options?.qrOptionalExperiment && !selected){
      const ordered=provisionalCandidates.filter(x=>x.hypothesis.kind==='aruco'||
        x.hypothesis.kind==='midpoint'||x.hypothesis.kind==='fusion')
        .concat(provisionalCandidates.filter(x=>x.hypothesis.kind==='corner'));
      logger.info('perspective','Exp3.7.2 QR-optional fallback started',{
        available:ordered.length,limit:10,
        requirement:'48/50 timing, at least 23 per side, independent geometric landmark evidence',
        identity:'unverified',scoringAllowed:false});
      for(const x of ordered.slice(0,10)){
        const provisionalCandidate=traceRegistration(x.source,x.hypothesis,dpi,
          {remaining:0},true);
        if(!provisionalCandidate)continue;
        if(!provisionalCandidate.provisional || provisionalCandidate.qr.valid){
          disposeAlignment(provisionalCandidate);
          continue;
        }
        selected=provisionalCandidate;
        logger.warning('perspective','Exp3.7.2 QR-optional geometry accepted PROVISIONALLY',{
          method:x.hypothesis.name,timing:selected.check.matched,
          left:selected.check.leftMatched,right:selected.check.rightMatched,
          studentIdentityVerified:false,scoringAllowed:false});
        break;
      }
    }
    finishStage('registration');
    logger.info('qrDecoding','Exp3.7.3 QR processing accounting',{
      hypothesisQrMs:registrationAttempts.reduce((sum,a)=>sum+(a.qrMs??0),0),
      hypothesisQrProbes:registrationAttempts.filter(a=>a.qrMs!==undefined).length,
      originalQrLocatorMs,boundaryQrMs:Math.round(boundaryQrMs),
      boundaryQrAttempts,
      note:'Does not include AI direct-region and internal orientation probes; lower bound of QR processing time'
    });
    if(!selected){
      const byPhase:Record<string,number>={};
      for(const a of registrationAttempts){
        const key=a.phase+':'+(a.qrValid?'qr-valid':'qr-invalid');
        byPhase[key]=(byPhase[key]??0)+1;
      }
      logger.warning('perspective','Exp3.7.3 failed registration taxonomy',{
        attempts:registrationAttempts.length,byPhase,
        strongestTiming:[...registrationAttempts]
          .sort((a,b)=>b.timing-a.timing).slice(0,8)
          .map(a=>({method:a.method,phase:a.phase,reason:a.reason,
            qrValid:a.qrValid,timing:a.timing,left:a.left,right:a.right,
            qrMs:a.qrMs,warpMs:a.warpMs})),
        sourceQrDecoded:photoQr?.valid??false,
        rejectionNotAutomaticallyBlamedOnQr:true
      });
    }
    logger.info('perspective','v2.5.2 registration candidates complete',{
      total:registrationAttempts.length,
      accepted:registrationAttempts.filter(a=>a.accepted).length,
      candidates:registrationAttempts,
      candidateMs:registrationAttempts.reduce((sum,a)=>sum+a.durationMs,0),
      note:'Attempts include fallback and AI variants; per-attempt timing includes QR, timing, and correction checks'
    });
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
      if(!options?.compact)images.perspectiveCorrected = chosen.canvas.toDataURL('image/png');
      if(!options?.compact && arucoAdaptive.found)images.markerOverlay=generateArucoOverlay(
        loaded.canvas,arucoAdaptive,registrationMethod,alignmentMatched,
        chosen.hypothesis.kind==='midpoint'?chosen.hypothesis.markers:undefined);
      else if(!options?.compact && chosen.hypothesis.kind==='corner')
        images.markerOverlay=generateMarkerOverlay(loaded.canvas,chosen.hypothesis.markers);
      else if(!options?.compact && chosen.hypothesis.kind==='midpoint')
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
      const proofMeshEnabled=options?.proofmesh ?? experimentalParams.get('proofmesh')==='1';
      const proofModelEnabled=options?.proofmodel ?? experimentalParams.get('proofmodel')==='1';
      let activeGridOffset=(q:number)=>offsetForQuestion(grid,q);
      let rawAnswers=detectAllAnswers(chosen.gray,dpi,inkCeiling??undefined,
        activeGridOffset,rawInkThreshold);
      const excludedInkQuestions=new Set(rawAnswers.filter(row=>
        row.measurements.some(m=>m.fillPercent>=15)).map(row=>row.question));
      const meshStart=Date.now();
      const verifiedMesh=proofMeshEnabled
        ?validateLocalMesh(chosen.gray,dpi,grid,excludedInkQuestions):null;
      const meshMs=Date.now()-meshStart;
      const adoptedMesh=proofMeshEnabled&&verifiedMesh?.accepted===true;
      if(adoptedMesh){
        activeGridOffset=(q:number)=>verifiedMesh?.predicted[q]??offsetForQuestion(grid,q);
        rawAnswers=detectAllAnswers(chosen.gray,dpi,inkCeiling??undefined,
          activeGridOffset,rawInkThreshold);
      }
      logger.info('perspective','v2.5.2 withheld-print-validated local mesh',{
        requested:proofMeshEnabled,ran:verifiedMesh!==null,
        accepted:verifiedMesh?.accepted??false,adopted:adoptedMesh,
        heldOutCount:verifiedMesh?.heldOutCount??null,
        referenceScore:verifiedMesh?.referenceScore??null,
        candidateScore:verifiedMesh?.candidateScore??null,
        relativeGain:verifiedMesh?.relativeGain??null,
        maxDisplacementPx:verifiedMesh?.maxDisplacementPx??null,
        reason:verifiedMesh?.reason??'Checkbox disabled; mesh evaluation skipped',
        rejectionBreakdown:verifiedMesh?.rejectionBreakdown??null,
        durationMs:meshMs,
        note:'Candidate based only on printed rings; cannot override QR identity'
      });
      const ringEnabled=options?.answerCentricRings ?? true;
      const ringStart=Date.now();
      const ringRecovery=ringEnabled?refineQuestionRings(chosen.gray,dpi,activeGridOffset):null;
      const ringMs=Date.now()-ringStart;
      if(ringRecovery&&ringRecovery.adopted>0){
        const prior=activeGridOffset;
        activeGridOffset=(q:number)=>ringRecovery.offsets[q]??prior(q);
      }
      logger.info('perspective','Exp3.8 heldout per-question printed-ring localisation',{
        enabled:ringEnabled,adopted:ringRecovery?.adopted??0,
        rejected:ringRecovery?.rejected??50,meanHoldoutGain:ringRecovery?.meanHoldoutGain??0,
        maxDisplacement:ringRecovery?.maxDisplacement??0,
        questions:ringRecovery?.checks??[],durationMs:ringMs,
        note:'Fit A/C rings, validate B/D rings. No grade may be inferred from geometry confidence.'
      });
      if(ringRecovery?.adopted){
        rawAnswers=detectAllAnswers(chosen.gray,dpi,inkCeiling??undefined,
          activeGridOffset,rawInkThreshold);
      }
      // Independent original-source photometry is a comparison measurement
      // rather than an automatic change to the strict bubble classifier.
      const sourceProbeEnabled=options?.sourceInkProbe??true;
      const sourceProbe=sourceProbeEnabled?
        probeSourceInk(loaded.canvas,
          /^(corner\/|midpoint\/|aruco\/|fusion\/|hybrid\/)/.test(registrationMethod??'')
            ?chosen.perspective.transform:null,dpi,activeGridOffset):null;
      logger.info('bubbleDetection','Exp3.8 original-pixel ink contrast audit',{
        enabled:sourceProbeEnabled,supported:sourceProbe?.supported??false,
        reason:sourceProbe?.reason??'disabled',sampled:sourceProbe?.sampled??0,
        valid:sourceProbe?.valid??0,measurements:sourceProbe?.measurements??[],
        gradingUnchanged:true
      });
      // v3.7.11: small translation probes identify unstable bubble decisions.
      // Diagnostic ONLY; do not infer across photographs or rewrite grades.
      const shifts=[{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
      const alternatives=shifts.map(delta=>detectAllAnswers(chosen.gray,dpi,
        inkCeiling??undefined,q=>{const v=activeGridOffset(q);
          return {dx:v.dx+delta.dx,dy:v.dy+delta.dy};},rawInkThreshold));
      const unstable=rawAnswers.flatMap((row,i)=>{
        const disagreements=alternatives.map(a=>a[i]).filter(a=>
          a.status!==row.status||a.detectedAnswer!==row.detectedAnswer);
        return disagreements.length>=2?[{question:row.question,
          original:row.detectedAnswer,originalStatus:row.status,
          shiftsDisagree:disagreements.length,
          alternatives:disagreements.map(a=>({answer:a.detectedAnswer,status:a.status}))}]:[];
      });
      logger.info('bubbleDetection','Exp3.7.11 local bubble consistency probe',{
        shifts,unstableCount:unstable.length,unstableQuestions:unstable,
        policy:'Diagnostic only: never auto-select by consensus; strict rejects unchanged'
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
      const proofEnabled = options?.proofscan ?? experimentalParams.get('proofscan')==='1';
      logger.info('bubbleDetection','User-selected scan controls',{
        geometry:'QR + corner + timing verification mandatory',
        proofscan:proofEnabled,proofmodel:proofModelEnabled,proofmesh:proofMeshEnabled,
        source:options?'website checkboxes':'URL query parameters'
      });
      const experimentalModelStart=Date.now();
      const proofs=proofEnabled?answers.map(row=>auditBubbleDecision(row,
        activeGridOffset(row.question),rawAnswers.find(raw=>raw.question===row.question))):[];
      const latent=proofModelEnabled?fitMaskedLatentPredictor(answers):null;
      logger.info('bubbleDetection','v2.5.2 masked latent template predictor',{
        enabled:proofModelEnabled,ran:latent!==null,
        ...(latent??{}),
        reason:latent===null?'Model checkbox disabled; skipped':'Online blank-region prediction',
        note:'Self-supervised predictor trained on current-sheet blank features; not full JEPA, never auto-grades'
      });
      const learnedProposals=proofModelEnabled?answers.flatMap(row=>{
        const m=[...row.measurements].sort((a,b)=>b.fillPercent-a.fillPercent)[0];
        if(!m||m.fillPercent<18||row.status==='multiple')return [];
        const prediction=predictSyntheticDecision(m);
        return [{question:row.question,option:m.option,
          opticalStatus:row.status,modelLabel:prediction.label,
          margin:Number(prediction.margin.toFixed(3)),
          scoreSolid:Number(prediction.scores.solid.toFixed(3))}];
      }):[];
      const modelReview=new Set(learnedProposals.filter(p=>
        p.opticalStatus==='detected'&&p.modelLabel!=='solid'&&
        p.margin>=0.20&&p.scoreSolid<0.30).map(p=>p.question));
      logger.info('bubbleDetection','v2.5.2 synthetic-trained closed-set head',{
        enabled:proofModelEnabled,ran:proofModelEnabled,
        model:SYNTHETIC_MODEL_INFO,durationMs:Date.now()-experimentalModelStart,
        proposals:learnedProposals,acceptedReviewCandidates:[...modelReview],
        note:'Uncalibrated synthetic-only model; no automatic promotion of rejected ink'
      });
      const reviewProofs=proofs.filter(p=>p.action==='review');
      // Only ambiguous or previously accepted ink gets the 15 tiny
      // local counterfactuals; blank 0%-ink rows do no extra work.
      const localProofStart=Date.now();
      const localVisualProofs=proofEnabled?answers.flatMap(row=>{
        const top=[...row.measurements].sort((a,b)=>b.fillPercent-a.fillPercent)[0];
        if(!top||top.fillPercent<35||row.status==='multiple')return [];
        if(top.sampleXPx===undefined||top.sampleYPx===undefined||
           top.inkThreshold===undefined)return [];
        const proof=inspectLocalBubble(chosen.gray,top.sampleXPx,
          top.sampleYPx,dpi,top.inkThreshold);
        return proof.available?[{question:row.question,option:top.option,
          status:row.status,fill:top.fillPercent,...proof}]:[];
      }):[];
      // Counterfactual failure only demotes an already accepted answer in
      // explicit experimental mode. Deliberate partial marks remain blank.
      const unstableAccepted=new Set(localVisualProofs.filter(p=>
        p.status==='detected'&&!p.stable&&p.spread>=35&&p.minFill<45)
        .map(p=>p.question));
      if(proofEnabled||proofModelEnabled){
        const lookup=new Map(proofs.map(p=>[p.question,p]));
        answers=answers.map(row=>{
          const audit=lookup.get(row.question);
          const reviewed=proofEnabled&&audit
            ?applyDecisionReview(row,audit,true):row;
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
        localCounterfactualDurationMs:Date.now()-localProofStart,
        opticalAuditRan:proofEnabled,
        unstableAccepted:[...unstableAccepted],
        localVisualProofs,
        reviewCandidates:reviewProofs.map(p=>({
          question:p.question,option:p.option,markClass:p.markClass,
          reason:p.reason,evidence:p.evidence
        })),
        note:'Synthetic model is trained but uncalibrated; only suspicious accepted marks can be demoted, never auto-promoted'
      });
      finishStage('toneCorrectionAndConsensus');
      logger.info('bubbleDetection',
        `Detected ${answers.filter(a => a.status === 'detected').length}/50 answers`);
      if(!options?.compact)images.bubbleOverlay = generateBubbleOverlay(
        chosen.canvas, answers, { tens: detectedId.tens, units: detectedId.units }, dpi, idOffset
      );
      if(!options?.compact && (proofEnabled||proofModelEnabled)){
        const contact=makeReviewCropSheet(chosen.canvas,answers);
        if(contact){
          images.reviewCrops=contact.dataUrl;
          logger.info('bubbleDetection','v2.5.2 diagnostic review crops',{
            count:contact.questions.length,questions:contact.questions,
            note:'Registered-image crops, not ground truth; no scoring effect'
          });
        }
      }
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
