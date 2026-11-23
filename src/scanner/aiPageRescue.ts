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
type QuadscanResult={
  success:boolean;confidence:number|null;
  corners:{topLeft:Point;topRight:Point;bottomRight:Point;bottomLeft:Point}|null;
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
function loadDetector():Promise<QuadscanCtor>{
  const existing=exportedDetector();
  if(existing)return Promise.resolve(existing);
  if(loader)return loader;
  loader=new Promise<QuadscanCtor>((resolve,reject)=>{
    const el=document.createElement('script');
    el.src=SCRIPT;el.async=true;
    el.onload=()=>exportedDetector()?resolve(exportedDetector()!):
      reject(new Error('Local AI runtime loaded without constructor export: '+SCRIPT));
    el.onerror=()=>reject(new Error('Local AI runtime asset unavailable: '+SCRIPT));
    document.head.appendChild(el);
  }).catch(err=>{loader=null;throw err;});
  return loader;
}
export interface AiPageRescue {
  canvas:HTMLCanvasElement;
  confidence:number;
  corners:Point[];
}
export async function recoverPageWithAI(source:HTMLCanvasElement):Promise<AiPageRescue|null>{
  const Detector=await loadDetector();
  const detector=new Detector({model:'lcnet',modelUrl:MODEL,wasmPaths:WASM,executionProviders:['wasm']});
  const result=await detector.scan(source,{mode:'detect',minDetectionConfidence:.35});
  if(!result.success||!result.corners||!result.confidence ||
    result.confidence<.35)return null;
  const pts=[
    result.corners.topLeft,result.corners.topRight,
    result.corners.bottomRight,result.corners.bottomLeft,
  ];
  if(!plausiblePageBoundary(pts,source.width,source.height))return null;
  const ordered=orderPageCorners(pts);
  if(!ordered)return null;
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
    return {canvas,confidence:result.confidence,corners:ordered};
  }finally{
    for(const m of [src,srcPoints,dstPoints,warp,out])
      try{m?.delete?.();}catch{/* OpenCV cleanup */}
  }
}
