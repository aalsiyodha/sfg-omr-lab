/**
 * Exp 3.7.9 — QR-oriented, rotation-independent printed-corner proposals.
 *
 * Existing detector's camera-frame 0.46/0.54 quadrant gate remains untouched
 * for the proven fast path. Only on unsuccessful registration do we enumerate
 * plausible black-square contours in the QR's PHYSICAL sheet coordinate frame
 * instead of assuming they lie in the four camera image quadrants.
 *
 * These are *proposals*, never scoring evidence: the main orchestrator still
 * requires the expected SFGOMR1 QR and independent left+right timing tracks.
 */
import { OMR_LAYOUT } from '../config/omrLayout';
import type { MarkerDetectionResult } from '../types';
import type { locateQRInPhoto } from './qrDecoder';
declare const cv:any;

type LocatedQR=ReturnType<typeof locateQRInPhoto>;
type Point={x:number;y:number};
type Marker={x:number;y:number;width:number;height:number;area:number;
  cx:number;cy:number;u:number;v:number;index:number};
type CornerName='topLeft'|'topRight'|'bottomLeft'|'bottomRight';
export interface QrGuidedCornerProposal {
  markers:MarkerDetectionResult;
  score:number;
  quadrantViolations:number;
  anchorIds:number[];
}
export interface QrGuidedCornerDiagnostic {
  reason:string;
  contourCount:number;
  squareCandidates:number;
  rejectedArea:number;
  rejectedAspect:number;
  rejectedSolidity:number;
  inCameraDeadzone:number;
  quadrantViolationsInBest:number|null;
  proposed:number;
  bestScore:number|null;
  qrAxisDeterminant:number|null;
}
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const point=(m:Marker):Point=>({x:m.cx,y:m.cy});
const allNames:CornerName[]=['topLeft','topRight','bottomLeft','bottomRight'];
const center=(m:{xMm:number;yMm:number;sizeMm:number})=>({
  x:m.xMm+m.sizeMm/2,y:m.yMm+m.sizeMm/2
});
const target:Record<CornerName,{u:number;v:number}>=Object.fromEntries(
  allNames.map(name=>{
    const m=center(OMR_LAYOUT.markers[name]);
    return [name,{u:(m.x-OMR_LAYOUT.qr.xMm)/OMR_LAYOUT.qr.sizeMm,
      v:(m.y-OMR_LAYOUT.qr.yMm)/OMR_LAYOUT.qr.sizeMm}];
  })
) as Record<CornerName,{u:number;v:number}>;

