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
type QuadscanAPI={scan:(src:HTMLCanvasElement,options:{mode:'detect';minDetectionConfidence:number})=>Promise<QuadscanResult>};
declare global {
  interface Window { Quadscan?: QuadscanAPI }
}
let loader:Promise<QuadscanAPI>|null=null;
const SCRIPT='https://cdn.jsdelivr.net/npm/quadscan@1.0.0/dist/quadscan.iife.js';
function loadDetector():Promise<QuadscanAPI>{
  if(window.Quadscan)return Promise.resolve(window.Quadscan);
  if(loader)return loader;
  loader=new Promise<QuadscanAPI>((resolve,reject)=>{
    const el=document.createElement('script');
    el.src=SCRIPT;el.async=true;
    el.onload=()=>window.Quadscan?resolve(window.Quadscan):
      reject(new Error('Quadscan library loaded without exported API'));
    el.onerror=()=>reject(new Error('Could not download optional vision runtime'));
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
  const detector=await loadDetector();
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
