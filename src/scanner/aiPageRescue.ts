/** Optional last-resort ML document-corner discovery.
 * quadscan 1.0.0 uses a 4.5MB DocAligner LCNet-100 ONNX model.
 * Nothing loads until all deterministic registration and boundary recovery
 * attempts fail. This detector NEVER approves OMR answers by itself.
 */
import { OMR_LAYOUT, mmToPx } from '../config/omrLayout';
import { getSettings } from '../config/scannerSettings';
import { plausiblePageBoundary, orderPageCorners } from './pageBoundaryRecovery';
declare const cv:any;

type Point={x:number;y:number};
export type AiTrace = (event:string,data:Record<string,unknown>)=>void;
const clock=()=>performance.now();
type QuadscanResult={
  success:boolean;confidence:number|null;
  corners:{topLeft:Point & {confidence?:number};topRight:Point & {confidence?:number};bottomRight:Point & {confidence?:number};bottomLeft:Point & {confidence?:number}}|null;
  timings?:Array<{step:string;ms:number}>;
  message:string;
};
type QuadscanInstance={scan:(src:HTMLCanvasElement,options:{mode:'detect';minDetectionConfidence:number})=>Promise<QuadscanResult>};
type QuadscanCtor=new (options:{
  model:'lcnet';modelUrl:string;wasmPaths:string;executionProviders:['wasm']
})=>QuadscanInstance;
declare global {
  interface Window { Quadscan?: {Quadscan?:QuadscanCtor} | QuadscanCtor }
}
let loader:Promise<QuadscanCtor>|null=null;
const ASSET_BASE=import.meta.env.BASE_URL;
const SCRIPT=ASSET_BASE+'ai-runtime/quadscan.iife.js';
const MODEL=ASSET_BASE+'ai-model/lcnet100_h_e_bifpn_256_fp32.onnx';
const WASM=ASSET_BASE+'ai-runtime/';
function exportedDetector():QuadscanCtor|null {
  const exported=window.Quadscan;
  if(!exported)return null;
  if(typeof exported==='function')return exported as QuadscanCtor;
  return exported.Quadscan??null;
}
function loadDetector(trace?:AiTrace):Promise<QuadscanCtor>{
  const existing=exportedDetector();
  if(existing){trace?.('runtime-cache-hit',{script:SCRIPT});return Promise.resolve(existing);}
  if(loader)return loader;
  const started=clock();
  trace?.('runtime-loading',{script:SCRIPT});
  loader=new Promise<QuadscanCtor>((resolve,reject)=>{
    const el=document.createElement('script');
    el.src=SCRIPT;el.async=true;
    el.onload=()=>{trace?.('runtime-loaded',{elapsedMs:Math.round(clock()-started),hasExport:Boolean(exportedDetector())});
      return exportedDetector()?resolve(exportedDetector()!):
      reject(new Error('Local AI runtime loaded without constructor export: '+SCRIPT));};
    el.onerror=()=>reject(new Error('Local AI runtime asset unavailable: '+SCRIPT));
    document.head.appendChild(el);
  }).catch(err=>{loader=null;throw err;});
  return loader;
}
export interface AiPageRescue {
  canvas:HTMLCanvasElement;
  confidence:number;
  corners:Point[];
  cornerConfidence:Record<string,number|null>;
  timings:Array<{step:string;ms:number}>;
}
export async function recoverPageWithAI(source:HTMLCanvasElement,trace?:AiTrace):Promise<AiPageRescue|null>{
  const started=clock();
  trace?.('model-config',{library:'quadscan@1.0.0',model:'DocAligner LCNet-100',
    modelUrl:MODEL,wasmPath:WASM,executionProvider:'wasm',
    minConfidence:.35,inputWidth:source.width,inputHeight:source.height});
  const Detector=await loadDetector(trace);
  trace?.('runtime-ready',{elapsedMs:Math.round(clock()-started)});
  const detector=new Detector({model:'lcnet',modelUrl:MODEL,wasmPaths:WASM,executionProviders:['wasm']});
  let result:QuadscanResult;
  try{
    const inferenceStart=clock();
    trace?.('inference-start',{modelUrl:MODEL});
    // A zero threshold exposes the model's RAW corner heatmap peaks for diagnostics.
    // We still enforce .35 before accepting the geometry for any verification.
    result=await detector.scan(source,{mode:'detect',minDetectionConfidence:0});
    trace?.('inference-result',{elapsedMs:Math.round(clock()-inferenceStart),
      success:result.success,message:result.message,
      confidence:result.confidence,
      modelStageTimings:result.timings??[]});
  }finally{
    // The model is only needed in failure cases, never keep its memory resident.
    (detector as unknown as {dispose?:()=>void}).dispose?.();
  }
  if(!result.success||!result.corners||result.confidence===null){
    trace?.('detection-rejected',{reason:result.message,confidence:result.confidence});return null;
  }
  const pts=[
    result.corners.topLeft,result.corners.topRight,
    result.corners.bottomRight,result.corners.bottomLeft,
  ];
  const cornerConfidence=Object.fromEntries(
    Object.entries(result.corners).map(([key,value])=>[key,value.confidence??null])
  ) as Record<string,number|null>;
  const geometryOk=plausiblePageBoundary(pts,source.width,source.height);
  const meetsConfidence=result.confidence>=.35;
  trace?.('raw-model-corners',{corners:pts,confidence:result.confidence,
    cornerConfidence,requiredConfidence:.35,meetsConfidence});
  const ordered=orderPageCorners(pts);
  trace?.('corner-geometry',{points:pts,cornerConfidence,
    plausible:geometryOk,ordered:ordered??[],sourceSize:[source.width,source.height]});
  if(!geometryOk||!ordered||!meetsConfidence){
    trace?.('detection-rejected',{reason:!meetsConfidence?'below-confidence-floor':'page-geometry-rejected',
      confidence:result.confidence,requiredConfidence:.35,geometryOk});return null;
  }
  const dpi=getSettings().scanDpi;
  const width=Math.round(mmToPx(OMR_LAYOUT.page.widthMm,dpi));
  const height=Math.round(mmToPx(OMR_LAYOUT.page.heightMm,dpi));
  let src:any=null,srcPoints:any=null,dstPoints:any=null,warp:any=null,out:any=null;
  try{
    src=cv.imread(source);
    srcPoints=cv.matFromArray(4,1,cv.CV_32FC2,ordered.flatMap(p=>[p.x,p.y]));
    dstPoints=cv.matFromArray(4,1,cv.CV_32FC2,
      [0,0,width-1,0,width-1,height-1,0,height-1]);
    warp=cv.getPerspectiveTransform(srcPoints,dstPoints);
    out=new cv.Mat();
    cv.warpPerspective(src,out,warp,new cv.Size(width,height));
    const canvas=document.createElement('canvas');
    canvas.width=width;canvas.height=height;cv.imshow(canvas,out);
    trace?.('prewarp-created',{outputWidth:width,outputHeight:height,
      durationMs:Math.round(clock()-started)});
    return {canvas,confidence:result.confidence,corners:ordered,
      cornerConfidence,timings:result.timings??[]};
  }finally{
    for(const m of [src,srcPoints,dstPoints,warp,out])
      try{m?.delete?.();}catch{/* OpenCV cleanup */}
  }
}
