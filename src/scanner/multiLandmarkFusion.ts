/**
 * Failure-only, genuine multi-landmark alignment: find ONE homography from
 * the independently measured QR, printed ArUco IDs, corner squares, and
 * midpoint squares. Supports partial marker detections; each anchor is only
 * evidence, not identity or proof of a valid answer grid.
 *
 * Four-point deterministic RANSAC is used instead of cv.findHomography,
 * which is absent from some OpenCV.js WASM distributions. Score all families
 * by the SAME projected model, refit using robust weighted least squares,
 * then leave final exact QR and both side timing gates to scanOrchestrator.
 */
import { OMR_LAYOUT, mmToPx } from '../config/omrLayout';
import { ARUCO_MARKERS_MM, type ArucoRegistration } from './arucoDetector';
import { MIDPOINTS_MM, type MidpointRegistration } from './midpointDetector';
import type { MarkerDetectionResult } from '../types';
import type { PerspectiveResult } from './perspectiveCorrection';
import type { locateQRInPhoto } from './qrDecoder';
declare const cv:any;

type Pt={x:number;y:number};
type Family='qr'|'aruco'|'corner'|'midpoint';
export type FusionAnchor={source:Pt;target:Pt;family:Family;name:string};
type Matrix=readonly number[];
export interface MultiFusionEvidence{
  available:number;families:string[];modelCount:number;
  inliers:number;inlierFamilies:string[];nonQrInliers:number;
  medianErrorPx:number;maximumErrorPx:number;
  selected:string[];rejected:string[];reason:string;
}
export interface MultiFusionResult{
  perspective:PerspectiveResult;evidence:MultiFusionEvidence;
}
const isPoint=(p:Pt|null|undefined):p is Pt=>
  Boolean(p&&Number.isFinite(p.x)&&Number.isFinite(p.y));
