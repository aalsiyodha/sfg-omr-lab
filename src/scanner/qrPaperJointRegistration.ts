/** Failure-only classical geometry: jointly fit the paper outline and the
 * independently decoded QR. QR-only homography extrapolates across A4;
 * paper-only homography can drift by millimetres. A weighted 8-landmark fit
 * combines their complementary scale. Neither establishes registration.
 * Every output must pass the regular QR identity and 2 timing-track gates.
 */
import { OMR_LAYOUT, mmToPx } from '../config/omrLayout';
import { orderPageCorners, type PagePoint } from './pageBoundaryRecovery';
import { cyclicCornerOrder } from './omniBoundary';
import type { locateQRInPhoto } from './qrDecoder';
declare const cv:any;
type QR=ReturnType<typeof locateQRInPhoto>;
type Pt={x:number;y:number};
function projection(data:ArrayLike<number>,p:Pt):Pt|null {
  const den=data[6]*p.x+data[7]*p.y+data[8];
  if(!Number.isFinite(den)||Math.abs(den)<1e-8)return null;
  const x=(data[0]*p.x+data[1]*p.y+data[2])/den;
  const y=(data[3]*p.x+data[4]*p.y+data[5])/den;
  return Number.isFinite(x)&&Number.isFinite(y)?{x,y}:null;
}
function qrCentreTarget(dpi:number):Pt {
  const qr=OMR_LAYOUT.qr;
  return {x:mmToPx(qr.xMm+qr.sizeMm/2,dpi),
    y:mmToPx(qr.yMm+qr.sizeMm/2,dpi)};
}
export function qrBoundaryPreflight(
  quad:PagePoint[],turn:0|1|2|3,qr:QR,dpi:number
):{plausible:boolean;errorMm:number;reason:string}{
  if(!qr.valid||!qr.center)return {plausible:true,errorMm:Infinity,reason:'no-original-QR'};
  const ordered=orderPageCorners(quad);
  if(!ordered)return {plausible:false,errorMm:Infinity,reason:'invalid-paper-quad'};
  const points=cyclicCornerOrder(ordered,turn);
  const W=mmToPx(OMR_LAYOUT.page.widthMm,dpi),H=mmToPx(OMR_LAYOUT.page.heightMm,dpi);
  let src:any=null,dst:any=null,h:any=null;
  try {
    src=cv.matFromArray(4,1,cv.CV_32FC2,points.flatMap(p=>[p.x,p.y]));
    dst=cv.matFromArray(4,1,cv.CV_32FC2,[0,0,W-1,0,W-1,H-1,0,H-1]);
    h=cv.getPerspectiveTransform(src,dst);
    const v=h.type()===cv.CV_64F?h.data64F:h.data32F;
    const projected=projection(v,qr.center);
    if(!projected)return {plausible:false,errorMm:Infinity,reason:'singular-transform'};
    const expected=qrCentreTarget(dpi);
    const errorMm=Math.hypot(projected.x-expected.x,projected.y-expected.y)*25.4/dpi;
    // Just a loose preflight to eliminate 90/180-degree wrong page assignments.
    // Never use this as registration approval. Wider than any QR crop padding.
    return {plausible:errorMm<=85,errorMm:Number(errorMm.toFixed(1)),
      reason:errorMm<=85?'QR-centre-feasible':'source-QR-wrong-page-corner'};
  }catch{return {plausible:true,errorMm:Infinity,reason:'preflight-unavailable'};}
  finally{for(const m of [src,dst,h])try{m?.delete?.()}catch{/*cleanup*/}}
}
export function warpQrPaperJoint(
  sourceMat:any,quad:PagePoint[],turn:0|1|2|3,qr:QR,
  dpi:number,canvas:HTMLCanvasElement,qrWeight:4|6=4
):{canvas:HTMLCanvasElement;qrErrorMm:number}|null{
  if(!qr.valid||qr.corners.length!==4||!qr.center||
    typeof cv.findHomography!=='function')return null;
  const ordered=orderPageCorners(quad);
  if(!ordered)return null;
  const preflight=qrBoundaryPreflight(quad,turn,qr,dpi);
  if(!preflight.plausible)return null;
  const page=cyclicCornerOrder(ordered,turn);
  const W=Math.round(mmToPx(OMR_LAYOUT.page.widthMm,dpi));
  const H=Math.round(mmToPx(OMR_LAYOUT.page.heightMm,dpi));
  const fromPage=page, toPage:Pt[]=[
    {x:0,y:0},{x:W-1,y:0},{x:W-1,y:H-1},{x:0,y:H-1}
  ];
  const q=OMR_LAYOUT.qr;
  const toQr:Pt[]=[
    {x:q.xMm,y:q.yMm},{x:q.xMm+q.sizeMm,y:q.yMm},
    {x:q.xMm+q.sizeMm,y:q.yMm+q.sizeMm},{x:q.xMm,y:q.yMm+q.sizeMm}
  ].map(p=>({x:mmToPx(p.x,dpi),y:mmToPx(p.y,dpi)}));
  const from:Pt[]=[...fromPage],to:Pt[]=[...toPage];
  // QR corner localization is sharper than paper contours on patterned cloth.
  // Use a bounded weight of four or six, NOT as extra independent anchors;
  // final QR and both timing tracks must validate the fitted transform.
  for(let repeat=0;repeat<qrWeight;repeat++){
    from.push(...qr.corners);to.push(...toQr);
  }
  let srcPts:any=null,dstPts:any=null,h:any=null,output:any=null;
  try{
    srcPts=cv.matFromArray(from.length,1,cv.CV_32FC2,
      from.flatMap(p=>[p.x,p.y]));
    dstPts=cv.matFromArray(to.length,1,cv.CV_32FC2,
      to.flatMap(p=>[p.x,p.y]));
    h=cv.findHomography(srcPts,dstPts,0);
    if(!h||h.empty())return null;
    const v=h.type()===cv.CV_64F?h.data64F:h.data32F;
    const projected=projection(v,qr.center);
    if(!projected)return null;
    const expected=qrCentreTarget(dpi);
    const qrErrorMm=Math.hypot(projected.x-expected.x,projected.y-expected.y)*25.4/dpi;
    // Poor joint fits are not worth decoding the full QR ladder.
    if(qrErrorMm>4.5)return null;
    output=new cv.Mat();
    cv.warpPerspective(sourceMat,output,h,new cv.Size(W,H),
      cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar(255,255,255,255));
    canvas.width=W;canvas.height=H;
    cv.imshow(canvas,output);
    return {canvas,qrErrorMm:Number(qrErrorMm.toFixed(2))};
  }catch{return null;}
  finally{for(const m of [srcPts,dstPts,h,output])try{m?.delete?.()}catch{/*cleanup*/}}
}
