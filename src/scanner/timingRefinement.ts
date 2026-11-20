/**
 * Refine a nearly correct fiducial homography using independent printed
 * timing squares. Four ArUco centres restore orientation, but perspective
 * skew / paper curl can displace the 2 mm timing lattice by 10-25 output
 * pixels (v5 2026-11-20). A second *bounded* homography fitted to the four
 * extreme timing marks restores the exact page grid.
 *
 * Rescue is never accepted by itself: caller must RECHECK both the QR
 * position and the original exact 50-row timing verifier. This module does
 * not inspect answers, their darkness or their labels.
 */
import { OMR_LAYOUT, mmToPx } from '../config/omrLayout';
import { computeAdaptiveDarkThreshold } from './bubbleDetector';
declare const cv:any;

export interface TimingPoint {x:number;y:number}
export interface TimingRefinement {
  corrected:any;
  transform:any;
  anchors: Record<string,TimingPoint>;
  shifts:Record<string,{dx:number;dy:number}>;
}
export function timingAnchorTargets(dpi:number):Record<string,TimingPoint>{
  const first=OMR_LAYOUT.answers.rowStartY;
  const last=first+(OMR_LAYOUT.answers.questionsPerCol-1)*OMR_LAYOUT.answers.rowSpacingY;
  return {
    leftTop:{x:mmToPx(13.3,dpi),y:mmToPx(first,dpi)},
    rightTop:{x:mmToPx(196.7,dpi),y:mmToPx(first,dpi)},
    rightBottom:{x:mmToPx(196.7,dpi),y:mmToPx(last,dpi)},
    leftBottom:{x:mmToPx(13.3,dpi),y:mmToPx(last,dpi)},
  };
}
export function boundedTimingGeometry(
  found:Record<string,TimingPoint>,targets:Record<string,TimingPoint>,dpi:number
):boolean{
  const keys=['leftTop','rightTop','rightBottom','leftBottom'];
  if(keys.some(k=>!found[k]||!Number.isFinite(found[k].x)||!Number.isFinite(found[k].y)))return false;
  const maxX=mmToPx(3.7,dpi),maxY=mmToPx(5.8,dpi);
  if(keys.some(k=>Math.abs(found[k].x-targets[k].x)>maxX ||
      Math.abs(found[k].y-targets[k].y)>maxY))return false;
  // Prevent a spurious square / crossed winding from defining registration.
  const lt=found.leftTop,rt=found.rightTop,rb=found.rightBottom,lb=found.leftBottom;
  const cross=(a:TimingPoint,b:TimingPoint,c:TimingPoint)=>
    (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  return cross(lt,rt,rb)>0 && cross(rt,rb,lb)>0 &&
    cross(rb,lb,lt)>0 && cross(lb,lt,rt)>0;
}
function locateTimingSquare(gray:any,target:TimingPoint,threshold:number,dpi:number,priorShiftY=0):TimingPoint|null{
  const dx=Math.ceil(mmToPx(3.7,dpi));
  const dy=Math.ceil(mmToPx(5.8,dpi));
  const left=Math.max(0,Math.round(target.x)-dx);
  const top=Math.max(0,Math.round(target.y)-dy);
  const width=Math.min(gray.cols-left,2*dx+1);
  const height=Math.min(gray.rows-top,2*dy+1);
  if(width<12||height<12)return null;
  let roi:any=null,binary:any=null,contours:any=null,hierarchy:any=null;
  try{
    roi=gray.roi(new cv.Rect(left,top,width,height));
    binary=new cv.Mat();
    cv.threshold(roi,binary,threshold,255,cv.THRESH_BINARY_INV);
    contours=new cv.MatVector();
    hierarchy=new cv.Mat();
    cv.findContours(binary,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
    const nominal=mmToPx(2,dpi);
    const candidates:{x:number;y:number;rank:number}[]=[];
    for(let i=0;i<contours.size();i++){
      const c=contours.get(i);
      try{
        const rect=cv.boundingRect(c);
        const area=cv.contourArea(c);
        if(rect.width<nominal*.45||rect.width>nominal*1.85||
           rect.height<nominal*.45||rect.height>nominal*1.85||
           area<nominal*nominal*.16||area>nominal*nominal*2.8)continue;
        if(Math.abs(rect.width/rect.height-1)>.55)continue;
        const x=left+rect.x+rect.width/2;
        const y=top+rect.y+rect.height/2;
        const delta=Math.hypot((x-target.x)/dx,(y-target.y-priorShiftY)/dy);
        const shape=Math.abs(Math.log(Math.max(1,area)/(nominal*nominal)));
        candidates.push({x,y,rank:delta+.13*shape});
      }finally{c.delete();}
    }
    candidates.sort((a,b)=>a.rank-b.rank);
    return candidates.length?{x:candidates[0].x,y:candidates[0].y}:null;
  }catch{return null;}finally{
    for(const m of [roi,binary,contours,hierarchy])try{m?.delete?.();}catch{/* release WASM */ }
  }
}
export function refineByTimingSquares(corrected:any,dpi:number):TimingRefinement|null{
  let gray:any=null,input:any=null,output:any=null,transform:any=null,warped:any=null;
  try{
    gray=new cv.Mat();
    cv.cvtColor(corrected,gray,cv.COLOR_RGBA2GRAY);
    const targets=timingAnchorTargets(dpi);
    const threshold=Math.min(180,computeAdaptiveDarkThreshold(gray)+8);
    const anchors:Record<string,TimingPoint>={};
    const shifts:Record<string,{dx:number;dy:number}>={};
    for(const key of ['leftTop','rightTop','rightBottom','leftBottom']){
      // The bottom candidate can be closer to the preceding timing row
      // than its own target when perspective drift exceeds half a row.
      // Use the shift observed at the same-side TOP anchor to preserve
      // row identity, never simply choose the nearest dark square.
      const prior=key==='leftBottom'?shifts.leftTop?.dy??0
        :key==='rightBottom'?shifts.rightTop?.dy??0 : 0;
      const found=locateTimingSquare(gray,targets[key],threshold,dpi,prior);
      if(!found)return null;
      anchors[key]=found;
      shifts[key]={dx:Number((found.x-targets[key].x).toFixed(1)),
        dy:Number((found.y-targets[key].y).toFixed(1))};
    }
    if(!boundedTimingGeometry(anchors,targets,dpi))return null;
    const keys=['leftTop','rightTop','rightBottom','leftBottom'];
    input=cv.matFromArray(4,1,cv.CV_32FC2,keys.flatMap(k=>[anchors[k].x,anchors[k].y]));
    output=cv.matFromArray(4,1,cv.CV_32FC2,keys.flatMap(k=>[targets[k].x,targets[k].y]));
    transform=cv.getPerspectiveTransform(input,output);
    warped=new cv.Mat();
    cv.warpPerspective(corrected,warped,transform,new cv.Size(corrected.cols,corrected.rows));
    return {corrected:warped,transform,anchors,shifts};
  }catch{
    warped?.delete?.();transform?.delete?.();
    return null;
  }finally{
    for(const m of [gray,input,output])try{m?.delete?.();}catch{/* WASM cleanup */ }
  }
}
