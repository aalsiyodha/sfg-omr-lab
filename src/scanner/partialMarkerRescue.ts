/** Failure-only recovery from the two independently decoded bottom ArUco IDs.
 *
 * No four-corner success required: discover SOLID upper corner squares on the
 * original binary image, then combine them with the ID-bearing ArUco pair.
 * This does not accept an OMR by itself. The caller MUST verify both QR
 * identity and BOTH 25-mark timing tracks after the warp.
 */
import type {MarkerDetectionResult} from '../types';
import type {ArucoRegistration} from './arucoDetector';
import {hybridAnchorEvidence} from './hybridRegistration';
declare const cv:any;
export interface PartialProposal {
  markers:MarkerDetectionResult;
  score:number;
  source:string;
  topLeft:{x:number;y:number};
  topRight:{x:number;y:number};
}
export interface PartialDiscovery {
  candidates:PartialProposal[];
  evidence:{reason:string;arucoIds:number[];contours:number;upperSquares:number;
    testedPairs:number;validPairs:number;durationMs:number};
}
type Square={x:number;y:number;area:number;width:number;height:number};
export function discoverUpperPairs(
 binary:any,arucos:ArucoRegistration,sourceName:string,maxPairs=10
):PartialDiscovery{
 const began=performance.now();
 const ids=Object.keys(arucos.points).map(Number);
 const evidence={reason:'',arucoIds:ids,contours:0,upperSquares:0,
   testedPairs:0,validPairs:0,durationMs:0};
 const finish=(reason:string,candidates:PartialProposal[]=[]):PartialDiscovery=>{
   evidence.reason=reason;evidence.durationMs=Math.round(performance.now()-began);
   return {candidates,evidence};
 };
 const bottomLeft=arucos.points[2],bottomRight=arucos.points[3];
 if(!bottomLeft||!bottomRight)return finish('Bottom ArUco IDs 2 and 3 not both decoded');
 if(bottomRight.x-bottomLeft.x<35)return finish('ArUco baseline too short or reversed');
 const W=binary.cols,H=binary.rows;
 const bottomY=Math.min(bottomLeft.y,bottomRight.y);
 const baseline=Math.hypot(bottomRight.x-bottomLeft.x,bottomRight.y-bottomLeft.y);
 const topLimit=Math.min(H*.49,bottomY-Math.max(H*.26,baseline*.65));
 const contours=new cv.MatVector(),hierarchy=new cv.Mat();
 const squares:Square[]=[];
 try{
   cv.findContours(binary,contours,hierarchy,cv.RETR_LIST,cv.CHAIN_APPROX_SIMPLE);
   evidence.contours=contours.size();
   const imageArea=W*H;
   for(let i=0;i<contours.size();i++){
     const c=contours.get(i);
     try{
       const area=cv.contourArea(c);
       // Top marker 7x7 mm projected under perspective may be far smaller
       // than area estimated using the whole camera frame.
       if(area<Math.max(30,imageArea*.000018)||area>imageArea*.004)continue;
       const r=cv.boundingRect(c),ratio=r.width/Math.max(1,r.height);
       if(r.width<5||r.height<5||Math.abs(ratio-1)>.42)continue;
       if(area/(r.width*r.height)<.67)continue;
       const x=r.x+r.width/2,y=r.y+r.height/2;
       // Search only above the answer grid and above the decoded bottom pair.
       if(y<H*.10||y>topLimit||x<W*.05||x>W*.95)continue;
       squares.push({x,y,area,width:r.width,height:r.height});
     }finally{c.delete();}
   }
 }finally{contours.delete();hierarchy.delete();}
 // Simplify near-duplicate contours around the same physical black square.
 const unique:Square[]=[];
 for(const p of squares.sort((a,b)=>b.area-a.area)){
   if(unique.some(q=>Math.hypot(q.x-p.x,q.y-p.y)<
       Math.max(5,Math.min(q.width,p.width)*.55)))continue;
   unique.push(p);
 }
 evidence.upperSquares=unique.length;
 const left=unique.filter(p=>p.x<bottomLeft.x+baseline*.1)
   .sort((a,b)=>a.y-b.y).slice(0,18);
 const right=unique.filter(p=>p.x>bottomRight.x-baseline*.1)
   .sort((a,b)=>a.y-b.y).slice(0,18);
 const proposals:PartialProposal[]=[];
 for(const tl of left)for(const tr of right){
   evidence.testedPairs++;
   const upperWidth=Math.hypot(tr.x-tl.x,tr.y-tl.y);
   const yGap=Math.abs(tr.y-tl.y);
   if(upperWidth<baseline*.9||upperWidth>baseline*3.6)continue;
   if(yGap>H*.18)continue;
   const markers:MarkerDetectionResult={
     found:true,count:4,validGeometry:true,topLeft:{x:tl.x,y:tl.y},
     topRight:{x:tr.x,y:tr.y},bottomLeft:{...bottomLeft},
     bottomRight:{...bottomRight}
   };
   const check=hybridAnchorEvidence(markers,arucos);
   if(!check.usable)continue;
   evidence.validPairs++;
   // Penalize extreme tilt and marker size disagreement. Both ArUco IDs
   // remain fixed correspondences, not arbitrary dark squares.
   const sizeSpread=Math.abs(Math.log(tl.area/tr.area));
   const topY=(tl.y+tr.y)/2;
   const vertical=(bottomY-topY)/H;
   const score=yGap/H*2+sizeSpread*.45+
     Math.abs(upperWidth/baseline-1.85)*.17+
     Math.abs(vertical-.64)*.65;
   proposals.push({markers,score,source:sourceName,
     topLeft:markers.topLeft!,topRight:markers.topRight!});
 }
 proposals.sort((a,b)=>a.score-b.score);
 return finish(proposals.length?'Upper-corner pairs ranked against independently decoded bottom IDs':
   'No geometrically consistent upper-marker pair',proposals.slice(0,Math.max(1,maxPairs)));
}