const quadArea=(points:Pt[])=>Math.abs(points.reduce((sum,p,i)=>{
  const q=points[(i+1)%points.length];
  return sum+p.x*q.y-q.x*p.y;
},0))/2;
const mm=(p:Pt,dpi:number):Pt=>({x:mmToPx(p.x,dpi),y:mmToPx(p.y,dpi)});
const qrDest=(dpi:number):Pt[]=>{
  const q=OMR_LAYOUT.qr;
  return [
    {x:q.xMm,y:q.yMm},{x:q.xMm+q.sizeMm,y:q.yMm},
    {x:q.xMm+q.sizeMm,y:q.yMm+q.sizeMm},{x:q.xMm,y:q.yMm+q.sizeMm}
  ].map(p=>mm(p,dpi));
};
export function assembleFusionAnchors(
  qr:ReturnType<typeof locateQRInPhoto>|null,
  corner:MarkerDetectionResult|undefined,
  midpoint:MidpointRegistration|undefined,
  aruco:ArucoRegistration|undefined,
  dpi:number
):FusionAnchor[]{
  const anchors:FusionAnchor[]=[];
  const add=(source:Pt|null|undefined,target:Pt,family:Family,name:string)=>{
    if(isPoint(source))anchors.push({source,target,family,name});
  };
  if(qr?.valid&&qr.corners.length===4)
    qr.corners.forEach((p,i)=>add(p,qrDest(dpi)[i],'qr','qr-'+i));
  // Do not trust rejected four-corner combinations as individual measurements.
  // Each trusted ArUco ID is independently decoded and can be used even if
  // the group is incomplete (aruco.found===false).
  if(aruco)for(const marker of ARUCO_MARKERS_MM)
    add(aruco.points[marker.id],mm({x:marker.x,y:marker.y},dpi),
      'aruco','aruco-'+marker.id);
  if(corner?.found){
    for(const field of ['topLeft','topRight','bottomRight','bottomLeft'] as const){
      const marker=OMR_LAYOUT.markers[field];
      add(corner[field],mm({x:marker.xMm+marker.sizeMm/2,
        y:marker.yMm+marker.sizeMm/2},dpi),'corner',field);
    }
  }
  if(midpoint?.found)for(const side of ['top','right','bottom','left'] as const)
    add(midpoint[side],mm(MIDPOINTS_MM[side],dpi),'midpoint',side);
  return anchors;
}
function proj(h:Matrix,p:Pt):Pt|null{
  const d=h[6]*p.x+h[7]*p.y+h[8];
  if(!Number.isFinite(d)||Math.abs(d)<1e-9)return null;
  const x=(h[0]*p.x+h[1]*p.y+h[2])/d;
  const y=(h[3]*p.x+h[4]*p.y+h[5])/d;
  return Number.isFinite(x)&&Number.isFinite(y)?{x,y}:null;
}
function error(h:Matrix,a:FusionAnchor):number{
  const p=proj(h,a.source);
  return p?Math.hypot(p.x-a.target.x,p.y-a.target.y):Infinity;
}
/** Pivoted 8x8 system solver; all coordinates normalized to 0..2 scale. */
function solve8(matrix:number[][],right:number[]):number[]|null{
  const a=matrix.map((row,i)=>[...row,right[i]]);
  for(let col=0;col<8;col++){
    let pivot=col;
    for(let row=col+1;row<8;row++)
      if(Math.abs(a[row][col])>Math.abs(a[pivot][col]))pivot=row;
    if(!Number.isFinite(a[pivot][col])||Math.abs(a[pivot][col])<1e-11)return null;
    [a[col],a[pivot]]=[a[pivot],a[col]];
    const inv=1/a[col][col];
    for(let c=col;c<9;c++)a[col][c]*=inv;
    for(let row=0;row<8;row++)if(row!==col){
      const f=a[row][col];
      for(let c=col;c<9;c++)a[row][c]-=f*a[col][c];
    }
  }
  const x=a.map(row=>row[8]);
  return x.every(Number.isFinite)?x:null;
}
/** Normalized least squares for a homography with h33=1. */
export function solveHomography(
  anchors:FusionAnchor[],weights?:number[]
):number[]|null{
  if(anchors.length<4)return null;
  // The camera ROI is <~2000px; all target positions are ~1000-1800px.
  // Coordinate normalization avoids severe normal-equation conditioning.
  const sx=Math.max(1,...anchors.map(a=>Math.abs(a.source.x)));
  const sy=Math.max(1,...anchors.map(a=>Math.abs(a.source.y)));
  const tx=Math.max(1,...anchors.map(a=>Math.abs(a.target.x)));
  const ty=Math.max(1,...anchors.map(a=>Math.abs(a.target.y)));
  const lhs=Array.from({length:8},()=>Array(8).fill(0));
  const rhs=Array(8).fill(0);
  for(let i=0;i<anchors.length;i++){
    const a=anchors[i],x=a.source.x/sx,y=a.source.y/sy;
    const u=a.target.x/tx,v=a.target.y/ty;
    const w=weights?.[i]??1;
    const rows:[[number[],number],[number[],number]]=[
      [[x,y,1,0,0,0,-u*x,-u*y],u],
      [[0,0,0,x,y,1,-v*x,-v*y],v],
    ];
    for(const [row,val] of rows){
      for(let j=0;j<8;j++){
        rhs[j]+=w*row[j]*val;
        for(let k=0;k<8;k++)lhs[j][k]+=w*row[j]*row[k];
      }
    }
  }
  const h=solve8(lhs,rhs);if(!h)return null;
  return [h[0]*tx/sx,h[1]*tx/sy,h[2]*tx,
    h[3]*ty/sx,h[4]*ty/sy,h[5]*ty,
    h[6]/sx,h[7]/sy,1];
}
const median=(xs:number[])=>{
  const s=[...xs].sort((a,b)=>a-b);
  if(!s.length)return Infinity;
  const m=Math.floor(s.length/2);
  return s.length%2?s[m]:(s[m-1]+s[m])/2;
};
function countFamilies(items:FusionAnchor[]):string[]{
  return [...new Set(items.map(a=>a.family))];
}
function spatiallySound(seed:FusionAnchor[],dpi:number):boolean{
  if(countFamilies(seed).length<2)return false;
  // A QR-alone quartet is not useful for A4 projection. Require landmarks
  // distant from the QR, typically two independently decoded bottom ArUcos.
  const nonQR=seed.filter(a=>a.family!=='qr');
  if(nonQR.length<2)return false;
  const ys=seed.map(a=>a.target.y),xs=seed.map(a=>a.target.x);
  const pageHeight=mmToPx(OMR_LAYOUT.page.heightMm,dpi);
  const pageWidth=mmToPx(OMR_LAYOUT.page.widthMm,dpi);
  if(Math.max(...ys)-Math.min(...ys)<pageHeight*.35||
     Math.max(...xs)-Math.min(...xs)<pageWidth*.23)return false;
  const sourceArea=quadArea(seed.map(a=>a.source));
  // Ordered quad area is unreliable for shuffled RANSAC combinations;
  // instead compute bounding spread, and reject tiny QR-cluster seeds.
  const sx=seed.map(a=>a.source.x),sy=seed.map(a=>a.source.y);
  return (Math.max(...sx)-Math.min(...sx))>70 &&
    (Math.max(...sy)-Math.min(...sy))>70 && Number.isFinite(sourceArea);
}
export function fitMultiLandmarkGeometry(
  anchors:FusionAnchor[],dpi:number,
  maxModels=350
):{matrix:number[];evidence:MultiFusionEvidence}|null{
  const available=anchors.length;
  if(available<5||countFamilies(anchors).length<2)return null;
  const threshold=mmToPx(2.4,dpi); // 14.2 px at 150 DPI
  let best:{matrix:number[];score:number;indices:number[];median:number}|null=null;
  let tested=0;
  // Enumerate geometrically diverse quartets, preferring QR+ArUco first,
  // avoiding nondeterministic random RANSAC behavior in regression runs.
  const indices=anchors.map((_,i)=>i);
  const families=(i:number)=>anchors[i].family;
  const order=[...indices].sort((a,b)=>{
    const rank=(i:number)=>families(i)==='aruco'?0:
      families(i)==='qr'?1:families(i)==='midpoint'?2:3;
    return rank(a)-rank(b)||a-b;
  });
  outer:for(let i=0;i<order.length-3;i++)
  for(let j=i+1;j<order.length-2;j++)
  for(let k=j+1;k<order.length-1;k++)
  for(let l=k+1;l<order.length;l++){
    const ids=[order[i],order[j],order[k],order[l]];
    const seed=ids.map(n=>anchors[n]);
    if(!spatiallySound(seed,dpi))continue;
    // A four-point exact solution from a small, spatially diverse sample.
    const matrix=solveHomography(seed);
    if(!matrix)continue;
    tested++;
    const errors=anchors.map(a=>error(matrix,a));
    const matched=indices.filter(n=>errors[n]<threshold);
    const inliers=matched.map(n=>anchors[n]);
    const nonQR=inliers.filter(a=>a.family!=='qr');
    if(nonQR.length<2||countFamilies(inliers).length<2)continue;
    const qrMatches=inliers.filter(a=>a.family==='qr').length;
    // QR supplies identity and local accuracy, but cannot outvote distant
    // printed landmarks via four tightly clustered corner samples.
    const score=nonQR.length*3+Math.min(qrMatches,2)*1.5+
      countFamilies(inliers).length*1.5-
      Math.min(20,median(matched.map(n=>errors[n])))*.12;
    const med=median(matched.map(n=>errors[n]));
    if(!best||score>best.score||
      (score===best.score&&med<best.median)){
      best={matrix,score,indices:matched,median:med};
    }
    if(tested>=maxModels)break outer;
  }
  if(!best)return null;
  let matrix:number[]=best.matrix;
  // Refit consensus using all available independent marker measurements,
  // with bounded robust weights. A single mistracked marker is not allowed
  // to drag the QR region or both far timing tracks.
  for(let iter=0;iter<3;iter++){
    const inliers=best.indices.map(n=>anchors[n]);
    if(inliers.length<4)break;
    const weights=inliers.map(a=>{
      const e=error(matrix,a);
      const familyWeight=a.family==='qr'?.6:
        a.family==='aruco'?1.6:a.family==='midpoint'?1.2:1;
      return familyWeight*Math.min(1,threshold/Math.max(1,e));
    });
    const fitted=solveHomography(inliers,weights);
    if(!fitted)break;
    matrix=fitted;
  }
  const errs=anchors.map(a=>error(matrix,a));
  const accepted=anchors.filter((_,i)=>errs[i]<threshold);
  const familyList=countFamilies(accepted);
  const nonQR=accepted.filter(a=>a.family!=='qr');
  const qrOk=anchors.filter(a=>a.family==='qr').every(a=>error(matrix,a)<mmToPx(3,dpi));
  if(!qrOk||nonQR.length<2||familyList.length<2)return null;
  const med=median(accepted.map(a=>error(matrix,a)));
  if(!Number.isFinite(med)||med>threshold)return null;
  return {matrix,evidence:{
    available,families:countFamilies(anchors),modelCount:tested,
    inliers:accepted.length,inlierFamilies:familyList,nonQrInliers:nonQR.length,
    medianErrorPx:Number(med.toFixed(2)),
    maximumErrorPx:Number(Math.max(...accepted.map(a=>error(matrix,a))).toFixed(2)),
    selected:accepted.map(a=>a.name),
    rejected:anchors.filter((_,i)=>errs[i]>=threshold).map(a=>a.name),
    reason:'Pooled QR + non-QR markers, deterministic robust consensus and weighted refit'
  }};
}
export function warpMultiLandmark(
  source:HTMLCanvasElement,
  qr:ReturnType<typeof locateQRInPhoto>|null,
  corner:MarkerDetectionResult|undefined,
  midpoint:MidpointRegistration|undefined,
  aruco:ArucoRegistration|undefined,
  dpi:number,
  onEvidence?:(e:MultiFusionEvidence)=>void
):MultiFusionResult|null{
  if(!qr?.valid)return null;
  const anchors=assembleFusionAnchors(qr,corner,midpoint,aruco,dpi);
  const result=fitMultiLandmarkGeometry(anchors,dpi);
  if(!result)return null;
  onEvidence?.(result.evidence);
  let src:any=null,h:any=null,corrected:any=null;
  try{
    h=cv.matFromArray(3,3,cv.CV_64FC1,result.matrix);
    src=cv.imread(source);
    corrected=new cv.Mat();
    cv.warpPerspective(src,corrected,h,
      new cv.Size(Math.round(mmToPx(OMR_LAYOUT.page.widthMm,dpi)),
        Math.round(mmToPx(OMR_LAYOUT.page.heightMm,dpi))),
      cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar(255,255,255,255));
    const perspective:PerspectiveResult={
      corrected,correctedDataUrl:'',transform:h,success:true
    };
    corrected=null;h=null;
    return {perspective,evidence:result.evidence};
  }catch{return null;}
  finally{for(const m of [src,h,corrected])try{m?.delete?.()}catch{/*cleanup*/}}
}
