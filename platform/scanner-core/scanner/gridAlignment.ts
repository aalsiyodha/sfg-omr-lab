/**
 * v2.1.1 — conservative printed-ring registration refinement.
 *
 * The timing squares verify the broad warp but a small local drift can put
 * the 1mm ink ROI on the preprinted outlines instead of the bubble centres.
 * Use the UNMARKED printed rings as independent references. Never search for
 * the darkest ink point; this would chase student markings.
 */
import { getBubbleCentre, getTestIdBubbleCentre, mmToPx } from '../config/omrLayout';
import { grayReader } from './pixelAccess';

export interface GridOffset { dx: number; dy: number; confidence: number; applied: boolean }
export interface GridAlignment {
  leftUpper: GridOffset;
  leftLower: GridOffset;
  rightUpper: GridOffset;
  rightLower: GridOffset;
  testId: GridOffset;
}
type Gray = {rows:number;cols:number;ucharPtr(y:number,x:number):ArrayLike<number>;data?: Uint8Array | Uint8ClampedArray};
const ZERO: GridOffset = { dx:0,dy:0,confidence:0,applied:false };

/**
 * v2.5 Local-Grid learning: do not pay for JS-to-WASM ucharPtr() on
 * every ring pixel. The warped OpenCV CV_8UC1 matrix is contiguous and exposes
 * a byte view. Cached annulus offsets give the exact SAME ring/core samples
 * as the original conservative search, without changing acceptance thresholds.
 * The accessor fallback preserves synthetic tests and unusual Mat wrappers.
 */
const ringPixelCache = new Map<string, {outer:number;ring:[number,number][];core:[number,number][]}>();
function ringPixels(dpi:number,radiusMm:number){
  const key=dpi+':'+radiusMm;
  const hit=ringPixelCache.get(key);if(hit)return hit;
  const scale=dpi/25.4,outer=Math.ceil((radiusMm+0.4)*scale);
  const ring0=((radiusMm-0.18)*scale)**2,ring1=((radiusMm+0.16)*scale)**2;
  const coreR=(radiusMm*0.53*scale)**2;
  const ring:[number,number][]=[],core:[number,number][]=[];
  for(let dy=-outer;dy<=outer;dy++)for(let dx=-outer;dx<=outer;dx++){
    const d2=dx*dx+dy*dy;
    if(d2>=ring0&&d2<=ring1)ring.push([dx,dy]);
    if(d2<=coreR)core.push([dx,dy]);
  }
  const result={outer,ring,core};
  ringPixelCache.set(key,result);
  return result;
}
/** Contrast of a printed ring against its untouched interior. */
function ringScore(gray:Gray,x:number,y:number,dpi:number,radiusMm:number):number {
  const cx=Math.round(x),cy=Math.round(y),samples=ringPixels(dpi,radiusMm);
  if(cx-samples.outer<0||cy-samples.outer<0||
    cx+samples.outer>=gray.cols||cy+samples.outer>=gray.rows)return 0;
  if(samples.ring.length<8||samples.core.length<5)return 0;
  const pixel=grayReader(gray);
  let ringSum=0,coreSum=0;
  for(const [dx,dy] of samples.ring)ringSum+=pixel(cy+dy,cx+dx);
  for(const [dx,dy] of samples.core)coreSum+=pixel(cy+dy,cx+dx);
  return Math.max(0,Math.min(90,
    coreSum/samples.core.length-ringSum/samples.ring.length));
}

/** Read-only landmark validation: use this only on withheld printed rings,
 * never on ink-picked or training anchors. */
export function scorePrintedRingAt(
  gray:Gray,x:number,y:number,dpi:number,radiusMm=1.7
):number {
  return ringScore(gray,x,y,dpi,radiusMm);
}

/** Deterministic spatially distributed registration probes, not chosen by ink. */
export function sampleGridAnchors<T>(anchors:T[]):T[]{
  return anchors.length>=32 && anchors.length%4===0
    ? anchors.filter((_,i)=>i%4===Math.floor(i/4)%4).slice(0,16)
    : anchors.filter((_,i)=>i%Math.max(1,Math.floor(anchors.length/12))===0).slice(0,16);
}