/** Pure geometry, exported for synthetic rotation/translation regression tests. */
export function qrFrameCoordinates(qrCorners:Point[],p:Point):{u:number;v:number}|null {
  if(qrCorners.length!==4)return null;
  const tl=qrCorners[0],tr=qrCorners[1],bl=qrCorners[3];
  const ux=tr.x-tl.x,uy=tr.y-tl.y,vx=bl.x-tl.x,vy=bl.y-tl.y;
  const det=ux*vy-uy*vx;
  if(!Number.isFinite(det)||Math.abs(det)<50)return null;
  const dx=p.x-tl.x,dy=p.y-tl.y;
  return {u:(dx*vy-dy*vx)/det,v:(ux*dy-uy*dx)/det};
}
const cornerCost=(m:Marker,name:CornerName)=>{
  const t=target[name];
  // Far corners have 8-13 QR-side extrapolation: use broad, perspective-
  // tolerant proposal weights; the exact page homography is independently
  // validated later using the actual physical marker correspondences.
  const su=2.0+Math.abs(t.u)*.34;
  const sv=2.0+Math.abs(t.v)*.34;
  return Math.hypot((m.u-t.u)/su,(m.v-t.v)/sv);
};
const cross=(a:Point,b:Point,c:Point)=>
  (b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
const area=(pts:Point[])=>Math.abs(pts.reduce((sum,p,i)=>{
  const q=pts[(i+1)%pts.length];return sum+p.x*q.y-p.y*q.x;
},0))/2;
export function rankQrGuidedMarkers(
  markers:Marker[],qr:LocatedQR,width:number,height:number,maxProposals=4
):QrGuidedCornerProposal[] {
  if(!qr.valid||qr.corners.length!==4||markers.length<4)return [];
  const [tl,tr,,bl]=qr.corners;
  const qrSign=Math.sign(cross(tl,tr,bl));
  if(!qrSign)return [];
  const shortlist=Object.fromEntries(allNames.map(name=>[name,
    [...markers].sort((a,b)=>cornerCost(a,name)-cornerCost(b,name)).slice(0,8)
  ])) as Record<CornerName,Marker[]>;
  const found:QrGuidedCornerProposal[]=[];
  const ids=new Set<string>();
  for(const tlm of shortlist.topLeft) for(const trm of shortlist.topRight)
    for(const brm of shortlist.bottomRight) for(const blm of shortlist.bottomLeft){
      const selected=[tlm,trm,brm,blm];
      if(new Set(selected.map(m=>m.index)).size!==4)continue;
      const pts=selected.map(point);
      const turns=pts.map((p,i)=>qrSign*cross(p,pts[(i+1)%4],pts[(i+2)%4]));
      if(turns.some(x=>x<=0))continue;
      const sheetArea=area(pts);
      if(sheetArea<width*height*.065||sheetArea>width*height*.92)continue;
      const top=distance(pts[0],pts[1]),bottom=distance(pts[3],pts[2]);
      const left=distance(pts[0],pts[3]),right=distance(pts[1],pts[2]);
      if(Math.min(top,bottom,left,right)<Math.min(width,height)*.16)continue;
      if(Math.max(top,bottom)/Math.min(top,bottom)>3.2 ||
        Math.max(left,right)/Math.min(left,right)>3.2)continue;
      // Compare side lengths in the QR-relative oriented coordinate frame,
      // not in the camera's horizontal/vertical frame. The ratio is a soft
      // score, never a portrait-only hard rejection.
      const widthU=(trm.u-tlm.u+brm.u-blm.u)/2;
      const heightV=(blm.v-tlm.v+brm.v-trm.v)/2;
      if(widthU<2||heightV<3)continue;
      const expectedWidth=target.topRight.u-target.topLeft.u;
      const expectedHeight=target.bottomLeft.v-target.topLeft.v;
      const ratio=(widthU/heightV)/(expectedWidth/expectedHeight);
      if(ratio<.28||ratio>3.6)continue;
      // Four corners should have broadly comparable printed-square size.
      const sizes=selected.map(m=>Math.sqrt(m.width*m.height));
      const spread=Math.max(...sizes)/Math.max(1,Math.min(...sizes));
      if(spread>5)continue;
      const shapePenalty=.5*Math.abs(Math.log(ratio))+
        .25*Math.log(Math.max(1,spread));
      const residual=selected.reduce((sum,m,i)=>
        sum+cornerCost(m,['topLeft','topRight','bottomRight','bottomLeft'][i] as CornerName),0);
      const score=Number((residual+shapePenalty).toFixed(4));
      const key=selected.map(x=>x.index).join(',');
      if(ids.has(key))continue;
      ids.add(key);
      const matches=[
        tlm.cx<width*.46&&tlm.cy<height*.46,
        trm.cx>=width*.54&&trm.cy<height*.46,
        brm.cx>=width*.54&&brm.cy>=height*.54,
        blm.cx<width*.46&&blm.cy>=height*.54
      ];
      const violations=matches.filter(ok=>!ok).length;
      const markersOut:MarkerDetectionResult={
        found:true,count:4,validGeometry:true,
        topLeft:point(tlm),topRight:point(trm),
        bottomLeft:point(blm),bottomRight:point(brm)
      };
      found.push({markers:markersOut,score,quadrantViolations:violations,
        anchorIds:selected.map(x=>x.index)});
    }
  return found.sort((a,b)=>a.score-b.score).slice(0,Math.max(1,Math.min(6,maxProposals)));
}
export function proposeQrGuidedCorners(
  thresholded:any,width:number,height:number,qr:LocatedQR,maxProposals=4
):{proposals:QrGuidedCornerProposal[];diagnostics:QrGuidedCornerDiagnostic}{
  const diagnostic:QrGuidedCornerDiagnostic={reason:'pending',
    contourCount:0,squareCandidates:0,rejectedArea:0,rejectedAspect:0,
    rejectedSolidity:0,inCameraDeadzone:0,
    quadrantViolationsInBest:null,proposed:0,bestScore:null,qrAxisDeterminant:null};
  const q=qr.corners;
  if(!qr.valid||q.length!==4){
    diagnostic.reason='independent-source-qr-unavailable';
    return {proposals:[],diagnostics:diagnostic};
  }
  const du={x:q[1].x-q[0].x,y:q[1].y-q[0].y};
  const dv={x:q[3].x-q[0].x,y:q[3].y-q[0].y};
  diagnostic.qrAxisDeterminant=Number((du.x*dv.y-du.y*dv.x).toFixed(2));
  if(Math.abs(diagnostic.qrAxisDeterminant)<50){
    diagnostic.reason='qr-axes-degenerate';
    return {proposals:[],diagnostics:diagnostic};
  }
  const contours=new cv.MatVector(),hierarchy=new cv.Mat();
  const candidates:Marker[]=[];
  try{
    cv.findContours(thresholded,contours,hierarchy,
      cv.RETR_LIST,cv.CHAIN_APPROX_SIMPLE);
    diagnostic.contourCount=contours.size();
    for(let i=0;i<contours.size();i++){
      const shape=contours.get(i);
      try{
        const inkArea=cv.contourArea(shape);
        // Unlike the old frame-scaled filter, this tolerant discovery gate
        // can see distant small sheets. Accepting a proposal still requires
        // the full downstream QR+bilateral-timing independent verification.
        if(inkArea<48||inkArea>Math.max(8000,width*height*.025)){
          diagnostic.rejectedArea++;continue;
        }
        const bounds=cv.boundingRect(shape);
        if(bounds.width<6||bounds.height<6||
          Math.abs(bounds.width/bounds.height-1)>.65){
          diagnostic.rejectedAspect++;continue;
        }
        if(inkArea/(bounds.width*bounds.height)<.47){
          diagnostic.rejectedSolidity++;continue;
        }
        const x=bounds.x+bounds.width/2,y=bounds.y+bounds.height/2;
        const projected=qrFrameCoordinates(q,{x,y});
        if(!projected)continue;
        if((x>=width*.46&&x<width*.54)||
          (y>=height*.46&&y<height*.54))diagnostic.inCameraDeadzone++;
        candidates.push({x:bounds.x,y:bounds.y,width:bounds.width,
          height:bounds.height,area:inkArea,cx:x,cy:y,
          u:projected.u,v:projected.v,index:i});
      }finally{shape.delete();}
    }
    diagnostic.squareCandidates=candidates.length;
    const proposals=rankQrGuidedMarkers(candidates,qr,width,height,maxProposals);
    diagnostic.proposed=proposals.length;
    diagnostic.bestScore=proposals[0]?.score??null;
    diagnostic.quadrantViolationsInBest=proposals[0]?.quadrantViolations??null;
    diagnostic.reason=proposals.length?'qr-guided-rotated-sheet-proposals':
      'no-valid-qr-oriented-four-corner-combination';
    return {proposals,diagnostics:diagnostic};
  }catch(error){
    diagnostic.reason='qr-oriented-square-detector-error: '+String(error);
    return {proposals:[],diagnostics:diagnostic};
  }finally{contours.delete();hierarchy.delete();}
}
