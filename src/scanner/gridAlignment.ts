/**
 * v2.1.1 — conservative printed-ring registration refinement.
 *
 * The timing squares verify the broad warp but a small local drift can put
 * the 1mm ink ROI on the preprinted outlines instead of the bubble centres.
 * Use the UNMARKED printed rings as independent references. Never search for
 * the darkest ink point; this would chase student markings.
 */
import { getBubbleCentre, getTestIdBubbleCentre, mmToPx } from '../config/omrLayout';

export interface GridOffset { dx: number; dy: number; confidence: number; applied: boolean }
export interface GridAlignment {
  leftUpper: GridOffset;
  leftLower: GridOffset;
  rightUpper: GridOffset;
  rightLower: GridOffset;
  testId: GridOffset;
}
type Gray = {rows:number;cols:number;ucharPtr(y:number,x:number):ArrayLike<number>};
const ZERO: GridOffset = { dx:0,dy:0,confidence:0,applied:false };

/** Difference in intensity between the dark printed ring and pale central paper. */
function ringScore(gray: Gray, x: number, y: number, dpi: number, radiusMm:number): number {
  const s=dpi/25.4;
  const cx=Math.round(x),cy=Math.round(y);
  const outer=Math.ceil((radiusMm+0.4)*s);
  if(cx-outer<0||cy-outer<0||cx+outer>=gray.cols||cy+outer>=gray.rows)return 0;
  const ring0=((radiusMm-0.18)*s)**2, ring1=((radiusMm+0.16)*s)**2;
  const core=(radiusMm*0.53*s)**2;
  let darkRing=0,nRing=0,coreSum=0,nCore=0;
  for(let dy=-outer;dy<=outer;dy++){
    for(let dx=-outer;dx<=outer;dx++){
      const d2=dx*dx+dy*dy;
      if(d2>ring1 && d2>core)continue;
      const val=gray.ucharPtr(cy+dy,cx+dx)[0];
      if(d2>=ring0&&d2<=ring1){darkRing+=val;nRing++;}
      if(d2<=core){coreSum+=val;nCore++;}
    }
  }
  if(nRing<8||nCore<5)return 0;
  return Math.max(0,Math.min(90,coreSum/nCore-darkRing/nRing));
}

/** Pick an offset only when substantial ring evidence beats the unshifted layout. */
export function estimateGridOffset(
  gray:Gray,dpi:number,anchors:{x:number;y:number}[],ringRadiusMm=1.7,
):GridOffset {
  if(anchors.length<4)return {...ZERO};
  // v2.1.2: Score a modest, distributed set of template rings instead of
  // evaluating all 52 rings at 400+ shifts. Two-stage coarse/fine search cuts
  // millions of per-pixel calls without giving up sub-mm refinement.
  const sampled=anchors.filter((_,i)=>i%Math.max(1,Math.floor(anchors.length/12))===0).slice(0,16);
  const max=Math.round(mmToPx(1.6,dpi));
  const scored=(dx:number,dy:number):number=>{
    const values=sampled.map(p=>ringScore(gray,p.x+dx,p.y+dy,dpi,ringRadiusMm)).sort((a,b)=>a-b);
    const middle=values.slice(Math.floor(values.length/4),Math.ceil(values.length*3/4));
    return middle.reduce((a,b)=>a+b,0)/Math.max(1,middle.length)-0.35*Math.hypot(dx,dy);
  };
  const baseline=scored(0,0);
  let best={dx:0,dy:0,score:baseline};
  // Include the actual boundaries and zero. Stride 3 makes the coarse search
  // 7x7 rather than 21x21 at the current 150 DPI setting.
  const step=3;
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
