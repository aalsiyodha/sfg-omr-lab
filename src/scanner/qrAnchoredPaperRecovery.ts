/**
 * 3.7.7 classical rescue: use a source-image decoded QR as a LOCAL top-page
 * anchor and two independent distant paper corners as BOTTOM-page anchors.
 * A page contour often shifts the QR by many pixels; pure QR-only homography
 * extrapolates ~250mm from a ~20mm square. Two distant corners constrain
 * that extrapolation. These are proposals only: both original QR identity
 * and 25+25 timing marks must independently verify after the warp.
 */
import { OMR_LAYOUT, mmToPx } from '../config/omrLayout';
import type { PagePoint } from './pageBoundaryRecovery';
import type { locateQRInPhoto } from './qrDecoder';
declare const cv:any;
type Pt={x:number;y:number};
type QR=ReturnType<typeof locateQRInPhoto>;
export type QrAnchoredVariant='top-pair'|'left-pair'|'diagonal';
const dist=(a:Pt,b:Pt)=>Math.hypot(a.x-b.x,a.y-b.y);
function chooseBottomPaperCorners(
  qr:QR,page:PagePoint[]
):{left:Pt;right:Pt;spread:number}|null{
  if(!qr.valid||qr.corners.length!==4||page.length!==4)return null;
  const [tl,tr,,bl]=qr.corners;
  const rx=tr.x-tl.x,ry=tr.y-tl.y,dx=bl.x-tl.x,dy=bl.y-tl.y;
  const rw=Math.hypot(rx,ry),dw=Math.hypot(dx,dy);
  if(rw<12||dw<12)return null;
  // Perspective-preserving QR-normalized source axes. This remains invariant
  // when the original page is photographed at 0/90/180/270 degrees.
  const px=rx/rw,py=ry/rw,qx=dx/dw,qy=dy/dw;
  const projected=page.map(p=>({p,u:(p.x-tl.x)*px+(p.y-tl.y)*py,
    v:(p.x-tl.x)*qx+(p.y-tl.y)*qy}));
  const far=[...projected].sort((a,b)=>b.v-a.v).slice(0,2);
  if(far.length!==2)return null;
  const [left,right]=far.sort((a,b)=>a.u-b.u);
  const separation=dist(left.p,right.p);
  const qrSize=(rw+dw)/2;
  // Distant anchors must actually be distant enough to constrain A4 rather
  // than forming a near-QR false quadrilateral.
  if(separation<qrSize*3||Math.min(left.v,right.v)<qrSize*2.3)return null;
  const cross=(a:Pt,b:Pt,c:Pt)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  if(Math.abs(cross(tl,left.p,right.p))<qrSize*separation*.8)return null;
  return {left:left.p,right:right.p,spread:separation};
}
/**
 * Warp the ORIGINAL photo using the QR and independently recovered far edge.
 * QR-only source corners cannot pass on their own; the bottom edge adds
 * spatial coverage and the final QR/timing verifier still decides acceptance.
 */
export function warpQrAnchoredPaper(
 source:HTMLCanvasElement,qr:QR,page:PagePoint[],dpi:number,
 variant:QrAnchoredVariant='top-pair',sourceMat?:any
):HTMLCanvasElement|null{
  const far=chooseBottomPaperCorners(qr,page);
  if(!far)return null;
  const q=qr.corners,template=OMR_LAYOUT.qr;
  const qrDest=[
    {x:template.xMm,y:template.yMm},
    {x:template.xMm+template.sizeMm,y:template.yMm},
    {x:template.xMm+template.sizeMm,y:template.yMm+template.sizeMm},
    {x:template.xMm,y:template.yMm+template.sizeMm}
  ];
  let first=0,second=1;
  if(variant==='left-pair'){first=0;second=3;}
  if(variant==='diagonal'){first=0;second=2;}
  const srcPts=[q[first],q[second],far.right,far.left];
  const dstPts=[qrDest[first],qrDest[second],
    {x:OMR_LAYOUT.page.widthMm,y:OMR_LAYOUT.page.heightMm},
    {x:0,y:OMR_LAYOUT.page.heightMm}];
  const scaled=dstPts.flatMap(p=>[mmToPx(p.x,dpi),mmToPx(p.y,dpi)]);
  let src:any=null,dst:any=null,h:any=null,warped:any=null;
  const ownsSource=!sourceMat;
  try{
    src=sourceMat??cv.imread(source);
    dst=cv.matFromArray(4,1,cv.CV_32FC2,scaled);
    const input=cv.matFromArray(4,1,cv.CV_32FC2,srcPts.flatMap(p=>[p.x,p.y]));
    try{h=cv.getPerspectiveTransform(input,dst);}
    finally{input.delete();}
    warped=new cv.Mat();
    const w=Math.round(mmToPx(OMR_LAYOUT.page.widthMm,dpi));
    const ht=Math.round(mmToPx(OMR_LAYOUT.page.heightMm,dpi));
    cv.warpPerspective(src,warped,h,new cv.Size(w,ht),cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,new cv.Scalar(255,255,255,255));
    const canvas=document.createElement('canvas');
    canvas.width=w;canvas.height=ht;cv.imshow(canvas,warped);
    return canvas;
  }catch{return null;}
  finally{
    for(const m of [dst,h,warped,ownsSource?src:null])
      try{m?.delete?.()}catch{/*cleanup*/}
  }
}
