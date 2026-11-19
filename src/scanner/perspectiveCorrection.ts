import type { MarkerDetectionResult } from '../types';
import type { MidpointRegistration } from './midpointDetector';
import { MIDPOINTS_MM } from './midpointDetector';
import { OMR_LAYOUT, mmToPx } from '../config/omrLayout';
import { getSettings } from '../config/scannerSettings';
import type { ArucoRegistration } from './arucoDetector';
import { ARUCO_MARKERS_MM } from './arucoDetector';

declare const cv: any;

export interface PerspectiveResult {
  corrected: any;        // cv.Mat
  correctedDataUrl: string;
  transform: any;        // cv.Mat (3×3 homography)
  success: boolean;
  error?: string;
}

function matToDataUrl(mat: any): string {
  const c = document.createElement('canvas');
  c.width = mat.cols; c.height = mat.rows;
  cv.imshow(c, mat);
  return c.toDataURL('image/png');
}

export function correctPerspective(
  src: HTMLCanvasElement,
  markers: MarkerDetectionResult
): PerspectiveResult {
  if (!markers.found || markers.count < 4) {
    return { corrected: null, correctedDataUrl: '', transform: null, success: false,
      error: 'Cannot correct perspective: registration markers are missing or geometry failed validation.' };
  }
  
  const { topLeft: TL, topRight: TR, bottomLeft: BL, bottomRight: BR } = markers;
  if (!TL || !TR || !BL || !BR) {
    return { corrected: null, correctedDataUrl: '', transform: null, success: false,
      error: 'One or more corner markers missing.' };
  }
  
  const dpi = getSettings().scanDpi;
  const { page } = OMR_LAYOUT;
  const outW = Math.round(mmToPx(page.widthMm, dpi));
  const outH = Math.round(mmToPx(page.heightMm, dpi));
  
  const srcMat = cv.imread(src);
  let srcPoints: any = null;
  let dstPoints: any = null;
  let transform: any = null;
  let corrected: any = null;

  try {
    // Source points are actual marker centres, not marker inner corners.
    srcPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
      TL.x, TL.y, TR.x, TR.y, BR.x, BR.y, BL.x, BL.y
    ]);

    const { markers: ML } = OMR_LAYOUT;
    const center = (m: { xMm: number; yMm: number; sizeMm: number }) => [
      mmToPx(m.xMm + m.sizeMm / 2, dpi),
      mmToPx(m.yMm + m.sizeMm / 2, dpi)
    ];
    dstPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
      ...center(ML.topLeft), ...center(ML.topRight),
      ...center(ML.bottomRight), ...center(ML.bottomLeft)
    ]);

    transform = cv.getPerspectiveTransform(srcPoints, dstPoints);
    corrected = new cv.Mat();
    cv.warpPerspective(srcMat, corrected, transform, new cv.Size(outW, outH));
    const correctedDataUrl = matToDataUrl(corrected);
    return { corrected, correctedDataUrl, transform, success: true };
  } catch (error) {
    if (corrected) corrected.delete();
    if (transform) transform.delete();
    throw error;
  } finally {
    srcMat.delete();
    if (srcPoints) srcPoints.delete();
    if (dstPoints) dstPoints.delete();
  }
}

/**
 * Recover the fixed page coordinate system from its four 4x4mm edge markers
 * when the corner markers are corrupted. Must subsequently pass both QR
 * orientation and independent side timing-mark checks.
 */
export function correctPerspectiveFromMidpoints(
  src: HTMLCanvasElement,
  markers: MidpointRegistration
): PerspectiveResult {
  const missing = { corrected: null, correctedDataUrl: '', transform: null, success: false,
    error: markers.error || 'Four edge-midpoint reference squares could not be verified.' };
  if (!markers.found || !markers.top || !markers.right || !markers.bottom || !markers.left) {
    return missing;
  }

  const dpi = getSettings().scanDpi;
  const w = Math.round(mmToPx(OMR_LAYOUT.page.widthMm, dpi));
  const h = Math.round(mmToPx(OMR_LAYOUT.page.heightMm, dpi));
  const srcMat = cv.imread(src);
  let input: any = null, output: any = null, transform: any = null, corrected: any = null;
  try {
    const { top, right, bottom, left } = markers;
    input = cv.matFromArray(4, 1, cv.CV_32FC2, [
      top.x, top.y, right.x, right.y, bottom.x, bottom.y, left.x, left.y
    ]);
    const px = (p: { x: number; y: number }) => [mmToPx(p.x, dpi), mmToPx(p.y, dpi)];
    output = cv.matFromArray(4, 1, cv.CV_32FC2, [
      ...px(MIDPOINTS_MM.top), ...px(MIDPOINTS_MM.right),
      ...px(MIDPOINTS_MM.bottom), ...px(MIDPOINTS_MM.left)
    ]);
    transform = cv.getPerspectiveTransform(input, output);
    corrected = new cv.Mat();
    cv.warpPerspective(srcMat, corrected, transform, new cv.Size(w,h));
    return {
      corrected, correctedDataUrl: matToDataUrl(corrected),
      transform, success: true
    };
  } catch (error) {
    if (corrected) corrected.delete();
    if (transform) transform.delete();
    throw error;
  } finally {
    srcMat.delete();
    if (input) input.delete();
    if (output) output.delete();
  }
}

/**
 * Four ArUco marker-centre homography for rescue on the new printed sheet.
 * Never accepted on geometric plausibility alone: scanOrchestrator separately
 * verifies QR orientation and independent left/right timing rows.
 */
export function correctPerspectiveFromArucos(
  src:HTMLCanvasElement, markers:ArucoRegistration
):PerspectiveResult {
  if(!markers.found||ARUCO_MARKERS_MM.some(m=>!markers.points[m.id]))
    return {corrected:null,correctedDataUrl:'',transform:null,success:false,
      error:'Four uniquely decoded ArUco markers are required'};
  const dpi=getSettings().scanDpi;
  const srcMat=cv.imread(src);
  let input:any=null,output:any=null,transform:any=null,corrected:any=null;
  try{
    const ordered=ARUCO_MARKERS_MM;
    input=cv.matFromArray(4,1,cv.CV_32FC2,
      ordered.flatMap(m=>[markers.points[m.id].x,markers.points[m.id].y]));
    output=cv.matFromArray(4,1,cv.CV_32FC2,
      ordered.flatMap(m=>[mmToPx(m.x,dpi),mmToPx(m.y,dpi)]));
    transform=cv.getPerspectiveTransform(input,output);
    corrected=new cv.Mat();
    cv.warpPerspective(srcMat,corrected,transform,
      new cv.Size(Math.round(mmToPx(OMR_LAYOUT.page.widthMm,dpi)),
        Math.round(mmToPx(OMR_LAYOUT.page.heightMm,dpi))));
    return {corrected,correctedDataUrl:matToDataUrl(corrected),
      transform,success:true};
  }catch(error){
    corrected?.delete?.();transform?.delete?.();
    throw error;
  }finally{
    srcMat.delete();input?.delete?.();output?.delete?.();
  }
}
