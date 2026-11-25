import { loadImageFromFile, validateImage } from '../scanner/imageLoader';
import { preprocessImage, cleanupMats, checkOpenCV } from '../scanner/imagePreprocessor';
import { detectMarkers } from '../scanner/markerDetector';
import { proposeSheetCorners } from './sheetIdCornerCandidates';
import type { MarkerDetectionResult } from '../types';
import { correctPerspective } from '../scanner/perspectiveCorrection';
import { measureTimingTrack, type TimingTrack } from './sheetIdTiming';
import { measureGrayCalibration, grayStripInkCeiling } from '../scanner/grayCalibration';
import { estimateGridAlignment, offsetForQuestion } from '../scanner/gridAlignment';
import { detectAllAnswers, detectTestId } from '../scanner/bubbleDetector';
import { decodeSheetFooter, type FooterEvidence } from './sheetIdDecoder';
import { getSettings } from '../config/scannerSettings';
import { OMR_LAYOUT } from '../config/omrLayout';
import type { QuestionResult } from '../types';
declare const cv:any;

export interface SheetIdScanReport {
  elapsedMs:number;
  stages:Record<string,number>;
  status:'verified'|'rejected';
  reason:string;
  sheet:FooterEvidence|null;
  registration:'corner/adaptive'|'corner/footer-rescue'|null;
  cornerAttempts:Array<{method:string;centres:number[][];footerBits:string;leftBox:boolean;rightBox:boolean;timing:number|null;reason:string}>;
  timingGeometry:{maxShiftPx:number;rows:Array<{row:number;left:{dx:number;dy:number}|null;right:{dx:number;dy:number}|null}>}|null;
  rotated180:boolean;
  timing:{matched:number;left:number;right:number}|null;
  testId:number|null;
  answers:QuestionResult[];
  detected:number;blank:number;multiple:number;uncertain:number;
  overlayUrl:string|null;
}
export async function scanSheetId50(file:File):Promise<SheetIdScanReport>{
 const start=performance.now(),stages:Record<string,number>={};
 let last=start;
 const stage=(name:string)=>{const now=performance.now();stages[name]=Math.round(now-last);last=now;};
 let prep:ReturnType<typeof preprocessImage>|null=null;
 let persp:ReturnType<typeof correctPerspective>|null=null;
 let gray:any=null;
 let sheet:FooterEvidence|null=null;
 let timing:TimingTrack|null=null;
 let rotated180=false;
 const cornerAttempts:SheetIdScanReport['cornerAttempts']=[];
 let registration:SheetIdScanReport['registration']=null;
 const empty=(reason:string):SheetIdScanReport=>({
  elapsedMs:Math.round(performance.now()-start),stages,status:'rejected',
  reason,sheet,registration,rotated180,cornerAttempts,timing:timing?
  {matched:timing.matched,left:timing.left,right:timing.right}:null,
  testId:null,answers:[],detected:0,blank:0,multiple:0,uncertain:0,overlayUrl:null,
  timingGeometry:timing?{maxShiftPx:timing.maxShiftPx,rows:timing.rows}:null
 });
 try{
  if(!checkOpenCV())return empty('OpenCV not ready');
  const img=await loadImageFromFile(file);
  stage('imageDecode');
  const valid=validateImage(img);
  if(!valid.valid)return empty(valid.errors.join('; '));
  prep=preprocessImage(img.canvas);
  stage('preprocessing');
  const corners=detectMarkers(prep.thresholded,img.width,img.height);
  stage('cornerDetection');
  const dpi=getSettings().scanDpi;
  // The legacy finder can choose dark objects in the background or a bottom
  // grayscale calibration square instead of the printed page corner. A
  // plausible quadrilateral is not proof: cross-verify the encoded footer
  // and both timing tracks before adopting any registration candidate.
  const fallback=proposeSheetCorners(prep.thresholded,img.width,img.height,20);
  stage('cornerProposals');
  const hypotheses:{method:'corner/adaptive'|'corner/footer-rescue';markers:MarkerDetectionResult}[]=[];
  if(corners.found)hypotheses.push({method:'corner/adaptive',markers:corners});
  for(const candidate of fallback){
   const centre=(m:{x:number;y:number}|null)=>m?[m.x,m.y]:[0,0];
   const coords=(m:MarkerDetectionResult)=>[
    centre(m.topLeft),centre(m.topRight),centre(m.bottomLeft),centre(m.bottomRight)
   ];
   const signature=JSON.stringify(coords(candidate.markers));
   if(hypotheses.some(h=>JSON.stringify(coords(h.markers))===signature))continue;
   hypotheses.push({method:'corner/footer-rescue',markers:candidate.markers});
  }
  let chosen=false;
  for(const h of hypotheses){
   let candidate:ReturnType<typeof correctPerspective>|null=null;
   let candidateGray:any=null;
   let candidateTiming:TimingTrack|null=null;
   let candidateSheet:FooterEvidence|null=null;
   let candidateRotated=false;
   let accepted=false;
   let failureError:string|null=null;
   const centre=(p:{x:number;y:number}|null)=>p?[p.x,p.y]:[0,0];
   const centres=[h.markers.topLeft,h.markers.topRight,
    h.markers.bottomLeft,h.markers.bottomRight].map(centre);
   try{
    candidate=correctPerspective(img.canvas,h.markers);
    if(!candidate.success||!candidate.corrected)continue;
    candidateGray=new cv.Mat();
    cv.cvtColor(candidate.corrected,candidateGray,cv.COLOR_RGBA2GRAY);
    candidateSheet=decodeSheetFooter(candidateGray,dpi);
    if(!candidateSheet.valid){
      cv.rotate(candidate.corrected,candidate.corrected,cv.ROTATE_180);
      cv.cvtColor(candidate.corrected,candidateGray,cv.COLOR_RGBA2GRAY);
      const reversed=decodeSheetFooter(candidateGray,dpi);
      if(reversed.valid){candidateSheet=reversed;candidateRotated=true;}
      else {
        cv.rotate(candidate.corrected,candidate.corrected,cv.ROTATE_180);
        cv.cvtColor(candidate.corrected,candidateGray,cv.COLOR_RGBA2GRAY);
      }
    }
    if(!candidateSheet.valid||candidateSheet.count!==50)continue;
    candidateTiming=measureTimingTrack(candidateGray,dpi);
    if(!candidateTiming.valid)continue;
    // All three checks are independent: four-corner warp, two hollow boxes
    // with exact codeword, and 25 timing locations on EACH side.
    persp=candidate;candidate=null;
    gray=candidateGray;candidateGray=null;
    sheet=candidateSheet;timing=candidateTiming;rotated180=candidateRotated;
    registration=h.method;
    chosen=true;accepted=true;
    break;
   }catch(error){
    failureError=String(error);
   }finally{
    cornerAttempts.push({method:h.method,centres,
      footerBits:candidateSheet?.bits??'',
      leftBox:candidateSheet?.leftBox??false,
      rightBox:candidateSheet?.rightBox??false,
      timing:candidateTiming?.matched??null,
      reason:accepted?'Verified QR-free sheet geometry':
        failureError??(candidateSheet?.valid?
          'Footer valid; timing geometry failed: '+candidateTiming?.reason:
          candidateSheet?.reason??'Warp could not be verified')});
    cleanupMats(candidateGray,candidate?.corrected,candidate?.transform);
   }
  }
  stage('registrationAndFooter');
  if(!chosen||!persp||!persp.corrected||!timing||!gray||!sheet){
   // Preserve the best available rejection evidence for diagnostics.
   const last=cornerAttempts.at(-1);
   return empty('No candidate independently verified footer + 48/50 timing. '+
     (last?.reason??corners.error??'Four corners unavailable'));
  }
  const verifiedTiming=timing;
  const calibration=measureGrayCalibration(gray,dpi);
  const inkCeiling=grayStripInkCeiling(calibration)??undefined;
  stage('calibration');
  const grid=estimateGridAlignment(gray,dpi);
  stage('localGrid');
  const tid=detectTestId(gray,dpi,inkCeiling,grid.testId);
  stage('testId');
  const answers=detectAllAnswers(gray,dpi,inkCeiling,q=>{
    const xMm=q<=25?OMR_LAYOUT.answers.col1.bubbleStartX:
      OMR_LAYOUT.answers.col2.bubbleStartX;
    // Use measured printed side timing markers as geometry anchors rather
    // than forcing the answer grid to follow an imperfect global homography.
    // The existing bubble-shape classifier is otherwise unchanged.
    const marker=verifiedTiming.offsetForQuestion(q,xMm);
    return marker;
  });
  stage('answers');
  // No student identity on this template: this prototype never submits/scorers.
  const canvas=document.createElement('canvas');
  canvas.width=persp.corrected.cols;canvas.height=persp.corrected.rows;
  cv.imshow(canvas,persp.corrected);
  const overlayUrl=canvas.toDataURL('image/jpeg',.85);
  stage('preview');
  return {
   elapsedMs:Math.round(performance.now()-start),stages,
   status:tid.testId===null?'rejected':'verified',
   reason:tid.testId===null?'Test ID bubbles ambiguous or blank':'Footer, 4 corners and both timing tracks verified',
   sheet,registration,rotated180,cornerAttempts,
   timingGeometry:{maxShiftPx:timing.maxShiftPx,rows:timing.rows},
   timing:{matched:timing.matched,left:timing.left,right:timing.right},
   testId:tid.testId,answers,overlayUrl,
   detected:answers.filter(a=>a.status==='detected').length,
   blank:answers.filter(a=>a.status==='blank').length,
   multiple:answers.filter(a=>a.status==='multiple').length,
   uncertain:answers.filter(a=>a.status==='uncertain').length
  };
 }catch(error){return empty('Scanner exception: '+String(error));}
 finally{
  cleanupMats(gray,persp?.corrected,persp?.transform,
    prep?.gray,prep?.blurred,prep?.thresholded);
 }
}
