import { loadImageFromFile, validateImage } from '../scanner/imageLoader';
import { preprocessImage, cleanupMats, checkOpenCV } from '../scanner/imagePreprocessor';
import { detectMarkers } from '../scanner/markerDetector';
import { correctPerspective } from '../scanner/perspectiveCorrection';
import { verifyTimingMarks } from '../scanner/alignmentValidator';
import { measureGrayCalibration, grayStripInkCeiling } from '../scanner/grayCalibration';
import { estimateGridAlignment, offsetForQuestion } from '../scanner/gridAlignment';
import { detectAllAnswers, detectTestId } from '../scanner/bubbleDetector';
import { decodeSheetFooter, type FooterEvidence } from './sheetIdDecoder';
import { getSettings } from '../config/scannerSettings';
import type { QuestionResult } from '../types';
declare const cv:any;

export interface SheetIdScanReport {
  elapsedMs:number;
  stages:Record<string,number>;
  status:'verified'|'rejected';
  reason:string;
  sheet:FooterEvidence|null;
  registration:'corner/adaptive'|null;
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
 let timing:ReturnType<typeof verifyTimingMarks>|null=null;
 let rotated180=false;
 const empty=(reason:string):SheetIdScanReport=>({
  elapsedMs:Math.round(performance.now()-start),stages,status:'rejected',
  reason,sheet,registration:null,rotated180,timing:timing?
  {matched:timing.matched,left:timing.leftMatched,right:timing.rightMatched}:null,
  testId:null,answers:[],detected:0,blank:0,multiple:0,uncertain:0,overlayUrl:null
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
  if(!corners.found)return empty(corners.error??'Four corners not verified');
  persp=correctPerspective(img.canvas,corners);
  stage('perspective');
  if(!persp.success||!persp.corrected)return empty('Perspective correction failed');
  gray=new cv.Mat();
  cv.cvtColor(persp.corrected,gray,cv.COLOR_RGBA2GRAY);
  const dpi=getSettings().scanDpi;
  sheet=decodeSheetFooter(gray,dpi);
  if(!sheet.valid){
   cv.rotate(persp.corrected,persp.corrected,cv.ROTATE_180);
   cv.cvtColor(persp.corrected,gray,cv.COLOR_RGBA2GRAY);
   const flipped=decodeSheetFooter(gray,dpi);
   if(flipped.valid){sheet=flipped;rotated180=true;}
   else {
    // Preserve original orientation for a truthful rejected trace.
    cv.rotate(persp.corrected,persp.corrected,cv.ROTATE_180);
    cv.cvtColor(persp.corrected,gray,cv.COLOR_RGBA2GRAY);
   }
  }
  stage('footerAndOrientation');
  if(!sheet.valid)return empty('Sheet footer invalid: '+sheet.reason);
  if(sheet.count!==50)return empty('This scanner currently validates only 50-question geometry');
  timing=verifyTimingMarks(gray,dpi);
  stage('timing');
  // Strict experimental gate, stronger than 35/50 routine check.
  if(timing.matched<48||timing.leftMatched<23||timing.rightMatched<23)
   return empty('Strict timing gate failed ('+timing.matched+'/50)');
  const calibration=measureGrayCalibration(gray,dpi);
  const inkCeiling=grayStripInkCeiling(calibration)??undefined;
  stage('calibration');
  const grid=estimateGridAlignment(gray,dpi);
  stage('localGrid');
  const tid=detectTestId(gray,dpi,inkCeiling,grid.testId);
  stage('testId');
  const answers=detectAllAnswers(gray,dpi,inkCeiling,q=>offsetForQuestion(grid,q));
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
   sheet,registration:'corner/adaptive',rotated180,
   timing:{matched:timing.matched,left:timing.leftMatched,right:timing.rightMatched},
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
