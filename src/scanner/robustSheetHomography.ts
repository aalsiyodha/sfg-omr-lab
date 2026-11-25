/** Robust multimarker homography fallback.
 * Printed corners, side midpoints and independently decoded ArUco IDs are
 * different measurement families. Fit with RANSAC and check pixel reprojection
 * residuals BEFORE allocating a full-page warp. Final acceptance still uses
 * QR identity + 25 left / 25 right timing marks in scanOrchestrator.
 */
import {OMR_LAYOUT,mmToPx} from '../config/omrLayout';
import {MIDPOINTS_MM,type MidpointRegistration} from './midpointDetector';
import {ARUCO_MARKERS_MM,type ArucoRegistration} from './arucoDetector';
import type {MarkerDetectionResult} from '../types';
import type {PerspectiveResult} from './perspectiveCorrection';
declare const cv:any;
type Pt={x:number;y:number};
type Anchor={source:Pt;dest:Pt;family:'corner'|'midpoint'|'aruco';name:string};
export interface FusionEvidence {
 available:number;inliers:number;families:string[];medianErrorPx:number;
 maxErrorPx:number;reason:string;acceptedNames?:string[];rejectedNames?:string[];
}
export interface FusionResult{perspective:PerspectiveResult; evidence:FusionEvidence}
export function fitRobustSheetWarp(
 src:HTMLCanvasElement,
 corner:MarkerDetectionResult,
 midpoint:MidpointRegistration|undefined,
 aruco:ArucoRegistration|undefined,
 dpi:number,
 onEvidence?:(e:FusionEvidence)=>void
):FusionResult|null{
 const report=(reason:string,additional:Partial<FusionEvidence>={})=>onEvidence?.({
   available:anchors.length,inliers:0,families:[],medianErrorPx:Infinity,maxErrorPx:Infinity,
   reason,...additional});
 const anchors:Anchor[]=[];
 const add=(source:Pt|null|undefined,dest:Pt,name:string,family:Anchor['family'])=>{
   if(source&&Number.isFinite(source.x)&&Number.isFinite(source.y))
     anchors.push({source,dest:{x:mmToPx(dest.x,dpi),y:mmToPx(dest.y,dpi)},name,family});
 };
 const cm=OMR_LAYOUT.markers;
 for(const [field,mm] of [['topLeft',cm.topLeft],['topRight',cm.topRight],
   ['bottomLeft',cm.bottomLeft],['bottomRight',cm.bottomRight]] as const){
   const p=corner[field];
   // Do not add invented corner positions when the detection was rejected.
   if(corner.found)add(p,{x:mm.xMm+mm.sizeMm/2,y:mm.yMm+mm.sizeMm/2},
     field,'corner');
 }
 if(midpoint?.found){
   for(const side of ['top','right','bottom','left'] as const)
     add(midpoint[side],MIDPOINTS_MM[side],side,'midpoint');
 }
 if(aruco?.found){
   for(const m of ARUCO_MARKERS_MM)add(aruco.points[m.id],{x:m.x,y:m.y},
     'aruco-'+m.id,'aruco');
 }
 if(anchors.length<6||new Set(anchors.map(a=>a.family)).size<2){
   report('insufficient independent anchor families or fewer than six points');return null;
 }
 if(typeof cv.findHomography!=='function'){
   report('OpenCV.js build does not expose findHomography; fusion unavailable');return null;
 }
 let pts:any=null,dst:any=null,h:any=null,source:any=null,corrected:any=null;
 try{
   pts=cv.matFromArray(anchors.length,1,cv.CV_32FC2,
     anchors.flatMap(a=>[a.source.x,a.source.y]));
   dst=cv.matFromArray(anchors.length,1,cv.CV_32FC2,
     anchors.flatMap(a=>[a.dest.x,a.dest.y]));
   // OpenCV USAC variants are not consistently exported in legacy JS;
   // RANSAC is the supported robust outlier-rejecting fallback.
   h=cv.findHomography(pts,dst,cv.RANSAC,7);
   if(!h||h.empty()){report('RANSAC returned an empty homography');return null;}
   const values=h.type()===cv.CV_64F?h.data64F:h.data32F;
   if(!values||values.length<9){report('Homography matrix has an unsupported element type');return null;}
   const errors=anchors.map(a=>{
     const x=a.source.x,y=a.source.y;
     const den=values[6]*x+values[7]*y+values[8];
     if(!Number.isFinite(den)||Math.abs(den)<1e-8)return Infinity;
     const u=(values[0]*x+values[1]*y+values[2])/den;
     const v=(values[3]*x+values[4]*y+values[5])/den;
     return Math.hypot(u-a.dest.x,v-a.dest.y);
   });
   const accepted=anchors.filter((_,i)=>errors[i]<=7);
   const families=[...new Set(accepted.map(a=>a.family))];
   const sorted=errors.filter(Number.isFinite).sort((a,b)=>a-b);
   const median=sorted.length?sorted[Math.floor(sorted.length/2)]:Infinity;
   if(accepted.length<5||families.length<2||median>5){
     report('RANSAC inlier count, family agreement, or median reprojection error failed',{
       inliers:accepted.length,families,medianErrorPx:median,
       maxErrorPx:Math.max(...errors.filter(Number.isFinite)),
       acceptedNames:accepted.map(a=>a.name),
       rejectedNames:anchors.filter((_,i)=>errors[i]>7).map(a=>a.name)
     });return null;
   }
   source=cv.imread(src);corrected=new cv.Mat();
   const W=Math.round(mmToPx(OMR_LAYOUT.page.widthMm,dpi));
   const H=Math.round(mmToPx(OMR_LAYOUT.page.heightMm,dpi));
   cv.warpPerspective(source,corrected,h,new cv.Size(W,H));
   const warp=corrected;corrected=null;
   const transform=h;h=null;
   const evidence:FusionEvidence={available:anchors.length,inliers:accepted.length,families,
     medianErrorPx:median,maxErrorPx:Math.max(...errors.filter(Number.isFinite)),
     reason:'RANSAC inliers from at least two printed marker families',
     acceptedNames:accepted.map(a=>a.name),
     rejectedNames:anchors.filter((_,i)=>errors[i]>7).map(a=>a.name)};
   onEvidence?.(evidence);
   return {perspective:{corrected:warp,correctedDataUrl:'',transform,success:true},evidence};
 }catch(error){
   report('RANSAC runtime exception: '+String(error));
   return null;
 }finally{pts?.delete?.();dst?.delete?.();h?.delete?.();source?.delete?.();
   corrected?.delete?.();}
}
