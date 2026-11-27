/**
 * OMRLab 3.8.0: answer-centric geometry correction.
 * 200 printed bubble outlines are *measurement landmarks*, not answers.
 * Every candidate per-question displacement is selected from a fixed
 * training subset (A and C rings), then adopted only when independently
 * held-out (B and D) outlines support the correction. No student's ink
 * intensity is used as the objective; marked cores lower ring contrast.
 * Old strict bubble policy remains unchanged.
 */
import {getBubbleCentre,mmToPx,OMR_LAYOUT} from '../config/omrLayout';
import {scorePrintedRingAt,type GridOffset} from './gridAlignment';
type Gray={cols:number;rows:number;ucharPtr(y:number,x:number):ArrayLike<number>;data?:Uint8Array|Uint8ClampedArray};
type XY={dx:number;dy:number};
export type RingDecision={
  question:number;fitBaseline:number;fitCandidate:number;
  holdoutBaseline:number;holdoutCandidate:number;gain:number;
  dx:number;dy:number;applied:boolean;reason:string;untrustedRings:number;
};
export type RingRefinement={
  offsets:Record<number,GridOffset>;
  checks:RingDecision[];
  adopted:number;rejected:number;
  meanHoldoutGain:number;
  maxDisplacement:number;
};
const round=(v:number)=>Math.round(v*100)/100;
const ring=(gray:Gray,dpi:number,question:number,opt:0|1|2|3,offset:XY)=>{
  const pos=getBubbleCentre(question,opt);
  return scorePrintedRingAt(gray,mmToPx(pos.xMm,dpi)+offset.dx,
    mmToPx(pos.yMm,dpi)+offset.dy,dpi,OMR_LAYOUT.answers.bubbleDiamMm/2);
};
/** Robust to one marked circle, but cannot prove correctness from two rings. */
const scorePair=(a:number,b:number)=>Math.max(a,b)+.35*Math.min(a,b);
export function refineQuestionRings(
  gray:Gray,dpi:number,base:(q:number)=>GridOffset,
  maxShiftPx=3
):RingRefinement {
  const offsets:Record<number,GridOffset>={};
  const checks:RingDecision[]=[];
  let adopted=0,totalHoldoutGain=0,maxDisplacement=0;
  const shifts:XY[]=[];
  for(let dy=-maxShiftPx;dy<=maxShiftPx;dy++)
    for(let dx=-maxShiftPx;dx<=maxShiftPx;dx++)
      shifts.push({dx,dy});
  for(let question=1;question<=50;question++){
    const original=base(question);
    const baseline={dx:original.dx,dy:original.dy};
    const measure=(shift:XY)=>{
      const off={dx:baseline.dx+shift.dx,dy:baseline.dy+shift.dy};
      return [0,1,2,3].map(opt=>ring(gray,dpi,question,opt as 0|1|2|3,off));
    };
    const initial=measure({dx:0,dy:0});
    const baselineFit=scorePair(initial[0],initial[2]);
    const baselineHold=scorePair(initial[1],initial[3]);
    // Fit only on half the options; these are independent spatial samples
    // from the held-out B and D rings. Penalise excessive movement.
    let best={dx:0,dy:0,fit:baselineFit,values:initial};
    for(const shift of shifts){
      if(shift.dx===0&&shift.dy===0)continue;
      const values=measure(shift);
      const fit=scorePair(values[0],values[2])-.65*Math.hypot(shift.dx,shift.dy);
      if(fit>best.fit)best={...shift,fit,values};
    }
    const held=scorePair(best.values[1],best.values[3]);
    const gain=held-baselineHold;
    const independentSupport=Math.max(best.values[1],best.values[3])>=9;
    const enoughGain=gain>=3.5 && best.fit-baselineFit>=3.5;
    const displacement=Math.hypot(best.dx,best.dy);
    const applied=displacement>0&&independentSupport&&enoughGain&&displacement<=maxShiftPx*1.42;
    const offset={dx:baseline.dx+(applied?best.dx:0),
      dy:baseline.dy+(applied?best.dy:0),
      applied:original.applied||applied,
      confidence:applied?Math.min(100,round(gain)):original.confidence};
    offsets[question]=offset;
    if(applied){adopted++;totalHoldoutGain+=gain;
      maxDisplacement=Math.max(maxDisplacement,displacement);}
    checks.push({question,fitBaseline:round(baselineFit),
      fitCandidate:round(best.fit),holdoutBaseline:round(baselineHold),
      holdoutCandidate:round(held),gain:round(gain),
      dx:applied?best.dx:0,dy:applied?best.dy:0,applied,
      reason:applied?'independent-ring-holdout-supported':
        !independentSupport?'insufficient-printed-ring-evidence':
        !enoughGain?'insufficient-independent-gain':'no-change',
      untrustedRings:best.values.filter(x=>x<9).length});
  }
  return {offsets,checks,adopted,rejected:50-adopted,
    meanHoldoutGain:adopted?round(totalHoldoutGain/adopted):0,
    maxDisplacement:round(maxDisplacement)};
}
