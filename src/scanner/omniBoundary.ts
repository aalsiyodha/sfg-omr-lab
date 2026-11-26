/** Failure-only 360-degree quadrilateral registration.
 * Identify a printed sheet by its outline, then cycle all four possible
 * physical A4 corner assignments. The caller MUST verify QR+two timing tracks.
 * No attempt here classifies responses or considers white paper as evidence.
 */
import { OMR_LAYOUT, mmToPx } from '../config/omrLayout';
import { getSettings } from '../config/scannerSettings';
import { orderPageCorners, type PagePoint } from './pageBoundaryRecovery';
declare const cv:any;

export function cyclicCornerOrder(points:PagePoint[],turn:0|1|2|3):PagePoint[] {
  if(points.length!==4)throw new Error('Four page corners required');
  return [0,1,2,3].map(i=>points[(i+turn)%4]);
}

export function warpBoundaryOrientation(
  source:HTMLCanvasElement,corners:PagePoint[],turn:0|1|2|3
):HTMLCanvasElement|null {
  const ordered=orderPageCorners(corners);
  if(!ordered)return null;
  const p=cyclicCornerOrder(ordered,turn);
  const dpi=getSettings().scanDpi;
  const w=Math.round(mmToPx(OMR_LAYOUT.page.widthMm,dpi));
  const h=Math.round(mmToPx(OMR_LAYOUT.page.heightMm,dpi));
  let src:any=null,from:any=null,to:any=null,transform:any=null,output:any=null;
  try {
    src=cv.imread(source);
    from=cv.matFromArray(4,1,cv.CV_32FC2,p.flatMap(pt=>[pt.x,pt.y]));
    to=cv.matFromArray(4,1,cv.CV_32FC2,[0,0,w-1,0,w-1,h-1,0,h-1]);
    transform=cv.getPerspectiveTransform(from,to);
    output=new cv.Mat();
    cv.warpPerspective(src,output,transform,new cv.Size(w,h),
      cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar(255,255,255,255));
    const canvas=document.createElement('canvas');
    canvas.width=w;canvas.height=h;
    cv.imshow(canvas,output);
    return canvas;
  } finally {
    for(const m of [src,from,to,transform,output])
      try{m?.delete?.();}catch{/* resource cleanup */}
  }
}
