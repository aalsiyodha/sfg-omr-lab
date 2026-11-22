import { OMR_LAYOUT, mmToPx } from '../config/omrLayout';
import { computeAdaptiveDarkThreshold } from './bubbleDetector';

/** Diagnostic probe only: no bubble/answer pixels or QR identity are used. */
export interface TimingBandProfile {
  matches: number;
  left: number[];
  right: number[];
  unmatchedLeft: number[];
  unmatchedRight: number[];
  bestShiftPx: { dx: number; dy: number; matches: number; leftMatched: number; rightMatched: number };
  imageSize: { width: number; height: number };
  threshold: number;
}
export const timingRows = (count=25): number[] => Array.from({length:count},(_,i)=>i+1);

/** Count independent printed timing-square hits at a common global translation.
 * Shifts are bounded to 3 mm and never used as proof without a fresh QR check.
 */
export function timingMatchAtShift(gray:any,dpi:number,threshold:number,dx:number,dy:number){
  const r=Math.max(1,Math.round(mmToPx(.35,dpi)));
  const rows=OMR_LAYOUT.answers.questionsPerCol;
  // Fast contiguous grayscale access; retain ucharPtr for test doubles.
  const pixels:Uint8Array|undefined=gray.data;
  const stride=typeof gray.step==='number'?gray.step:gray.cols;
  const pixel=(y:number,x:number)=>pixels?pixels[y*stride+x]:gray.ucharPtr(y,x)[0];
  const matched={left:[] as number[],right:[] as number[]};
  for(let i=0;i<rows;i++){
    const y=Math.round(mmToPx(OMR_LAYOUT.answers.rowStartY+
      i*OMR_LAYOUT.answers.rowSpacingY,dpi))+dy;
    for(const [side,xMm] of [['left',13.3],['right',196.7]] as const){
      const x=Math.round(mmToPx(xMm,dpi))+dx;
      if(x-r<0||y-r<0||x+r>=gray.cols||y+r>=gray.rows)continue;
      let dark=0,samples=0;
      for(let yy=-r;yy<=r;yy++)for(let xx=-r;xx<=r;xx++){
        samples++;
        if(pixel(y+yy,x+xx)<threshold)dark++;
      }
      if(dark/samples>=.4)matched[side].push(i+1);
    }
  }
  return {left:matched.left,right:matched.right,
    leftMatched:matched.left.length,rightMatched:matched.right.length,
    matches:matched.left.length+matched.right.length};
}

/** Try small shared translation offsets and disclose how much they help.
 * A high score is an investigation hint, NEVER an accepted alignment.
 */
export function diagnoseTimingLattice(gray:any,dpi:number):TimingBandProfile{
  const threshold=computeAdaptiveDarkThreshold(gray);
  const original=timingMatchAtShift(gray,dpi,threshold,0,0);
  const max=Math.min(18,Math.ceil(mmToPx(3,dpi)));
  let best={dx:0,dy:0,...original};
  // Broad deterministic search followed by 1-pixel local refinement.
  for(let dy=-max;dy<=max;dy+=3)for(let dx=-max;dx<=max;dx+=3){
    const v=timingMatchAtShift(gray,dpi,threshold,dx,dy);
    if(v.matches>best.matches ||
      (v.matches===best.matches && Math.hypot(dx,dy)<Math.hypot(best.dx,best.dy)))
      best={dx,dy,...v};
  }
  const coarse=best;
  for(let dy=Math.max(-max,coarse.dy-3);dy<=Math.min(max,coarse.dy+3);dy++){
    for(let dx=Math.max(-max,coarse.dx-3);dx<=Math.min(max,coarse.dx+3);dx++){
      const v=timingMatchAtShift(gray,dpi,threshold,dx,dy);
      if(v.matches>best.matches ||
        (v.matches===best.matches && Math.hypot(dx,dy)<Math.hypot(best.dx,best.dy)))
        best={dx,dy,...v};
    }
  }
  const all=timingRows(OMR_LAYOUT.answers.questionsPerCol);
  return {matches:original.matches,left:original.left,right:original.right,
    unmatchedLeft:all.filter(x=>!original.left.includes(x)),
    unmatchedRight:all.filter(x=>!original.right.includes(x)),
    bestShiftPx:{dx:best.dx,dy:best.dy,matches:best.matches,
      leftMatched:best.leftMatched,rightMatched:best.rightMatched},
    imageSize:{width:gray.cols,height:gray.rows},threshold};
}
