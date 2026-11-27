/** Experimental QR-corner-only homography proposal. The four QR corners occupy
 * a small region: projection to the bottom of A4 is highly sensitive to
 * subpixel localization errors. This is NEVER registration proof; caller
 * must validate QR identity AND independent dual-side timing tracks.
 */
import { OMR_LAYOUT, mmToPx } from '../config/omrLayout';
import { getSettings } from '../config/scannerSettings';
import type { PerspectiveResult } from './perspectiveCorrection';
import type { locateQRInPhoto } from './qrDecoder';
declare const cv:any;
type LocatedQR=ReturnType<typeof locateQRInPhoto>;
export function correctPerspectiveFromQrCorners(
  source:HTMLCanvasElement, qr:LocatedQR, serializePreview=false
):PerspectiveResult {
  const fail=(error:string):PerspectiveResult=>({
    corrected:null,correctedDataUrl:'',transform:null,success:false,error
  });
  if(!qr.valid||qr.corners.length!==4)return fail('QR landmark not independently decoded');
  const {xMm,yMm,sizeMm}=OMR_LAYOUT.qr;
  const dpi=getSettings().scanDpi;
  const corners=qr.corners;
  const sideA=Math.hypot(corners[0].x-corners[1].x,corners[0].y-corners[1].y);
  const sideB=Math.hypot(corners[1].x-corners[2].x,corners[1].y-corners[2].y);
  if(Math.min(sideA,sideB)<18||Math.max(sideA,sideB)/Math.min(sideA,sideB)>3)
    return fail('QR corners insufficient resolution or extreme aspect ratio');
  let input:any=null,output:any=null,src:any=null,transform:any=null,corrected:any=null;
  try{
    input=cv.matFromArray(4,1,cv.CV_32FC2,corners.flatMap(p=>[p.x,p.y]));
    const mm=[[xMm,yMm],[xMm+sizeMm,yMm],
      [xMm+sizeMm,yMm+sizeMm],[xMm,yMm+sizeMm]];
    output=cv.matFromArray(4,1,cv.CV_32FC2,
      mm.flatMap(([x,y])=>[mmToPx(x,dpi),mmToPx(y,dpi)]));
    transform=cv.getPerspectiveTransform(input,output);
    src=cv.imread(source);
    corrected=new cv.Mat();
    const w=Math.round(mmToPx(OMR_LAYOUT.page.widthMm,dpi));
    const h=Math.round(mmToPx(OMR_LAYOUT.page.heightMm,dpi));
    cv.warpPerspective(src,corrected,transform,new cv.Size(w,h),cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,new cv.Scalar(255,255,255,255));
    let correctedDataUrl='';
    if(serializePreview){
      const canvas=document.createElement('canvas');
      canvas.width=w;canvas.height=h;cv.imshow(canvas,corrected);
      correctedDataUrl=canvas.toDataURL('image/png');
    }
    return {corrected,correctedDataUrl,transform,success:true};
  }catch(error){
    corrected?.delete?.();transform?.delete?.();
    return fail('QR-only proposal failed: '+String(error));
  }finally{for(const m of [input,output,src])try{m?.delete?.()}catch{/*cleanup*/}}
}
