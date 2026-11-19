import { getSettings } from '../config/scannerSettings';
import type { MarkerDetectionResult } from '../types';

declare const cv: any;

export interface DetectedMarker {
  x: number; y: number;
  width: number; height: number;
  area: number;
  cx: number; cy: number; // centre
}

export function detectMarkers(
  thresholded: any, // cv.Mat, binary image
  imageWidth: number,
  imageHeight: number
): MarkerDetectionResult {
  const settings = getSettings();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  
  try {
    cv.findContours(thresholded, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    
    // A 7x7 mm marker on an A4 page (210x297 mm) is ~0.0786% of the total page area.
    const totalImageArea = imageWidth * imageHeight;
    const nominalMarkerArea = totalImageArea * (49.0 / (210.0 * 297.0));
    const minArea = Math.min(settings.markerMinAreaPx, Math.max(60, nominalMarkerArea * 0.20));
    const maxArea = Math.max(settings.markerMaxAreaPx, nominalMarkerArea * 4.5);

    const candidates: DetectedMarker[] = [];
    
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      
      if (area < minArea || area > maxArea) {
        cnt.delete();
        continue;
      }
      
      const rect = cv.boundingRect(cnt);
      const aspectRatio = rect.width / rect.height;
      
      // Registration markers are approximately square, but allow tolerance for camera angle/clipping
      if (Math.abs(aspectRatio - 1.0) > settings.markerAspectTolerance) {
        cnt.delete();
        continue;
      }
      
      // Registration markers must be substantially solid (>45%)
      const expectedArea = rect.width * rect.height;
      const fillRatio = area / expectedArea;
      if (fillRatio < 0.45) {
        cnt.delete();
        continue;
      }
      
      candidates.push({
        x: rect.x, y: rect.y,
        width: rect.width, height: rect.height,
        area,
        cx: rect.x + rect.width / 2,
        cy: rect.y + rect.height / 2,
      });
      cnt.delete();
    }
    
    // Classify candidates into corner positions
    const corners = classifyCorners(candidates, imageWidth, imageHeight);
    const validGeom = corners.count >= 4 && validateGeometry(corners, imageWidth, imageHeight);
    
    return {
      found: corners.count >= 4 && validGeom,
      count: corners.count,
      topLeft: corners.topLeft,
      topRight: corners.topRight,
      bottomLeft: corners.bottomLeft,
      bottomRight: corners.bottomRight,
      validGeometry: validGeom,
      error:
        corners.count < 4
          ? `Only ${corners.count}/4 registration markers detected. Please ensure all 4 solid black corner squares are visible and uncropped.`
          : !validGeom
          ? 'Registration markers detected but geometry is distorted. Please ensure the camera is reasonably parallel to the sheet.'
          : undefined,
    };
  } finally {
    contours.delete();
    hierarchy.delete();
  }
}

function classifyCorners(markers: DetectedMarker[], W: number, H: number) {
  if (markers.length < 4) {
    return { count: markers.length, topLeft: null, topRight: null, bottomLeft: null, bottomRight: null };
  }

  // Quadrant partitioning with generous reach
  const tlCandidates = markers.filter(m => m.cx < W * 0.40 && m.cy < H * 0.40);
  const trCandidates = markers.filter(m => m.cx >= W * 0.60 && m.cy < H * 0.40);
  const blCandidates = markers.filter(m => m.cx < W * 0.40 && m.cy >= H * 0.60);
  const brCandidates = markers.filter(m => m.cx >= W * 0.60 && m.cy >= H * 0.60);

  // Corner extreme criteria:
  // TL: minimizes (cx + cy) -> closest to top-left corner
  const topLeft = tlCandidates.sort((a, b) => (a.cx + a.cy) - (b.cx + b.cy))[0] ?? null;

  // TR: prioritize farthest right (maximum cx) while minimizing cy.
  // Using (cx - 1.5 * cy) descending reliably avoids picking the QR code finder pattern (which is at x ~ 0.80*W)
  const topRight = trCandidates.sort((a, b) => (b.cx - 1.5 * b.cy) - (a.cx - 1.5 * a.cy))[0] ?? null;

  // BL: maximizes (cy - cx) -> closest to bottom-left corner
  const bottomLeft = blCandidates.sort((a, b) => (b.cy - b.cx) - (a.cy - a.cx))[0] ?? null;

  // BR: maximizes (cx + cy) -> closest to bottom-right corner
  const bottomRight = brCandidates.sort((a, b) => (b.cx + b.cy) - (a.cx + a.cy))[0] ?? null;

  const count = [topLeft, topRight, bottomLeft, bottomRight].filter(Boolean).length;
  return {
    count,
    topLeft: topLeft ? { x: topLeft.cx, y: topLeft.cy } : null,
    topRight: topRight ? { x: topRight.cx, y: topRight.cy } : null,
    bottomLeft: bottomLeft ? { x: bottomLeft.cx, y: bottomLeft.cy } : null,
    bottomRight: bottomRight ? { x: bottomRight.cx, y: bottomRight.cy } : null,
  };
}

function validateGeometry(
  corners: ReturnType<typeof classifyCorners>,
  W: number, H: number
): boolean {
  if (!corners.topLeft || !corners.topRight || !corners.bottomLeft || !corners.bottomRight) return false;

  const topWidth = Math.hypot(corners.topRight.x - corners.topLeft.x, corners.topRight.y - corners.topLeft.y);
  const bottomWidth = Math.hypot(corners.bottomRight.x - corners.bottomLeft.x, corners.bottomRight.y - corners.bottomLeft.y);
  const leftHeight = Math.hypot(corners.bottomLeft.x - corners.topLeft.x, corners.bottomLeft.y - corners.topLeft.y);
  const rightHeight = Math.hypot(corners.bottomRight.x - corners.topRight.x, corners.bottomRight.y - corners.topRight.y);

  // Must span at least 45% of camera frame
  if (topWidth < W * 0.45 || leftHeight < H * 0.45) return false;

  // Sides should not differ by more than 35% in realistic perspective
  if (Math.abs(topWidth - bottomWidth) / Math.max(topWidth, bottomWidth) > 0.35) return false;
  if (Math.abs(leftHeight - rightHeight) / Math.max(leftHeight, rightHeight) > 0.35) return false;

  return true;
}
