/**
 * OMRLab 3.9: OMRKit-inspired marker-corner homography using the exact SFG
 * printed marker geometry. No native cv.aruco WASM dependency.
 *
 * Only propose a warp. scanOrchestrator still requires decoded QR identity
 * and independently measured left + right timing rails before acceptance.
 */
import {ARUCO_MARKERS_MM,type ArucoRegistration} from './arucoDetector';
import {OMR_LAYOUT,mmToPx} from '../config/omrLayout';
import type {PerspectiveResult} from './perspectiveCorrection';
declare const cv:any;
export interface ArucoCornerEvidence {
  markerIds:number[];correspondences:number;medianErrorPx:number;
  worstMarkerErrorPx:number;inlierCorners:number;reason:string;
}
export function fitArucoCornerWarp(
  source:HTMLCanvasElement,markers:ArucoRegistration,dpi:number,
  onEvidence?:(e:ArucoCornerEvidence)=>void
):PerspectiveResult{
  const ids=ARUCO_MARKERS_MM.filter(m=>markers.corners?.[m.id] &&
    (markers.errors?.[m.id]??Infinity)<=1);
  const evidence:ArucoCornerEvidence={markerIds:ids.map(x=>x.id),
    correspondences:ids.length*4,medianErrorPx:Infinity,
    worstMarkerErrorPx:Infinity,inlierCorners:0,reason:'not enough markers'};
  const fail=(reason:string):PerspectiveResult=>{
    evidence.reason=reason;onEvidence?.(evidence);
    return {corrected:null,correctedDataUrl:'',transform:null,success:false,error:reason};
  };
  if(ids.length<3)return fail('Fewer than three orientation-verified ArUco markers');
  const side=7; // Printed marker size in mm; ARUCO_MARKERS_MM stores marker centres.
  const src:number[]=[],dst:number[]=[];
  for(const marker of ids){
    const observed=markers.corners![marker.id];
    const expected=[
      [marker.x-side/2,marker.y-side/2],
      [marker.x+side/2,marker.y-side/2],
      [marker.x+side/2,marker.y+side/2],
      [marker.x-side/2,marker.y+side/2]
    ];
    for(let j=0;j<4;j++){
      src.push(observed[j].x,observed[j].y);
      dst.push(mmToPx(expected[j][0],dpi),mmToPx(expected[j][1],dpi));
    }
  }
  let sourceMat:any=null,srcMat:any=null,dstMat:any=null,inliers:any=null;
  let h:any=null,corrected:any=null;
  try{
    srcMat=cv.matFromArray(src.length/2,1,cv.CV_32FC2,src);
    dstMat=cv.matFromArray(dst.length/2,1,cv.CV_32FC2,dst);
    inliers=new cv.Mat();
    h=cv.findHomography(srcMat,dstMat,cv.RANSAC,4,inliers);
    if(!h||h.empty())return fail('Corner RANSAC returned no homography');
    const m=h.data64F?.length===9?h.data64F:h.data32F;
    if(!m||m.length!==9)return fail('Unsupported homography data');
    const errs:number[]=[];
    let inlierCount=0,worstMarker=0;
    for(let i=0;i<src.length/2;i++){
      const x=src[2*i],y=src[2*i+1];
      const d=m[6]*x+m[7]*y+m[8];
      if(!Number.isFinite(d)||Math.abs(d)<1e-9)return fail('Degenerate corner projection');
      const ox=(m[0]*x+m[1]*y+m[2])/d;
      const oy=(m[3]*x+m[4]*y+m[5])/d;
      const error=Math.hypot(ox-dst[2*i],oy-dst[2*i+1]);
      if(!Number.isFinite(error))return fail('Nonfinite reprojection residual');
      errs.push(error);
      if(error<=4)inlierCount++;
    }
    for(let k=0;k<ids.length;k++){
      const median=[...errs.slice(k*4,k*4+4)].sort((a,b)=>a-b)[1];
      worstMarker=Math.max(worstMarker,median);
    }
    const sorted=[...errs].sort((a,b)=>a-b);
    evidence.medianErrorPx=sorted[Math.floor(sorted.length/2)];
    evidence.worstMarkerErrorPx=worstMarker;
    evidence.inlierCorners=inlierCount;
    // Residuals are IN-SAMPLE evidence, not proof of correct page registration.
    // Reject mismatched markers; the next stage independently checks QR/rails.
    if(inlierCount<Math.max(9,ids.length*3) ||
       evidence.medianErrorPx>3 ||worstMarker>5)
      return fail('Marker corner fit too inconsistent');
    const W=Math.round(mmToPx(OMR_LAYOUT.page.widthMm,dpi));
    const H=Math.round(mmToPx(OMR_LAYOUT.page.heightMm,dpi));
    sourceMat=cv.imread(source);corrected=new cv.Mat();
    cv.warpPerspective(sourceMat,corrected,h,new cv.Size(W,H),
      cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar(255,255,255,255));
    evidence.reason='geometric proposal; independently verify QR and timing rails';
    onEvidence?.(evidence);
    const output=corrected;corrected=null;
    const transform=h;h=null;
    return {corrected:output,correctedDataUrl:'',transform,success:true};
  }catch(error){return fail('ArUco corner homography error: '+String(error));}
  finally{
    for(const m of [sourceMat,srcMat,dstMat,inliers,h,corrected])
      try{m?.delete?.();}catch{}
  }
}
