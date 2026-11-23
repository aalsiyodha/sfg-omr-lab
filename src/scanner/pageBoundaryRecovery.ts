/**
 * Expensive rescue only AFTER all normal registration candidates fail.
 * Locate a white A4 page as a four-sided polygon, prewarp it into a
 * normalized canvas, and redetect independent printed fiducials there.
 * The outer boundary is ONLY a search aid, never proof of alignment.
 */
import { OMR_LAYOUT, mmToPx } from '../config/omrLayout';
import { getSettings } from '../config/scannerSettings';
declare const cv:any;

export type PagePoint={x:number;y:number};
export interface BoundaryEvidence {
  reason:string;
  contourAreaRatio?:number;
  quadrilateral?:PagePoint[];
  candidates?:number;
}
export interface BoundaryResult {
  canvas:HTMLCanvasElement;
  evidence:BoundaryEvidence;
}
export function orderPageCorners(points:PagePoint[]):PagePoint[]|null{
  if(points.length!==4)return null;
  const center={x:points.reduce((s,p)=>s+p.x,0)/4,
    y:points.reduce((s,p)=>s+p.y,0)/4};
  const sorted=[...points].sort((a,b)=>Math.atan2(a.y-center.y,a.x-center.x)-
    Math.atan2(b.y-center.y,b.x-center.x));
  let start=0;
  for(let i=1;i<4;i++)if(sorted[i].x+sorted[i].y<sorted[start].x+sorted[start].y)start=i;
  const ordered=Array.from({length:4},(_,i)=>sorted[(start+i)%4]);
  // Clockwise TL TR BR BL in image coordinates.
  if(ordered[1].x<ordered[3].x) return [ordered[0],ordered[3],ordered[2],ordered[1]];
  return ordered;
}
export function plausiblePageBoundary(points:PagePoint[],width:number,height:number):boolean{
  const p=orderPageCorners(points);
  if(!p)return false;
  const cross=(a:PagePoint,b:PagePoint,c:PagePoint)=>
    (b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
  if(p.some((v,i)=>cross(v,p[(i+1)%4],p[(i+2)%4])<=0))return false;
  const area=Math.abs(p.reduce((sum,v,i)=>sum+v.x*p[(i+1)%4].y-
    v.y*p[(i+1)%4].x,0))/2;
  if(area<width*height*.18||area>width*height*.95)return false;
  const d=(a:PagePoint,b:PagePoint)=>Math.hypot(a.x-b.x,a.y-b.y);
  const top=d(p[0],p[1]),bottom=d(p[3],p[2]);
  const left=d(p[0],p[3]),right=d(p[1],p[2]);
  if(Math.min(top,bottom)<width*.26||Math.min(left,right)<height*.30)return false;
  const widthRatio=Math.max(top,bottom)/Math.min(top,bottom);
  const heightRatio=Math.max(left,right)/Math.min(left,right);
  if(widthRatio>2.1||heightRatio>2.1)return false;
  return true;
}
export function recoverPaperBoundary(source:HTMLCanvasElement,
  onEvidence?:(e:BoundaryEvidence)=>void):BoundaryResult|null{
  let src:any=null,gray:any=null,small:any=null,mask:any=null,kernel:any=null;
  let contours:any=null,hierarchy:any=null,points:any=null,dest:any=null;
  let homography:any=null,output:any=null;
  const report=(e:BoundaryEvidence)=>onEvidence?.(e);
  try{
    src=cv.imread(source);gray=new cv.Mat();
    cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);
    // Speed: estimate page boundary at <=800px and only once.
    const scale=Math.min(1,800/Math.max(src.cols,src.rows));
    small=new cv.Mat();
    cv.resize(gray,small,new cv.Size(
      Math.max(1,Math.round(src.cols*scale)),
      Math.max(1,Math.round(src.rows*scale))),0,0,cv.INTER_AREA);
    mask=new cv.Mat();
    // Bright page against a darker environment. Threshold + closing
    // suppresses internal print and soft shadow bands.
    cv.threshold(small,mask,0,255,cv.THRESH_BINARY|cv.THRESH_OTSU);
    kernel=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(11,11));
    cv.morphologyEx(mask,mask,cv.MORPH_CLOSE,kernel);
    contours=new cv.MatVector();hierarchy=new cv.Mat();
    cv.findContours(mask,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
    const candidates:{corners:PagePoint[];area:number}[]=[];
    const areaFloor=small.cols*small.rows*.18;
    for(let i=0;i<contours.size();i++){
      const contour=contours.get(i);
      let approx:any=null,hull:any=null;
      try{
        const area=cv.contourArea(contour);
        if(area<areaFloor||area>small.cols*small.rows*.96)continue;
        hull=new cv.Mat();
        cv.convexHull(contour,hull,false,true);
        const perimeter=cv.arcLength(hull,true);
        if(perimeter<=0)continue;
        approx=new cv.Mat();
        // Polygonize boundary rather than infer orientation from a
        // min-area rotated rectangle (which can include background).
        cv.approxPolyDP(hull,approx,perimeter*.032,true);
        if(approx.rows!==4||!cv.isContourConvex(approx))continue;
        const v=approx.data32S;
        const corners=Array.from({length:4},(_,j)=>({
          x:v[j*2]/scale,y:v[j*2+1]/scale
        }));
        if(!plausiblePageBoundary(corners,source.width,source.height))continue;
        candidates.push({corners,area});
      }finally{approx?.delete?.();hull?.delete?.();contour.delete();}
    }
    candidates.sort((a,b)=>b.area-a.area);
    if(!candidates.length){
      report({reason:'no-plausible-outer-page-quadrilateral',candidates:0});
      return null;
    }
    const best=candidates[0];
    const corners=orderPageCorners(best.corners)!;
    const dpi=getSettings().scanDpi;
    const w=Math.round(mmToPx(OMR_LAYOUT.page.widthMm,dpi));
    const h=Math.round(mmToPx(OMR_LAYOUT.page.heightMm,dpi));
    points=cv.matFromArray(4,1,cv.CV_32FC2,
      corners.flatMap(p=>[p.x,p.y]));
    dest=cv.matFromArray(4,1,cv.CV_32FC2,[0,0,w-1,0,w-1,h-1,0,h-1]);
    homography=cv.getPerspectiveTransform(points,dest);
    output=new cv.Mat();
    cv.warpPerspective(src,output,homography,new cv.Size(w,h),
      cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar(255,255,255,255));
    const canvas=document.createElement('canvas');
    canvas.width=w;canvas.height=h;
    cv.imshow(canvas,output);
    const evidence:BoundaryEvidence={
      reason:'outer-page-rough-warp-created-not-verified',
      contourAreaRatio:best.area/(small.cols*small.rows),
      quadrilateral:corners,candidates:candidates.length};
    report(evidence);
    return {canvas,evidence};
  }catch(error){
    report({reason:'boundary-recovery-opencv-error: '+String(error)});
    return null;
  }finally{
    for(const m of [src,gray,small,mask,kernel,contours,hierarchy,
      points,dest,homography,output])try{m?.delete?.();}catch{/* cleanup */}
  }
}
