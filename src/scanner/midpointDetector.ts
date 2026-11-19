import { OMR_LAYOUT } from '../config/omrLayout';

declare const cv: any;

export interface ImagePoint { x: number; y: number }
export interface MidpointRegistration {
  found: boolean;
  count: number;
  top: ImagePoint | null;
  bottom: ImagePoint | null;
  left: ImagePoint | null;
  right: ImagePoint | null;
  error?: string;
}

/**
 * Independent fixed-template registration from the four 4x4mm edge-midpoint
 * squares in the official OMR PDF. Their centres are:
 * top (105,8), bottom (105,289), left (8,148.5), right (202,148.5) mm.
 *
 * Unlike the 7x7mm corner squares, these often survive high-contrast scans
 * which erase the corner-marker outlines (the original Test 4 failure).
 * Never grade solely on these points: verify QR position + both side timing
 * mark bands AFTER correction.
 */
export const MIDPOINTS_MM = {
  top: { x: OMR_LAYOUT.page.widthMm / 2, y: 8 },
  bottom: { x: OMR_LAYOUT.page.widthMm / 2, y: 289 },
  left: { x: 8, y: OMR_LAYOUT.page.heightMm / 2 },
  right: { x: 202, y: OMR_LAYOUT.page.heightMm / 2 },
} as const;

interface Candidate extends ImagePoint { width: number; height: number; area: number }
type Side = keyof typeof MIDPOINTS_MM;
const sides: Side[] = ['top', 'bottom', 'left', 'right'];

export function detectMidpointMarkers(
  binary: any, W: number, H: number,
  expected?: Partial<Record<Side,ImagePoint>>,
): MidpointRegistration {
  const fallback: MidpointRegistration = {
    found: false, count: 0, top: null, bottom: null, left: null, right: null
  };
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    cv.findContours(binary, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    const nominal = W * H * 16 / (210 * 297);
    const candidates: Candidate[] = [];
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      try {
        const area = cv.contourArea(cnt);
        if (area < Math.max(22, nominal * 0.17) || area > nominal * 5) continue;
        const rect = cv.boundingRect(cnt);
        if (rect.width < 3 || rect.height < 3) continue;
        const aspect = rect.width / rect.height;
        if (Math.abs(aspect - 1) > 0.44) continue;
        if (area / (rect.width * rect.height) < 0.55) continue;
        candidates.push({
          x: rect.x + rect.width / 2, y: rect.y + rect.height / 2,
          width: rect.width, height: rect.height, area
        });
      } finally {
        cnt.delete();
      }
    }

    const regions: Record<Side, Candidate[]> = {
      top: candidates.filter(c => c.x > W * .32 && c.x < W * .68 && c.y < H * .28),
      bottom: candidates.filter(c => c.x > W * .32 && c.x < W * .68 && c.y > H * .72),
      left: candidates.filter(c => c.x < W * .29 && c.y > H * .25 && c.y < H * .75),
      right: candidates.filter(c => c.x > W * .71 && c.y > H * .25 && c.y < H * .75),
    };
    // Independently identified ArUco IDs can disambiguate extra printed
    // squares. An ArUco-guided hypothesis is separate from ordinary midpoint
    // registration and fails closed if a printed square is not nearby.
    if(expected){
      const radius=Math.max(12,Math.min(W,H)*.045);
      for(const side of sides){
        const p=expected[side];
        if(!p)continue;
        regions[side]=regions[side].filter(c=>Math.hypot(c.x-p.x,c.y-p.y)<=radius);
      }
    }
    const count = sides.filter(side => regions[side].length > 0).length;
    if (count < 4) {
      return {
        ...fallback, count,
        error: `Only ${count}/4 edge-midpoint reference squares were found.`
      };
    }

    const rank = (side: Side, m: Candidate) => {
      if(expected?.[side]){
        const p=expected[side];
        const distance=Math.hypot(m.x-p.x,m.y-p.y);
        const areaPenalty=Math.abs(Math.log(Math.max(1,m.area)/nominal));
        return distance/Math.max(1,Math.min(W,H)*.045)+.15*areaPenalty;
      }
      const x = m.x / W, y = m.y / H;
      const position = side === 'top' ? 2 * Math.abs(x - .5) + 3 * y :
        side === 'bottom' ? 2 * Math.abs(x - .5) + 3 * (1-y) :
        side === 'left' ? 3 * x + 2 * Math.abs(y-.5) :
        3 * (1-x) + 2 * Math.abs(y-.5);
      // Small text and row timing marks must not beat 4mm solid squares.
      const areaPenalty = Math.abs(Math.log(Math.max(1, m.area) / nominal));
      return position + .22 * areaPenalty;
    };

    const selected = Object.fromEntries(sides.map(side => {
      const best = [...regions[side]].sort((a,b) => rank(side,a)-rank(side,b))[0];
      return [side, { x: best.x, y: best.y }];
    })) as Record<Side, ImagePoint>;

    const topBottom = Math.hypot(selected.bottom.x-selected.top.x, selected.bottom.y-selected.top.y);
    const leftRight = Math.hypot(selected.right.x-selected.left.x, selected.right.y-selected.left.y);
    const symmetric =
      topBottom > H * .53 && leftRight > W * .52 &&
      Math.abs(selected.top.x-selected.bottom.x) < W * .22 &&
      Math.abs(selected.left.y-selected.right.y) < H * .22;
    const expectedAspect = (202-8)/(289-8);
    const observedAspect = leftRight / topBottom;
    const plausibleAspect = Math.abs(observedAspect/expectedAspect - 1) < .25;
    const valid = symmetric && plausibleAspect;
    return {
      found: valid, count: 4,
      ...selected,
      error: valid ? undefined : 'Edge-midpoint squares did not form a plausible A4 reference geometry.'
    };
  } finally {
    contours.delete();
    hierarchy.delete();
  }
}

export function generateMidpointOverlay(
  src: HTMLCanvasElement, result: MidpointRegistration
): string {
  const canvas = document.createElement('canvas');
  canvas.width = src.width; canvas.height = src.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(src, 0, 0);
  ctx.lineWidth = 3;
  for (const side of sides) {
    const point = result[side];
    if (!point) continue;
    ctx.strokeStyle = result.found ? '#00c853' : '#ef4444';
    ctx.beginPath();
    ctx.arc(point.x, point.y, 14, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = '#00c853';
    ctx.fillText(side.toUpperCase(), point.x + 14, point.y - 7);
  }
  return canvas.toDataURL('image/png');
}
