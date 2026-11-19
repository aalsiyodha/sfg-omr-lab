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
