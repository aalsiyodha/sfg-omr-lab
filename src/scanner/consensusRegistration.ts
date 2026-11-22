import { OMR_LAYOUT, mmToPx } from '../config/omrLayout';
import { ARUCO_MARKERS_MM } from './arucoDetector';
import { MIDPOINTS_MM } from './midpointDetector';
import type { ArucoRegistration } from './arucoDetector';
import type { MidpointRegistration } from './midpointDetector';
import type { MarkerDetectionResult } from '../types';
import { getSettings } from '../config/scannerSettings';
import type { PerspectiveResult } from './perspectiveCorrection';
declare const cv:any;
type Point={x:number;y:number};
type Anchor={source:Point; target:Point;name:string};
export interface ConsensusInput {
  aruco:ArucoRegistration;
  corners:MarkerDetectionResult[];
  midpoints:MidpointRegistration[];
}
export interface ConsensusEvidence { total:number; chosen:number; rejected:number; inliers:number; residualPx:number; methods:string[] }
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
export const projectPoint=(matrix:number[],point:Point):Point|null=>{
  const w=matrix[6]*point.x+matrix[7]*point.y+matrix[8];
  if(!Number.isFinite(w)||Math.abs(w)<1e-8)return null;
  return {x:(matrix[0]*point.x+matrix[1]*point.y+matrix[2])/w,
    y:(matrix[3]*point.x+matrix[4]*point.y+matrix[5])/w};
};
/** Only use actual observed printed points, never ArUco extrapolations as anchors.
 * ArUco-derived 4-point warp serves as a rough reference for filtering
 * conflicting corner/midpoint detections before robust multi-point fitting.
 */
export function correctPerspectiveConsensus(src:HTMLCanvasElement,input:ConsensusInput):
  {perspective:PerspectiveResult; evidence:ConsensusEvidence}|null {
  if(!input.aruco.found||[0,1,2,3].some(id=>!input.aruco.points[id]))return null;
  if(typeof cv.findHomography!=='function')return null;
  const dpi=getSettings().scanDpi,px=(n:number)=>mmToPx(n,dpi);
  const ordered=[0,1,3,2];
  const targets=new Map(ARUCO_MARKERS_MM.map(a=>[a.id,{x:px(a.x),y:px(a.y)}]));
  const base:Anchor[]=ordered.map(id=>({name:'aruco-'+id,
    source:input.aruco.points[id],target:targets.get(id)!}));
  let roughSrc:any=null,roughDst:any=null,roughH:any=null;
  let srcMat:any=null,pointsA:any=null,pointsB:any=null,H:any=null,mask:any=null,corrected:any=null;
  try{
    roughSrc=cv.matFromArray(4,1,cv.CV_32FC2,base.flatMap(a=>[a.source.x,a.source.y]));
    roughDst=cv.matFromArray(4,1,cv.CV_32FC2,base.flatMap(a=>[a.target.x,a.target.y]));
    roughH=cv.getPerspectiveTransform(roughSrc,roughDst);
    const coefficients=Array.from(roughH.data64F ?? roughH.data32F) as number[];
    if(coefficients.length!==9)return null;
    const groups:{name:string;target:Point;candidates:Point[]}[]=[];
    const squares=OMR_LAYOUT.markers;
    for(const [key,name] of [['topLeft','corner-TL'],['topRight','corner-TR'],
      ['bottomRight','corner-BR'],['bottomLeft','corner-BL']] as const){
      const sq=squares[key];
      groups.push({name,target:{x:px(sq.xMm+sq.sizeMm/2),y:px(sq.yMm+sq.sizeMm/2)},
        candidates:input.corners.map(c=>c[key]).filter((p):p is Point=>Boolean(p))});
    }
    for(const [key,name] of [['top','midpoint-top'],['right','midpoint-right'],
      ['bottom','midpoint-bottom'],['left','midpoint-left']] as const){
      const pt=MIDPOINTS_MM[key];
      groups.push({name,target:{x:px(pt.x),y:px(pt.y)},
        candidates:input.midpoints.map(m=>m[key]).filter((p):p is Point=>Boolean(p))});
    }
    let rejected=0,chosen=0;
    const accepted=[...base];
    for(const group of groups){
      const options=group.candidates.map(source=>({
        source,projected:projectPoint(coefficients,source)
      })).filter((x):x is {source:Point;projected:Point}=>Boolean(x.projected));
      options.sort((a,b)=>distance(a.projected,group.target)-distance(b.projected,group.target));
      const best=options[0];
      // 5 mm is a generous admission bound. RANSAC later rejects outliers.
      if(best&&distance(best.projected,group.target)<=px(5)){
        accepted.push({source:best.source,target:group.target,name:group.name});chosen++;
      }else if(options.length)rejected++;
    }
    if(chosen<3)return null;
    pointsA=cv.matFromArray(accepted.length,1,cv.CV_32FC2,
      accepted.flatMap(a=>[a.source.x,a.source.y]));
    pointsB=cv.matFromArray(accepted.length,1,cv.CV_32FC2,
      accepted.flatMap(a=>[a.target.x,a.target.y]));
    mask=new cv.Mat();
    H=cv.findHomography(pointsA,pointsB,cv.RANSAC,Math.max(5,px(1.4)),mask);
    if(!H||H.empty())return null;
    const coeff=Array.from(H.data64F ?? H.data32F) as number[];
    if(coeff.length!==9)return null;
    const inliers=accepted.filter((a,i)=>mask.empty()||
      (mask.data?.[i]??0)>0);
    const residuals=inliers.map(a=>{
      const predicted=projectPoint(coeff,a.source);
      return predicted?distance(predicted,a.target):Infinity;
    }).sort((a,b)=>a-b);
    const median=residuals[Math.floor(residuals.length/2)]??Infinity;
    if(inliers.length<6||median>px(1.5))return null;
    srcMat=cv.imread(src);corrected=new cv.Mat();
    cv.warpPerspective(srcMat,corrected,H,new cv.Size(
      Math.round(px(OMR_LAYOUT.page.widthMm)),Math.round(px(OMR_LAYOUT.page.heightMm))));
    const perspective:PerspectiveResult={corrected,transform:H,
      correctedDataUrl:'',success:true};
    H=null;corrected=null;
    return {perspective,evidence:{total:accepted.length,chosen,rejected,
      inliers:inliers.length,residualPx:+median.toFixed(2),methods:accepted.map(a=>a.name)}};
  }catch{return null;}finally{
    for(const m of [roughSrc,roughDst,roughH,srcMat,pointsA,pointsB,H,mask,corrected])
      try{m?.delete?.();}catch{/* WASM cleanup */}
  }
}
