/** Conservative curved-page fallback for QR-verified global alignments.
 * Uses alternate (odd) timing rows as independent control points, leaving
 * even timing rows out of the fit for validation by the caller.
 * It never reads bubbles or modifies scoring thresholds.
 */
import { OMR_LAYOUT, mmToPx } from '../config/omrLayout';
import { computeAdaptiveDarkThreshold } from './bubbleDetector';
declare const cv:any;
interface Drift {row:number;dx:number;dy:number}
export interface MeshEvidence {
  sampled:{left:number;right:number};
  controls:{left:Drift[];right:Drift[]};
  maxAbsShiftPx:number;
  holdoutRows:number[];
}
export const smoothDrift=(control:Drift[],row:number):{dx:number;dy:number}=>{
  if(!control.length)return {dx:0,dy:0};
  const a=[...control].sort((x,y)=>x.row-y.row);
  if(row<=a[0].row)return {dx:a[0].dx,dy:a[0].dy};
  if(row>=a[a.length-1].row)return {dx:a[a.length-1].dx,dy:a[a.length-1].dy};
  for(let i=1;i<a.length;i++){
    if(row<=a[i].row){
      const t=(row-a[i-1].row)/(a[i].row-a[i-1].row);
      return {dx:a[i-1].dx+(a[i].dx-a[i-1].dx)*t,
        dy:a[i-1].dy+(a[i].dy-a[i-1].dy)*t};
    }
  }
  return {dx:0,dy:0};
};
export function isPlausibleDrift(control:Drift[],maxDx:number,maxDy:number):boolean{
  if(control.length<7||control[control.length-1].row-control[0].row<16)return false;
  for(let i=0;i<control.length;i++){
    if(Math.abs(control[i].dx)>maxDx||Math.abs(control[i].dy)>maxDy)return false;
    if(i>0){
      const gap=Math.max(1,control[i].row-control[i-1].row);
      if(Math.abs(control[i].dx-control[i-1].dx)/gap>8 ||
         Math.abs(control[i].dy-control[i-1].dy)/gap>3)return false;
    }
  }
  return true;
}
function findSquare(gray:any,targetX:number,targetY:number,threshold:number,dpi:number):
  {x:number;y:number}|null {
  const sx=Math.ceil(mmToPx(8,dpi)),sy=Math.ceil(mmToPx(1.7,dpi));
  const left=Math.max(0,Math.round(targetX)-sx),top=Math.max(0,Math.round(targetY)-sy);
  const w=Math.min(gray.cols-left,sx*2+1),h=Math.min(gray.rows-top,sy*2+1);
  if(w<12||h<10)return null;
  let roi:any=null,binary:any=null,contours:any=null,hierarchy:any=null;
  try{
    roi=gray.roi(new cv.Rect(left,top,w,h));binary=new cv.Mat();
    cv.threshold(roi,binary,threshold,255,cv.THRESH_BINARY_INV);
    contours=new cv.MatVector();hierarchy=new cv.Mat();
    cv.findContours(binary,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
    const nominal=mmToPx(2,dpi);
    let best:{x:number;y:number;score:number}|null=null;
    for(let i=0;i<contours.size();i++){
      const cnt=contours.get(i);
      try{
        const area=cv.contourArea(cnt),rect=cv.boundingRect(cnt);
        if(rect.width<nominal*.48||rect.width>nominal*1.65||
          rect.height<nominal*.48||rect.height>nominal*1.65||
          area<nominal*nominal*.18||area>nominal*nominal*2.4||
          Math.abs(rect.width/rect.height-1)>.5)continue;
        const x=left+rect.x+rect.width/2,y=top+rect.y+rect.height/2;
        const score=Math.hypot((x-targetX)/sx,(y-targetY)/sy);
        if(!best||score<best.score)best={x,y,score};
      }finally{cnt.delete();}
    }
    return best?{x:best.x,y:best.y}:null;
  }catch{return null;}finally{
    for(const x of [roi,binary,contours,hierarchy])try{x?.delete?.();}catch{/* cleanup */}
  }
}
export function correctMildPageWarp(rectified:any,dpi:number):
  {corrected:any;evidence:MeshEvidence}|null {
  let gray:any=null,mapX:any=null,mapY:any=null,corrected:any=null;
  try{
    gray=new cv.Mat();cv.cvtColor(rectified,gray,cv.COLOR_RGBA2GRAY);
    const threshold=Math.min(180,computeAdaptiveDarkThreshold(gray)+8);
    const controls:{left:Drift[];right:Drift[]}={left:[],right:[]};
    const start=OMR_LAYOUT.answers.rowStartY,spacing=OMR_LAYOUT.answers.rowSpacingY;
    for(let i=0;i<OMR_LAYOUT.answers.questionsPerCol;i+=2){
      const y=mmToPx(start+i*spacing,dpi);
      for(const [side,xMm] of [['left',13.3],['right',196.7]] as const){
        const x=mmToPx(xMm,dpi),found=findSquare(gray,x,y,threshold,dpi);
        if(found)controls[side].push({row:i,dx:found.x-x,dy:found.y-y});
      }
    }
    const maxDx=mmToPx(7.8,dpi),maxDy=mmToPx(1.5,dpi);
    if(!isPlausibleDrift(controls.left,maxDx,maxDy)||
      !isPlausibleDrift(controls.right,maxDx,maxDy))return null;
    // Conservative mesh: interpolate both side displacements across the
    // sheet. Holdout rows (2,4,..24) are never used as control points.
    mapX=new cv.Mat(rectified.rows,rectified.cols,cv.CV_32FC1);
    mapY=new cv.Mat(rectified.rows,rectified.cols,cv.CV_32FC1);
    const mx:Float32Array=mapX.data32F,my:Float32Array=mapY.data32F;
    const leftX=mmToPx(13.3,dpi),rightX=mmToPx(196.7,dpi);
    const topY=mmToPx(start-15,dpi),firstY=mmToPx(start,dpi);
    for(let y=0;y<rectified.rows;y++){
      const row=(y/mmToPx(1,dpi)-start)/spacing;
      const l=smoothDrift(controls.left,row),r=smoothDrift(controls.right,row);
      const fade=y<=topY?0:y>=firstY?1:(y-topY)/(firstY-topY);
      for(let x=0;x<rectified.cols;x++){
        const t=Math.max(0,Math.min(1,(x-leftX)/(rightX-leftX)));
        const dx=(l.dx+(r.dx-l.dx)*t)*fade;
        const dy=(l.dy+(r.dy-l.dy)*t)*fade;
        mx[y*rectified.cols+x]=x+dx;
        my[y*rectified.cols+x]=y+dy;
      }
    }
    corrected=new cv.Mat();
    cv.remap(rectified,corrected,mapX,mapY,cv.INTER_LINEAR,cv.BORDER_CONSTANT,
      new cv.Scalar(255,255,255,255));
    const out=corrected;corrected=null;
    return {corrected:out,evidence:{
      sampled:{left:controls.left.length,right:controls.right.length},
      controls,maxAbsShiftPx:[...controls.left,...controls.right]
        .reduce((v,p)=>Math.max(v,Math.abs(p.dx),Math.abs(p.dy)),0),
      holdoutRows:Array.from({length:12},(_,i)=>i*2+2)
    }};
  }catch{return null;}finally{
    for(const m of [gray,mapX,mapY,corrected])try{m?.delete?.();}catch{/* cleanup */}
  }
}
