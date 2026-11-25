import { getSettings } from '../config/scannerSettings';

declare const cv: any;

export interface PreprocessedImages {
  gray: any;       // cv.Mat
  blurred: any;    // cv.Mat
  thresholded: any;// cv.Mat
  grayDataUrl: string;
  thresholdedDataUrl: string;
}

export function checkOpenCV(): boolean {
  return typeof cv !== 'undefined' && cv.Mat !== undefined;
}

export function matToDataUrl(mat: any, canvas?: HTMLCanvasElement): string {
  const c = canvas || document.createElement('canvas');
  c.width = mat.cols;
  c.height = mat.rows;
  cv.imshow(c, mat);
  return c.toDataURL('image/png');
}

export function preprocessImage(canvas: HTMLCanvasElement): PreprocessedImages {
  if (!checkOpenCV()) throw new Error('OpenCV not loaded');
  const settings = getSettings();
  
  // Single owner for each Mat. Release partial allocations on exceptions.
  let src: any = null, gray: any = null, blurred: any = null, thresholded: any = null;
  try {
    src = cv.imread(canvas);
    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    blurred = new cv.Mat();
    const ksize = settings.gaussianBlurKsize % 2 === 0
      ? settings.gaussianBlurKsize + 1 : settings.gaussianBlurKsize;
    cv.GaussianBlur(gray, blurred, new cv.Size(ksize, ksize), 0);
    thresholded = new cv.Mat();
    const blockSize = settings.adaptiveThreshBlockSize % 2 === 0
      ? settings.adaptiveThreshBlockSize + 1 : settings.adaptiveThreshBlockSize;
    cv.adaptiveThreshold(blurred, thresholded, 255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV,
      blockSize, settings.adaptiveThreshC);
    // Neither image is displayed on the public scanner. Avoid both PNG encodes.
    return {gray, blurred, thresholded, grayDataUrl: '', thresholdedDataUrl: ''};
  } catch (error) {
    cleanupMats(gray, blurred, thresholded);
    throw error;
  } finally {
    cleanupMats(src);
  }
}

export function cleanupMats(...mats: any[]): void {
  for (const m of mats) {
    try { if (m && !m.isDeleted?.()) m.delete(); } catch { /* ignore */ }
  }
}
