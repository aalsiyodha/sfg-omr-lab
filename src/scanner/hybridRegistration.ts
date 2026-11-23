/** Failure-only hybrid registration: two identified ArUco anchors and two
 * independently detected corner squares. Neither family is trusted alone.
 * The caller must separately verify QR identity and both timing tracks.
 */
import type { MarkerDetectionResult } from '../types';
import type { ArucoRegistration } from './arucoDetector';
import { ARUCO_MARKERS_MM } from './arucoDetector';
import { OMR_LAYOUT, mmToPx } from '../config/omrLayout';
import { getSettings } from '../config/scannerSettings';
import type { PerspectiveResult } from './perspectiveCorrection';
declare const cv:any;
type Point={x:number;y:number};
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
export function hybridAnchorEvidence(corners:MarkerDetectionResult,aruco:ArucoRegistration):{
  usable:boolean;reason:string;imagePoints:Point[];templateMm:Point[];
}{
  if(!corners.found||!corners.topLeft||!corners.topRight)
    return {usable:false,reason:'top-corner-squares-unavailable',imagePoints:[],templateMm:[]};
  const ids=[2,3] as const;
  if(ids.some(id=>!aruco.points[id]))
    return {usable:false,reason:'bottom-aruco-pair-unavailable',imagePoints:[],templateMm:[]};
  const {topLeft,topRight}=corners;
  const bottomLeft=aruco.points[2],bottomRight=aruco.points[3];
  const imagePoints=[topLeft,topRight,bottomRight,bottomLeft];
  const topWidth=distance(topLeft,topRight);
  const bottomWidth=distance(bottomLeft,bottomRight);
  const leftLength=distance(topLeft,bottomLeft);
  const rightLength=distance(topRight,bottomRight);
  const cross=(a:Point,b:Point,c:Point)=>
    (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const convex=imagePoints.every((p,i)=>cross(p,imagePoints[(i+1)%4],imagePoints[(i+2)%4])>0);
  const distinct=imagePoints.every((p,i)=>imagePoints.every((q,j)=>i===j||distance(p,q)>12));
  const plausible=convex && distinct && topWidth>50 && bottomWidth>40 &&
    leftLength>100 && rightLength>100 &&
    Math.max(topWidth,bottomWidth)/Math.min(topWidth,bottomWidth)<3.5 &&
    Math.max(leftLength,rightLength)/Math.min(leftLength,rightLength)<2.5;
  const centre=(p:{xMm:number;yMm:number;sizeMm:number}):Point=>({
    x:p.xMm+p.sizeMm/2,y:p.yMm+p.sizeMm/2
  });
  const ml=OMR_LAYOUT.markers;
  const templateMm=[centre(ml.topLeft),centre(ml.topRight),
    ARUCO_MARKERS_MM.find(m=>m.id===3)!,ARUCO_MARKERS_MM.find(m=>m.id===2)!];
  return {usable:plausible,
    reason:plausible?'four-independent-cross-family-anchors':'implausible-hybrid-anchor-geometry',
    imagePoints,templateMm};
}
export function correctPerspectiveFromHybrid(
  source:HTMLCanvasElement,corners:MarkerDetectionResult,aruco:ArucoRegistration
):PerspectiveResult {
  const evidence=hybridAnchorEvidence(corners,aruco);
  if(!evidence.usable)return {corrected:null,correctedDataUrl:'',transform:null,
    success:false,error:evidence.reason};
  let src:any=null,input:any=null,output:any=null,transform:any=null,corrected:any=null;
  try{
    const dpi=getSettings().scanDpi;
    src=cv.imread(source);
    input=cv.matFromArray(4,1,cv.CV_32FC2,
      evidence.imagePoints.flatMap(p=>[p.x,p.y]));
    output=cv.matFromArray(4,1,cv.CV_32FC2,
      evidence.templateMm.flatMap(p=>[mmToPx(p.x,dpi),mmToPx(p.y,dpi)]));
    transform=cv.getPerspectiveTransform(input,output);
    corrected=new cv.Mat();
    const w=Math.round(mmToPx(OMR_LAYOUT.page.widthMm,dpi));
    const h=Math.round(mmToPx(OMR_LAYOUT.page.heightMm,dpi));
    cv.warpPerspective(src,corrected,transform,new cv.Size(w,h));
    const canvas=document.createElement('canvas');
    canvas.width=w;canvas.height=h;cv.imshow(canvas,corrected);
    return {corrected,correctedDataUrl:canvas.toDataURL('image/png'),transform,success:true};
  }catch(error){
    corrected?.delete?.();transform?.delete?.();
    return {corrected:null,correctedDataUrl:'',transform:null,success:false,error:String(error)};
  }finally{
    for(const m of [src,input,output])try{m?.delete?.();}catch{/* WASM cleanup */}
  }
}
