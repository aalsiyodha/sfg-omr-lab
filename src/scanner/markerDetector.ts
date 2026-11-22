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
  imageHeight: number,
  expected?: Record<'topLeft'|'topRight'|'bottomLeft'|'bottomRight',{x:number;y:number}>
): MarkerDetectionResult {
  const settings = getSettings();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  
  try {
    cv.findContours(thresholded, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    
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
    
    // Evaluate combinations, not the four extremal contours. Small QR finder
    // patterns, edge timing marks and degraded corner outlines can be mistaken
    // for the reference squares, particularly in compressed pictures.
    const corners = classifyCorners(candidates, imageWidth, imageHeight, expected);
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
          ? 'Four trustworthy corner markers could not be matched to A4 geometry. Check cropped/washed-out squares, perspective and image compression.'
          : undefined,
    };
  } finally {
    contours.delete();
    hierarchy.delete();
  }
}

/**
 * Match marker combinations against known A4 geometry. The naive extremal
 * approach often selected inner midpoints in degraded/low-contrast scans.
 * Prefer wide, rectangular sets while rejecting non-convex or warped sets.
 */
function classifyCorners(markers: DetectedMarker[], W: number, H: number,
  expected?: Record<'topLeft'|'topRight'|'bottomLeft'|'bottomRight',{x:number;y:number}>) {
  const empty = { count: 0, topLeft: null, topRight: null, bottomLeft: null, bottomRight: null };
  if (markers.length < 4) return { ...empty, count: markers.length };

  const quadrants = [
    markers.filter(m => m.cx < W * 0.46 && m.cy < H * 0.46),
    markers.filter(m => m.cx >= W * 0.54 && m.cy < H * 0.46),
    markers.filter(m => m.cx < W * 0.46 && m.cy >= H * 0.54),
    markers.filter(m => m.cx >= W * 0.54 && m.cy >= H * 0.54)
  ];
  const count = quadrants.filter(q => q.length > 0).length;
  if (count < 4) return { ...empty, count };

  // A correctly decoded ArUco family supplies an independent position estimate.
  // Restrict the guided hypothesis to actually detected square contours near
  // those positions. Never invent corner markers from the prediction alone.
  const keys = ['topLeft','topRight','bottomLeft','bottomRight'] as const;
  if (expected) {
    const radius = Math.max(18, Math.min(W,H)*.075);
    for (let i=0; i<4; i++) {
      quadrants[i] = quadrants[i].filter(m =>
        Math.hypot(m.cx-expected[keys[i]].x,m.cy-expected[keys[i]].y) < radius);
    }
    if (quadrants.some(q=>q.length===0))return {...empty,count:quadrants.filter(q=>q.length>0).length};
  }
  // Bound combinations for images that have hundreds of candidate contours.
  const corners = quadrants.map((items, index) =>
    [...items].sort((a, b) => {
      const score = (m: DetectedMarker) => {
        const nx = m.cx / W, ny = m.cy / H;
        const dx = index % 2 === 0 ? nx : 1 - nx;
        const dy = index < 2 ? ny : 1 - ny;
        return dx * dx + dy * dy;
      };
      return expected
        ? Math.hypot(a.cx-expected[keys[index]].x,a.cy-expected[keys[index]].y)
          - Math.hypot(b.cx-expected[keys[index]].x,b.cy-expected[keys[index]].y)
        : score(a) - score(b);
    }).slice(0, 7)
  );

  let best: ReturnType<typeof asCorners> | null = null;
  let bestScore = Infinity;
  for (const tl of corners[0]) for (const tr of corners[1]) {
    for (const bl of corners[2]) for (const br of corners[3]) {
      const current = asCorners(tl, tr, bl, br);
      if (!validateGeometry(current, W, H)) continue;
      const top = Math.hypot(tr.cx - tl.cx, tr.cy - tl.cy);
      const bottom = Math.hypot(br.cx - bl.cx, br.cy - bl.cy);
      const left = Math.hypot(bl.cx - tl.cx, bl.cy - tl.cy);
      const right = Math.hypot(br.cx - tr.cx, br.cy - tr.cy);
      const aspect = (top + bottom) / (left + right);
      const expected = 191 / 278;
      const widthSpread = Math.abs(top - bottom) / Math.max(top, bottom);
      const heightSpread = Math.abs(left - right) / Math.max(left, right);
      // Penalize implausibly different marker sizes and interior false anchors.
      const sizes = [tl, tr, bl, br].map(m => Math.sqrt(m.width * m.height));
      const sizeSpread = (Math.max(...sizes) - Math.min(...sizes)) / Math.max(...sizes);
      const cornerDistance = (tl.cx + tl.cy + (W - tr.cx) + tr.cy +
        bl.cx + (H - bl.cy) + (W - br.cx) + (H - br.cy)) / (2 * (W + H));
      const guidePenalty = expected ? keys.reduce((sum,key,i) => {
        const m=[tl,tr,bl,br][i], p=expected[key];
        return sum+Math.hypot(m.cx-p.x,m.cy-p.y)/Math.max(1,Math.min(W,H)*.075);
      },0) : 0;
      const score = 5 * Math.abs(Math.log(aspect / expected)) +
        widthSpread + heightSpread + sizeSpread + cornerDistance + guidePenalty;
      if (score < bestScore) { bestScore = score; best = current; }
    }
  }

  // Retain diagnostic coordinates when candidates exist but cannot be trusted.
  if (!best) {
    const [tl, tr, bl, br] = corners.map(q => q[0]);
    return { ...asCorners(tl, tr, bl, br), count: 4 };
  }
  return { ...best, count: 4 };
}

function asCorners(tl: DetectedMarker, tr: DetectedMarker, bl: DetectedMarker, br: DetectedMarker) {
  const point = (m: DetectedMarker) => ({ x: m.cx, y: m.cy });
  return {
    topLeft: point(tl), topRight: point(tr),
    bottomLeft: point(bl), bottomRight: point(br)
  };
}

function validateGeometry(
  corners: Pick<MarkerDetectionResult, 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'>,
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

  // Four arbitrary black shapes can form a quadrilateral. The four SFG corner
  // marker centres instead form a known ~191 x 278 mm rectangle. Reject gross
  // distortions before homography turns them into plausible-looking bubbles.
  const averageWidth = (topWidth + bottomWidth) / 2;
  const averageHeight = (leftHeight + rightHeight) / 2;
  const expectedAspect = 191 / 278;
  const observedAspect = averageWidth / averageHeight;
  // +/- 14% still allows camera tilt but rejects the Test 4 false anchors.
  if (Math.abs(observedAspect / expectedAspect - 1) > 0.14) return false;

  // Prevent degenerate, crossed, or reversed quadrilaterals.
  const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
  const points = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
  const turns = points.map((pt, i) => {
    const next = points[(i + 1) % 4];
    const next2 = points[(i + 2) % 4];
    return cross(next.x - pt.x, next.y - pt.y, next2.x - next.x, next2.y - next.y);
  });
  if (turns.some(turn => turn <= 0)) return false;

  return true;
}
