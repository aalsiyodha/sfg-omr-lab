/**
 * Expensive rescue only AFTER all normal registration candidates fail.
 * Locate a white A4 page as a four-sided polygon, prewarp it into a
 * normalized canvas, and redetect independent printed fiducials there.
 * The outer boundary is ONLY a search aid, never proof of alignment.
 */
import { OMR_LAYOUT, mmToPx } from '../config/omrLayout';
import { getSettings } from '../config/scannerSettings';
import { proposeVertexQuads } from './classicalVertexLab';
declare const cv:any;

export type PagePoint={x:number;y:number};
export interface BoundaryEvidence {
  reason:string;
  contourAreaRatio?:number;
  quadrilateral?:PagePoint[];
  /** Other plausible paper quads; never independently accepted without QR+timing. */
  alternativeQuads?:Array<{corners:PagePoint[];method:string;score:number}>;
  candidates?:number;
  rejectedBorder?:number;
  rejectedImageCorner?:number;
  rejectedGeometry?:number;
  rejectedQrOutside?:number;
  mode?:'strict'|'small-page-rescue';
  candidateSummary?:Array<{method:string;score:number;areaRatio:number;minMarginRatio:number}>;
  thresholdsTried?:number;
  method?:string;
  vertexLab?:{harris:number;tangent:number;errors:string[]};
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
/** The image edge is not evidence of the paper edge.
 * One point may genuinely touch the frame, but TWO corners on the same
 * border indicate that thresholding probably selected the entire background.
 */
export function hasClippedImageEdge(points:PagePoint[],width:number,height:number):boolean{
  const ordered=orderPageCorners(points);
  if(!ordered)return true;
  const tol=Math.max(4,Math.min(width,height)*.012);
  const near=(v:number,edge:number)=>Math.abs(v-edge)<=tol;
  const top=ordered.filter(p=>near(p.y,0)).length;
  const bottom=ordered.filter(p=>near(p.y,height)).length;
  const left=ordered.filter(p=>near(p.x,0)).length;
  const right=ordered.filter(p=>near(p.x,width)).length;
  return top>=2||bottom>=2||left>=2||right>=2;
}
/** A contour pinned to an actual photograph corner is often the bright
 * background, not the page. A real page may touch a single SIDE edge;
 * reject only corners simultaneously touching two perpendicular edges.
 */
export function touchesImageCorner(points:PagePoint[],width:number,height:number):boolean{
  const tol=Math.max(4,Math.min(width,height)*.012);
  return points.some(p=>
    (p.x<=tol || p.x>=width-tol) &&
    (p.y<=tol || p.y>=height-tol));
}
export type BoundaryRecoveryMode='strict'|'small-page-rescue';
export function plausiblePageBoundary(points:PagePoint[],width:number,height:number,
  mode:BoundaryRecoveryMode='strict'):boolean{
  const p=orderPageCorners(points);
  if(!p)return false;
  const cross=(a:PagePoint,b:PagePoint,c:PagePoint)=>
    (b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
  if(p.some((v,i)=>cross(v,p[(i+1)%4],p[(i+2)%4])<=0))return false;
  const area=Math.abs(p.reduce((sum,v,i)=>sum+v.x*p[(i+1)%4].y-
    v.y*p[(i+1)%4].x,0))/2;
  if(area<width*height*(mode==='strict'?.18:.095)||area>width*height*.95)return false;
  const d=(a:PagePoint,b:PagePoint)=>Math.hypot(a.x-b.x,a.y-b.y);
  const top=d(p[0],p[1]),bottom=d(p[3],p[2]);
  const left=d(p[0],p[3]),right=d(p[1],p[2]);
  if(Math.min(top,bottom)<width*(mode==='strict'?.26:.16)||
     Math.min(left,right)<height*(mode==='strict'?.30:.16))return false;
  const widthRatio=Math.max(top,bottom)/Math.min(top,bottom);
  const heightRatio=Math.max(left,right)/Math.min(left,right);
  if(widthRatio>(mode==='strict'?2.1:3.2)||heightRatio>(mode==='strict'?2.1:3.2))return false;
  return true;
}
export function recoverPaperBoundary(source:HTMLCanvasElement,
  onEvidence?:(e:BoundaryEvidence)=>void,
  options?:{mode?:BoundaryRecoveryMode;qrCenter?:PagePoint|null}
):BoundaryResult|null{
  const mode=options?.mode??'strict';
  let src:any=null,gray:any=null,small:any=null,blur:any=null;
  let mask:any=null,kernel:any=null,contours:any=null,hierarchy:any=null;
  let points:any=null,dest:any=null,homography:any=null,output:any=null;
  const report=(e:BoundaryEvidence)=>onEvidence?.(e);
  const diagnostics:BoundaryEvidence={mode,candidates:0,rejectedBorder:0,rejectedImageCorner:0,
    rejectedGeometry:0,rejectedQrOutside:0,thresholdsTried:0};
  try{
    src=cv.imread(source);
    gray=new cv.Mat();cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);
    const scale=Math.min(1,800/Math.max(src.cols,src.rows));
    small=new cv.Mat();
    cv.resize(gray,small,new cv.Size(
      Math.max(1,Math.round(src.cols*scale)),
      Math.max(1,Math.round(src.rows*scale))),0,0,cv.INTER_AREA);
    blur=new cv.Mat();
    cv.GaussianBlur(small,blur,new cv.Size(5,5),0);
    mask=new cv.Mat();
    kernel=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(9,9));
    const areaFloor=small.cols*small.rows*(mode==='strict'?.18:.095);
    const candidates:{corners:PagePoint[];area:number;score:number;method:string}[]=[];
    const vertexContours:PagePoint[][]=[];
    // Distinct thresholds are important for papers with hard sunlight and
    // shadow. Multiple candidate families are bounded and only searched
    // after the normal QR-verified registration has failed.
    for(const strategy of ['otsu','bright-170','bright-200','edges'] as const){
      diagnostics.thresholdsTried++;
      if(strategy==='edges'){
        cv.Canny(blur,mask,35,105);
        cv.morphologyEx(mask,mask,cv.MORPH_CLOSE,kernel);
      }else{
        const t=strategy==='otsu'?0:strategy==='bright-170'?170:200;
        cv.threshold(blur,mask,t,255,cv.THRESH_BINARY|
          (strategy==='otsu'?cv.THRESH_OTSU:0));
        cv.morphologyEx(mask,mask,cv.MORPH_CLOSE,kernel);
      }
      contours=new cv.MatVector();hierarchy=new cv.Mat();
      cv.findContours(mask,contours,hierarchy,
        cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
      try{
        for(let i=0;i<contours.size();i++){
          const contour=contours.get(i);
          let approx:any=null,hull:any=null;
          try{
            const area=cv.contourArea(contour);
            if(area<areaFloor||area>small.cols*small.rows*.96)continue;
            if(vertexContours.length<20&&contour.rows>=12){
              const d=contour.data32S;
              if(d?.length>=24)vertexContours.push(Array.from({length:Math.min(contour.rows,400)},(_,k)=>({x:d[k*2],y:d[k*2+1]})));
            }
            hull=new cv.Mat();cv.convexHull(contour,hull,false,true);
            const perimeter=cv.arcLength(hull,true);
            if(perimeter<=0)continue;
            for(const epsilon of [.018,.03,.045]){
              approx=new cv.Mat();
              cv.approxPolyDP(hull,approx,perimeter*epsilon,true);
              if(approx.rows!==4||!cv.isContourConvex(approx)){approx.delete();approx=null;continue;}
              const v=approx.data32S;
              const corners=Array.from({length:4},(_,j)=>({
                x:v[j*2]/scale,y:v[j*2+1]/scale
              }));
              approx.delete();approx=null;
              if(!plausiblePageBoundary(corners,source.width,source.height,mode)){
                diagnostics.rejectedGeometry++;continue;
              }
              if(hasClippedImageEdge(corners,source.width,source.height)){
                diagnostics.rejectedBorder++;continue;
              }
              if(touchesImageCorner(corners,source.width,source.height)){
                diagnostics.rejectedImageCorner++;continue;
              }
              // In the deliberately more permissive second pass, require
              // the independently located source QR to remain INSIDE the
              // paper hypothesis (when a QR was actually decoded).
              // A background polygon excluding the real QR is impossible.
              if(mode==='small-page-rescue'&&options?.qrCenter){
                const p=orderPageCorners(corners)!;
                const center=options.qrCenter;
                const signed=p.map((c,i)=>{
                  const n=p[(i+1)%4];
                  return (n.x-c.x)*(center.y-c.y)-
                    (n.y-c.y)*(center.x-c.x);
                });
                if(signed.some(v=>v>0)&&signed.some(v=>v<0)){
                  diagnostics.rejectedQrOutside++;continue;
                }
              }
              // Prefer a large actual sheet with available margins. A large
              // contour which hugs the image boundary is NOT automatically
              // more trustworthy than a slightly smaller inner contour.
              const ordered=orderPageCorners(corners)!;
              const margin=Math.min(...ordered.flatMap(p=>[
                p.x/source.width,1-p.x/source.width,
                p.y/source.height,1-p.y/source.height]));
              const score=area/(small.cols*small.rows)+
                .2*Math.max(-.1,Math.min(.12,margin));
              const duplicate=candidates.some(c=>
                c.corners.every((p,k)=>Math.hypot(p.x-ordered[k].x,p.y-ordered[k].y)<10));
              if(duplicate)continue;
              candidates.push({corners:ordered,area,score,method:strategy});
              diagnostics.candidates++;
            }
          }finally{approx?.delete?.();hull?.delete?.();contour.delete();}
        }
      }finally{contours.delete();hierarchy.delete();contours=null;hierarchy=null;}
    }
    // Failure-only experiment: use Harris peaks near known candidate paper
    // corners and tangent deflection of real page contours to propose
    // additional geometries. Both remain subject to the original boundary
    // gates and later QR + independently verified left/right timing marks.
    if(mode==='strict' && candidates.length>0){
      const lab=proposeVertexQuads(small,vertexContours,
        candidates.slice(0,5).map(c=>c.corners.map(p=>({
          x:p.x*scale,y:p.y*scale
        }))),{maxCandidates:10});
      for(const proposal of lab.proposals){
        const corners=orderPageCorners(proposal.corners.map(p=>({
          x:p.x/scale,y:p.y/scale
        })));
        if(!corners||!plausiblePageBoundary(corners,source.width,source.height,mode)||
          hasClippedImageEdge(corners,source.width,source.height)||
          touchesImageCorner(corners,source.width,source.height))continue;
        if(options?.qrCenter){
          const q=options.qrCenter;
          const signs=corners.map((p,i)=>{
            const n=corners[(i+1)%4];
            return (n.x-p.x)*(q.y-p.y)-(n.y-p.y)*(q.x-p.x);
          });
          if(signs.some(x=>x>0)&&signs.some(x=>x<0))continue;
        }
        if(candidates.some(c=>c.corners.every((p,i)=>
          Math.hypot(p.x-corners[i].x,p.y-corners[i].y)<10)))continue;
        const pts=corners.map(p=>({x:p.x*scale,y:p.y*scale}));
        const area=Math.abs(pts.reduce((sum,p,i)=>{
          const n=pts[(i+1)%4];return sum+p.x*n.y-n.x*p.y;
        },0))/2;
        // The method remains explicit in forensic diagnostics.
        candidates.push({corners,area,score:area/(small.cols*small.rows)-.03,
          method:'vertex-'+proposal.method});
      }
      diagnostics.vertexLab={harris:lab.stats.harris,
        tangent:lab.stats.tangent,errors:lab.stats.errors};
    }
    candidates.sort((a,b)=>b.score-a.score);
    const candidateSummary=candidates.slice(0,4).map(c=>({
      method:c.method,score:Number(c.score.toFixed(4)),
      areaRatio:Number((c.area/(small.cols*small.rows)).toFixed(4)),
      minMarginRatio:Number(Math.min(...c.corners.flatMap(p=>[
        p.x/source.width,1-p.x/source.width,p.y/source.height,1-p.y/source.height
      ])).toFixed(4))
    }));
    if(!candidates.length){
      report({reason:diagnostics.rejectedImageCorner>0
        ? 'false-paper-boundary-image-corner-rejected'
        : diagnostics.rejectedBorder>0
        ? 'background-touching-image-border-rejected'
        : 'no-plausible-outer-page-quadrilateral',...diagnostics,
        candidateSummary});
      return null;
    }
    const best=candidates[0];
    const corners=best.corners;
    // Preserve a few genuinely different page candidates for failure-only
    // verification. The old code discarded every candidate except #1.
    const separation=Math.min(source.width,source.height)*.014;
    const alternates:typeof candidates=[];
    // Reserve at most one trial for vertex-family proposals so that they
    // are actually evaluated rather than displaced by near-duplicate masks.
    const standard=candidates.slice(1).filter(c=>!c.method.startsWith('vertex-'));
    const vertices=candidates.slice(1).filter(c=>c.method.startsWith('vertex-'));
    const trialOrder=[...standard.slice(0,2),...vertices.slice(0,1),
      ...standard.slice(2),...vertices.slice(1)];
    for(const candidate of trialOrder){
      if(alternates.length>=3)break;
      const different=[best,...alternates].every(previous=>
        previous.corners.some((point,i)=>Math.hypot(point.x-candidate.corners[i].x,
          point.y-candidate.corners[i].y)>separation));
      if(different)alternates.push(candidate);
    }
    const alternativeQuads=alternates.map(c=>({corners:c.corners,
      method:c.method,score:Number(c.score.toFixed(4))}));
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
    canvas.width=w;canvas.height=h;cv.imshow(canvas,output);
    report({reason:'outer-page-rough-warp-created-not-verified',
      ...diagnostics,candidateSummary,
      method:best.method,contourAreaRatio:best.area/(small.cols*small.rows),
      quadrilateral:corners,alternativeQuads});
    return {canvas,evidence:{
      reason:'outer-page-rough-warp-created-not-verified',
      ...diagnostics,method:best.method,candidateSummary,
      contourAreaRatio:best.area/(small.cols*small.rows),quadrilateral:corners,
      alternativeQuads}};
  }catch(error){
    report({reason:'boundary-recovery-opencv-error: '+String(error),...diagnostics});
    return null;
  }finally{
    for(const m of [src,gray,small,blur,mask,kernel,contours,hierarchy,
      points,dest,homography,output])try{m?.delete?.();}catch{/* cleanup */}
  }
}
