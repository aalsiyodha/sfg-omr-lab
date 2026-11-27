/** v2.3.48: bounded, failure-only SimCC / DocCornerNet document detection.
 * Pinned Scanic 1.8.0, model scanic-ml 0.2.0. Runs entirely locally in WASM.
 * AI only suggests geometry. Existing QR + timing verification still mandatory.
 */
import { OMR_LAYOUT, mmToPx } from '../config/omrLayout';
import { getSettings } from '../config/scannerSettings';
import { plausiblePageBoundary, orderPageCorners } from './pageBoundaryRecovery';
declare const cv:any;
type Point={x:number;y:number};
export type Trace=(event:string,data:Record<string,unknown>)=>void;
type Detection={success:boolean;message:string;corners:{
 topLeft:Point;topRight:Point;bottomRight:Point;bottomLeft:Point}|null;
 score?:number|null;confidence?:number|null;timings?:Array<{step:string;ms:string}>};
type ScanicModule={scanDocument:(canvas:HTMLCanvasElement,options:{
  detector:'ml';mode:'detect';ml:{assetBaseUrl:string;minScore:number;numThreads:number}
})=>Promise<Detection>};
type Candidate={corners:Point[];score:number;canvas:HTMLCanvasElement;variant:string};
let modulePromise:Promise<ScanicModule>|null=null;
const base=import.meta.env.BASE_URL;
const moduleUrl='npm:scanic@1.8.0 (lazy Vite chunk)';
const assetBase=base+'ai-model/scanic/';
const clk=()=>performance.now();
async function loadModelRuntime(trace:Trace):Promise<ScanicModule>{
  const t=clk(),cached=Boolean(modulePromise);
  trace('scanic-runtime-load-start',{url:moduleUrl,cacheHit:cached,
    reason:'Bundled npm module avoids missing GitHub Pages ai-runtime/scanic.js'});
  if(!modulePromise)modulePromise=import('scanic') as unknown as Promise<ScanicModule>;
  try{
    const runtime=await modulePromise;
    if(typeof runtime.scanDocument!=='function')throw Error('scanic ESM export missing scanDocument');
    trace('scanic-runtime-ready',{elapsedMs:Math.round(clk()-t),cached});
    return runtime;
  }catch(error){modulePromise=null;throw error;}
}
function enhancedCanvas(source:HTMLCanvasElement):HTMLCanvasElement{
  const canvas=document.createElement('canvas');
  canvas.width=source.width;canvas.height=source.height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx)throw Error('Canvas 2D unavailable');
  ctx.drawImage(source,0,0);
  const image=ctx.getImageData(0,0,canvas.width,canvas.height);
  const bytes=image.data;
  // Midtone illumination correction: bounded contrast + mild gamma.
  // Keeps sheet corners in-frame and cannot invent missing image pixels.
  const histogram=new Uint32Array(256);
  for(let i=0;i<bytes.length;i+=4)
    histogram[Math.min(255,Math.round(.2126*bytes[i]+.7152*bytes[i+1]+.0722*bytes[i+2]))]++;
  const total=canvas.width*canvas.height;
  let cum=0,lo=0,hi=255;
  for(let i=0;i<256;i++){cum+=histogram[i];if(cum>=total*.02){lo=i;break;}}
  cum=0;
  for(let i=255;i>=0;i--){cum+=histogram[i];if(cum>=total*.02){hi=i;break;}}
  if(hi-lo<40)return canvas;
  const scale=Math.min(1.65,255/(hi-lo));
  for(let i=0;i<bytes.length;i+=4){
    for(let c=0;c<3;c++){
      const scaled=(bytes[i+c]-lo)*scale;
      bytes[i+c]=Math.max(0,Math.min(255,Math.round(scaled)));
    }
  }
  ctx.putImageData(image,0,0);return canvas;
}
function cropCanvas(source:HTMLCanvasElement):{canvas:HTMLCanvasElement;offset:Point}{
  const x=Math.round(source.width*.035),y=Math.round(source.height*.035);
  const canvas=document.createElement('canvas');
  canvas.width=source.width-2*x;canvas.height=source.height-2*y;
  canvas.getContext('2d')?.drawImage(source,x,y,canvas.width,canvas.height,0,0,canvas.width,canvas.height);
  return {canvas,offset:{x,y}};
}
export interface ScanicRescue{
 canvas:HTMLCanvasElement;corners:Point[];confidence:number;
 variant:string;allCandidates:Array<{variant:string;score:number;corners:Point[];geometryValid:boolean}>;
}
/** QR is an independent source-photo location cue, never a scoring gate. */
export async function recoverPageWithScanic(source:HTMLCanvasElement,trace:Trace,
  options?:{sourceQrCenter?:Point|null}
):Promise<ScanicRescue|null>{
 const started=clk();
 trace('scanic-config',{model:'DocCornerNet SimCC',scanicVersion:'1.8.0',
   assetVersion:'scanic-ml@0.2.0',modelInput:[224,224],
   fullPhotoSize:[source.width,source.height],runtime:moduleUrl,
   modelBase:assetBase,strictScoreFloor:.5,maxVariants:3});
 const runtime=await loadModelRuntime(trace);
 const candidates:Candidate[]=[];
 const sourceQrCenter=options?.sourceQrCenter??null;
 const insideQuad=(points:Point[],p:Point):boolean=>{
   if(points.length!==4)return false;
   let positive=false,negative=false;
   for(let i=0;i<4;i++){
     const a=points[i],b=points[(i+1)%4];
     const value=(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
     if(value>1)positive=true;if(value< -1)negative=true;
   }
   return !(positive&&negative);
 };
 const allCandidates:ScanicRescue['allCandidates']=[];
 const crop=cropCanvas(source);
 const variants=[
   {name:'original',canvas:source,offset:{x:0,y:0}},
   {name:'contrast-normalized',canvas:enhancedCanvas(source),offset:{x:0,y:0}},
   {name:'center-crop-93-percent',canvas:crop.canvas,offset:crop.offset},
 ];
 for(const v of variants){
   const t=clk();
   try{
     // Score floor zero retains low-confidence geometry for diagnostics.
     // Safety gate .5 and geometric/QR/timing verification are applied later.
     const result=await runtime.scanDocument(v.canvas,{detector:'ml',mode:'detect',
       ml:{assetBaseUrl:assetBase,minScore:0,numThreads:1}});
     const points=result.corners?[
       result.corners.topLeft,result.corners.topRight,
       result.corners.bottomRight,result.corners.bottomLeft
     ].map(p=>({x:p.x+v.offset.x,y:p.y+v.offset.y})):[];
     const score=result.score??result.confidence??0;
     const strictGeometryValid=points.length===4&&
       plausiblePageBoundary(points,source.width,source.height);
     const qrInside=Boolean(sourceQrCenter&&insideQuad(points,sourceQrCenter));
     // Reuse the 3.7.9 bounded small-page geometry gate for local AI too.
     // It only PROPOSES a candidate if the independently decoded source QR
     // lies inside the quad. Mandatory warped QR + bilateral timing remain
     // unchanged in scanOrchestrator.
     const smallPageGeometryValid=Boolean(!strictGeometryValid&&qrInside&&
       plausiblePageBoundary(points,source.width,source.height,'small-page-rescue'));
     const geometryValid=strictGeometryValid||smallPageGeometryValid;
     trace('scanic-variant',{variant:v.name,elapsedMs:Math.round(clk()-t),
       detected:result.success,message:result.message,score,corners:points,
       geometryValid,strictGeometryValid,smallPageGeometryValid,
       sourceQrDecoded:Boolean(sourceQrCenter),qrInside,
       meetsScoreFloor:score>=.5,modelTimings:result.timings??[],
       inputCrop:v.offset,cropSize:[v.canvas.width,v.canvas.height]});
     allCandidates.push({variant:v.name,score,corners:points,geometryValid});
     if(geometryValid&&score>=.5)candidates.push({corners:points,score,canvas:v.canvas,variant:v.name});
   }catch(error){
     trace('scanic-variant-error',{variant:v.name,elapsedMs:Math.round(clk()-t),error:String(error)});
   }
 }
 candidates.sort((a,b)=>b.score-a.score);
 if(candidates.length===0){
   trace('scanic-no-acceptable-quad',{durationMs:Math.round(clk()-started),
     analyzedVariants:allCandidates.length});
   return null;
 }
 const best=candidates[0];
 const ordered=orderPageCorners(best.corners);
 if(!ordered)return null;
 const dpi=getSettings().scanDpi;
 const width=Math.round(mmToPx(OMR_LAYOUT.page.widthMm,dpi));
 const height=Math.round(mmToPx(OMR_LAYOUT.page.heightMm,dpi));
 let src:any=null,sp:any=null,dp:any=null,m:any=null,out:any=null;
 try{
   src=cv.imread(source);
   sp=cv.matFromArray(4,1,cv.CV_32FC2,ordered.flatMap(p=>[p.x,p.y]));
   dp=cv.matFromArray(4,1,cv.CV_32FC2,[0,0,width-1,0,width-1,height-1,0,height-1]);
   m=cv.getPerspectiveTransform(sp,dp);
   out=new cv.Mat();
   cv.warpPerspective(src,out,m,new cv.Size(width,height));
   const canvas=document.createElement('canvas');
   canvas.width=width;canvas.height=height;cv.imshow(canvas,out);
   trace('scanic-prewarp-created',{variant:best.variant,score:best.score,corners:ordered,
      outputSize:[width,height],totalMs:Math.round(clk()-started)});
   return {canvas,corners:ordered,confidence:best.score,variant:best.variant,allCandidates};
 }finally{
   for(const mat of [src,sp,dp,m,out])try{mat?.delete?.();}catch{}
 }
}