/** Pick an offset only when substantial ring evidence beats the unshifted layout. */
export function estimateGridOffset(
  gray:Gray,dpi:number,anchors:{x:number;y:number}[],ringRadiusMm=1.7,
):GridOffset {
  if(anchors.length<4)return {...ZERO};
  // v2.1.2: Score a modest, distributed set of template rings instead of
  // evaluating all 52 rings at 400+ shifts. Two-stage coarse/fine search cuts
  // millions of per-pixel calls without giving up sub-mm refinement.
  // Answer anchors arrive as A,B,C,D for each question. Sampling every
  // fourth anchor selects only A, which makes local registration sensitive
  // to one option's print defects. Rotate options across successive rows.
  // Keep the original generic sampling for the non-four-option Test ID grid.
  const sampled=sampleGridAnchors(anchors);
  const max=Math.round(mmToPx(1.6,dpi));
  const scored=(dx:number,dy:number):number=>{
    const values=sampled.map(p=>ringScore(gray,p.x+dx,p.y+dy,dpi,ringRadiusMm)).sort((a,b)=>a-b);
    const middle=values.slice(Math.floor(values.length/4),Math.ceil(values.length*3/4));
    return middle.reduce((a,b)=>a+b,0)/Math.max(1,middle.length)-0.35*Math.hypot(dx,dy);
  };
  const baseline=scored(0,0);
  let best={dx:0,dy:0,score:baseline};
  // Use a 2px coarse stride and 1px local refinement. Require the same
  // conservative gain before applying a displacement.
  const step=2;
  for(let dy=-max;dy<=max;dy+=step)
    for(let dx=-max;dx<=max;dx+=step){
      const score=scored(dx,dy);
      if(score>best.score)best={dx,dy,score};
    }
  const coarse={...best};
  for(let dy=Math.max(-max,coarse.dy-3);dy<=Math.min(max,coarse.dy+3);dy++)
    for(let dx=Math.max(-max,coarse.dx-3);dx<=Math.min(max,coarse.dx+3);dx++){
      const score=scored(dx,dy);
      if(score>best.score)best={dx,dy,score};
    }
  const gain=best.score-baseline;
  const applied=(best.dx!==0||best.dy!==0)&&best.score>=15&&gain>=6;
  return {dx:applied?best.dx:0,dy:applied?best.dy:0,
    confidence:Number(Math.max(0,gain).toFixed(1)),applied};
}

export function estimateGridAlignment(gray:Gray,dpi:number):GridAlignment {
  const anchors=(start:number,end:number)=>
    Array.from({length:end-start+1},(_,i)=>start+i).flatMap(q=>
      [0,1,2,3].map(o=>{
        const c=getBubbleCentre(q,o as 0|1|2|3);
        return {x:mmToPx(c.xMm,dpi),y:mmToPx(c.yMm,dpi)};
      }));
  const testId=[0,1,2,3,4,5].map(d=>getTestIdBubbleCentre('tens',d))
    .concat([0,1,2,3,4,5,6,7,8,9].map(d=>getTestIdBubbleCentre('units',d)))
    .map(c=>({x:mmToPx(c.xMm,dpi),y:mmToPx(c.yMm,dpi)}));
  return {
    leftUpper:estimateGridOffset(gray,dpi,anchors(1,12)),
    leftLower:estimateGridOffset(gray,dpi,anchors(13,25)),
    rightUpper:estimateGridOffset(gray,dpi,anchors(26,37)),
    rightLower:estimateGridOffset(gray,dpi,anchors(38,50)),
    testId:estimateGridOffset(gray,dpi,testId,2.0)
  };
}

export function offsetForQuestion(alignment:GridAlignment|undefined,q:number):GridOffset {
  if(!alignment)return ZERO;
  return q<=12?alignment.leftUpper:q<=25?alignment.leftLower:
    q<=37?alignment.rightUpper:alignment.rightLower;
}
