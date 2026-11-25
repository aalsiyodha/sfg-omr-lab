/** Failure-only QR + bottom ArUco alignment candidate.
 * QR corners locate the top of the sheet; independently decoded ArUco IDs
 * 2 and 3 constrain the bottom. Final acceptance still requires a decoded
 * QR in its template location and two independently valid timing tracks.
 */
import { OMR_LAYOUT, mmToPx } from '../config/omrLayout';
import { getSettings } from '../config/scannerSettings';
import { ARUCO_MARKERS_MM } from './arucoDetector';
import type { ArucoRegistration } from './arucoDetector';
import type { PerspectiveResult } from './perspectiveCorrection';
import type { locateQRInPhoto } from './qrDecoder';
declare const cv:any;
type Point={x:number;y:number};
type LocatedQR=ReturnType<typeof locateQRInPhoto>;
export function correctPerspectiveFromQrAruco(
  source:HTMLCanvasElement,qr:LocatedQR,aruco:ArucoRegistration,
  serializePreview = true
):PerspectiveResult{
  const fail=(error:string):PerspectiveResult=>({
    corrected:null,correctedDataUrl:'',transform:null,success:false,error
  });
  if(!qr.valid||qr.corners.length!==4)return fail('QR not independently decoded');
  const left=aruco.points[2],right=aruco.points[3];
  if(!left||!right)return fail('Bottom ArUco IDs 2 and 3 unavailable');
  const tl=qr.corners[0],tr=qr.corners[1];
  const topLength=Math.hypot(tr.x-tl.x,tr.y-tl.y);
  const bottomLength=Math.hypot(right.x-left.x,right.y-left.y);
  if(topLength<12||bottomLength<25)return fail('QR or ArUco baseline too small');
  const imagePoints:Point[]=[tl,tr,right,left];
  const cross=(a:Point,b:Point,c:Point)=>
    (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  if(!imagePoints.every((p,i)=>cross(p,imagePoints[(i+1)%4],imagePoints[(i+2)%4])>0))
    return fail('QR-ArUco quadrilateral not convex');
  const qrMm=OMR_LAYOUT.qr;
  const templatePoints:Point[]=[
    {x:qrMm.xMm,y:qrMm.yMm},
    {x:qrMm.xMm+qrMm.sizeMm,y:qrMm.yMm},
    ARUCO_MARKERS_MM.find(m=>m.id===3)!,
    ARUCO_MARKERS_MM.find(m=>m.id===2)!,
  ];
  let src:any=null,input:any=null,output:any=null,transform:any=null,corrected:any=null;
  try{
    const dpi=getSettings().scanDpi;
    src=cv.imread(source);
    input=cv.matFromArray(4,1,cv.CV_32FC2,imagePoints.flatMap(p=>[p.x,p.y]));
    output=cv.matFromArray(4,1,cv.CV_32FC2,
      templatePoints.flatMap(p=>[mmToPx(p.x,dpi),mmToPx(p.y,dpi)]));
    transform=cv.getPerspectiveTransform(input,output);
    corrected=new cv.Mat();
    const w=Math.round(mmToPx(OMR_LAYOUT.page.widthMm,dpi));
    const h=Math.round(mmToPx(OMR_LAYOUT.page.heightMm,dpi));
    cv.warpPerspective(src,corrected,transform,new cv.Size(w,h));
    const canvas=document.createElement('canvas');
    canvas.width=w;canvas.height=h;
    cv.imshow(canvas,corrected);
    return {corrected,correctedDataUrl:serializePreview ? canvas.toDataURL('image/png') : '',transform,success:true};
  }catch(error){
    corrected?.delete?.();transform?.delete?.();
    return fail(String(error));
  }finally{
    for(const m of [src,input,output])try{m?.delete?.();}catch{/* cleanup */}
  }
}
