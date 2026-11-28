/**
 * Optional OpenCV.js subpixel refinement on already contour-detected ArUco
 * marker vertices. Marker ID decoding and QR/timing gates remain unchanged.
 * Return original coordinates when contrib functionality is absent or the
 * requested refinement drifts too far from detected contour vertices.
 */
import type {ImagePoint} from './arucoDetector';
declare const cv:any;
export function refineMarkerQuad(gray:any,corners:ImagePoint[]):{
  points:ImagePoint[];method:string;maxShift:number
}{
  if(corners.length!==4||typeof cv?.cornerSubPix!=='function')
    return {points:corners,method:'not-available',maxShift:0};
  let pts:any=null;
  try{
    pts=cv.matFromArray(4,1,cv.CV_32FC2,
      corners.flatMap(p=>[p.x,p.y]));
    const term=new cv.TermCriteria(cv.TERM_CRITERIA_EPS+cv.TERM_CRITERIA_MAX_ITER,20,.04);
    cv.cornerSubPix(gray,pts,new cv.Size(3,3),new cv.Size(-1,-1),term);
    const xy=pts.data32F as Float32Array;
    if(!xy||xy.length<8)return {points:corners,method:'invalid-output',maxShift:0};
    const updated=corners.map((p,i)=>({x:xy[i*2],y:xy[i*2+1]}));
    const offsets=updated.map((p,i)=>Math.hypot(p.x-corners[i].x,p.y-corners[i].y));
    const maxShift=Math.max(...offsets);
    if(!Number.isFinite(maxShift)||maxShift>2.5)
      return {points:corners,method:'rejected-excessive-shift',maxShift};
    return {points:updated,method:'cornerSubPix-bounded',maxShift};
  }catch{
    return {points:corners,method:'fallback-error',maxShift:0};
  }finally{try{pts?.delete?.();}catch{}}
}
