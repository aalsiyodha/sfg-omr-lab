/** Experimental fallback for photographs with distracting squares behind paper.
 * The legacy first-quadrant geometric score can prefer similarly-sized
 * background objects and grayscale patches over the printed four corners.
 * This module only proposes quadrilaterals: the caller independently
 * verifies BOTH footer boxes, exact codeword and two timing tracks.
 */
import type { MarkerDetectionResult } from '../types';
declare const cv:any;
type M={x:number;y:number;w:number;h:number;cx:number;cy:number};
export interface CornerProposal{markers:MarkerDetectionResult;score:number;centres:number[][]}
const D=(a:M,b:M)=>Math.hypot(a.cx-b.cx,a.cy-b.cy);
export function proposeSheetCorners(thresholded:any,W:number,H:number,limit=16):CornerProposal[]{
 const contours=new cv.MatVector(),hierarchy=new cv.Mat();
 const points:M[]=[];
 try{
  cv.findContours(thresholded,contours,hierarchy,cv.RETR_LIST,cv.CHAIN_APPROX_SIMPLE);
  const nominal=W*H*49/(210*297);
  for(let i=0;i<contours.size();i++){
   const contour=contours.get(i);
   try{
    const area=cv.contourArea(contour);
    if(area<Math.max(60,nominal*.20)||area>nominal*3.5)continue;
    const r=cv.boundingRect(contour);
    if(r.width<7||r.height<7||Math.abs(r.width/r.height-1)>.42)continue;
    if(area/(r.width*r.height)<.68)continue;
    points.push({x:r.x,y:r.y,w:r.width,h:r.height,
      cx:r.x+r.width/2,cy:r.y+r.height/2});
   }finally{contour.delete();}
  }
 }finally{hierarchy.delete();contours.delete();}
 const groups=[0,1,2,3].map(i=>{
  const left=i%2===0,upper=i<2;
  const filtered=points.filter(p=>(left?p.cx<W*.46:p.cx>W*.54)&&
   (upper?p.cy<H*.30:p.cy>H*.57&&p.cy<H*.97));
  // Prefer similarly sized printed 7-mm markers but leave enough proposals
  // to handle perspective scaling. Avoid selecting just the most extreme
  // contours, which may belong to background objects.
  return filtered.sort((a,b)=>Math.abs(a.w-a.h)-Math.abs(b.w-b.h)||
   (upper?a.cy-b.cy:b.cy-a.cy)).slice(0,20);
 });
 const proposals:CornerProposal[]=[];
 const [TL,TR,BL,BR]=groups;
 for(const tl of TL)for(const tr of TR){
  const top=D(tl,tr);
  if(top<W*.4||Math.abs(tl.cy-tr.cy)>H*.09)continue;
  for(const bl of BL){
   const left=D(tl,bl);
   if(left<H*.4)continue;
   for(const br of BR){
    const bottom=D(bl,br),right=D(tr,br);
    if(bottom<W*.4||Math.abs(bl.cy-br.cy)>H*.09)continue;
    if(Math.abs(top-bottom)/Math.max(top,bottom)>.35||
      Math.abs(left-right)/Math.max(left,right)>.35)continue;
    const ratio=(top+bottom)/(left+right);
    if(Math.abs(ratio/(191/278)-1)>.22)continue;
    const ordered=[tl,tr,br,bl];
    const turns=ordered.map((p,i)=>{
     const next=ordered[(i+1)%4],after=ordered[(i+2)%4];
     return (next.cx-p.cx)*(after.cy-next.cy)-
       (next.cy-p.cy)*(after.cx-next.cx);
    });
    if(turns.some(v=>v<=0))continue;
    const sizes=[tl,tr,bl,br].map(p=>Math.sqrt(p.w*p.h));
    const spread=(Math.max(...sizes)-Math.min(...sizes))/Math.max(...sizes);
    if(spread>.4)continue;
    const score=4*Math.abs(Math.log(ratio/(191/278)))+
      spread*2+3*Math.abs(tl.cy-tr.cy)/H+
      3*Math.abs(bl.cy-br.cy)/H+
      Math.abs(top-bottom)/Math.max(top,bottom)+
      Math.abs(left-right)/Math.max(left,right);
    const point=(p:M)=>({x:p.cx,y:p.cy});
    proposals.push({score,centres:[tl,tr,bl,br].map(p=>[p.cx,p.cy]),
     markers:{found:true,count:4,validGeometry:true,error:undefined,
      topLeft:point(tl),topRight:point(tr),bottomLeft:point(bl),bottomRight:point(br)}});
   }
  }
 }
 const seen=new Set<string>();
 return proposals.sort((a,b)=>a.score-b.score).filter(p=>{
  const key=JSON.stringify(p.centres);
  if(seen.has(key))return false;seen.add(key);return true;
 }).slice(0,limit);
}
