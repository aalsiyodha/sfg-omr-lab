import type { MarkerDetectionResult } from '../types';
import { OMR_LAYOUT, mmToPx } from '../config/omrLayout';
import { getSettings } from '../config/scannerSettings';

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
      error: 'Cannot correct perspective: fewer than 4 markers detected.' };
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
  
  // Source points: detected marker centres
  // Use the INNER corner of each marker for best accuracy
  const srcPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
    TL.x, TL.y,
    TR.x, TR.y,
    BR.x, BR.y,
    BL.x, BL.y,
  ]);
  
  // Destination points: expected positions at target DPI
  const { markers: ML } = OMR_LAYOUT;
  const dstPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
    mmToPx(ML.topLeft.xMm + ML.topLeft.sizeMm/2, dpi),
    mmToPx(ML.topLeft.yMm + ML.topLeft.sizeMm/2, dpi),
    mmToPx(ML.topRight.xMm + ML.topRight.sizeMm/2, dpi),
    mmToPx(ML.topRight.yMm + ML.topRight.sizeMm/2, dpi),
    mmToPx(ML.bottomRight.xMm + ML.bottomRight.sizeMm/2, dpi),
    mmToPx(ML.bottomRight.yMm + ML.bottomRight.sizeMm/2, dpi),
    mmToPx(ML.bottomLeft.xMm + ML.bottomLeft.sizeMm/2, dpi),
    mmToPx(ML.bottomLeft.yMm + ML.bottomLeft.sizeMm/2, dpi),
  ]);
  
  const transform = cv.getPerspectiveTransform(srcPoints, dstPoints);
  const corrected = new cv.Mat();
  cv.warpPerspective(srcMat, corrected, transform, new cv.Size(outW, outH));
  
  srcMat.delete(); srcPoints.delete(); dstPoints.delete();
  
  return {
    corrected,
    correctedDataUrl: matToDataUrl(corrected),
    transform,
    success: true,
  };
}
