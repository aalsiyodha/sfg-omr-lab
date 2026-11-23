/**
 * v2.5.2 validated local-mesh experiment.
 * Predict smooth per-question offsets from two independently measured
 * printed-ring regions per column. Propose corrections ONLY when spatially
 * distributed HELD-OUT printed rings support them.
 *
 * This tests geometric consistency; it does not claim to correct every
 * curved/wrinkled sheet. A score from the student's dark response is never
 * used to choose a correction.
 */
import { getBubbleCentre, mmToPx } from '../config/omrLayout';
import { offsetForQuestion, scorePrintedRingAt } from './gridAlignment';
import type { GridAlignment, GridOffset } from './gridAlignment';
import { predictGridOffset } from './predictiveGrid';
type Gray={rows:number;cols:number;ucharPtr(y:number,x:number):ArrayLike<number>;data?:Uint8Array|Uint8ClampedArray};
export type MeshResult={
  accepted:boolean;reason:string;heldOutCount:number;
  referenceScore:number;candidateScore:number;
  relativeGain:number;maxDisplacementPx:number;
  predicted:Record<number,GridOffset>;
};
const score=(gray:Gray,x:number,y:number,dpi:number,dx:number,dy:number)=>
  scorePrintedRingAt(gray,x+dx,y+dy,dpi);
export function validateLocalMesh(
  gray:Gray,dpi:number,grid:GridAlignment,
  excludedQuestions:ReadonlySet<number>=new Set()
):MeshResult{
  const predicted:Record<number,GridOffset>={};
  let referenceScore=0,candidateScore=0,heldOutCount=0;
  let maxDisplacementPx=0;
  for(let question=1;question<=50;question++){
    const base=offsetForQuestion(grid,question);
    const proposal=predictGridOffset(grid,question);
    if(!proposal.valid||proposal.uncertaintyPx>2.5)continue;
    const dx=proposal.dx-base.dx,dy=proposal.dy-base.dy;
    const movement=Math.hypot(dx,dy);
    if(movement>4)continue;
    predicted[question]={dx:proposal.dx,dy:proposal.dy,
      applied:true,confidence:Math.max(0,base.confidence-proposal.uncertaintyPx)};
    maxDisplacementPx=Math.max(maxDisplacementPx,movement);
    // Only score rows never used for offset fitting and never marked by
    // the scanner. The grid fitter samples one option at every fourth row.
    // Withheld options 1 and 2 are used here on non-fitter rows.
    if(excludedQuestions.has(question)||question%4===1)continue;
    for(const opt of [1,2] as const){
      const centre=getBubbleCentre(question,opt);
      const x=mmToPx(centre.xMm,dpi),y=mmToPx(centre.yMm,dpi);
      const baseline=score(gray,x,y,dpi,base.dx,base.dy);
      const candidate=score(gray,x,y,dpi,proposal.dx,proposal.dy);
      if(baseline<4&&candidate<4)continue;
      referenceScore+=baseline;candidateScore+=candidate;heldOutCount++;
    }
  }
  const meanReference=referenceScore/Math.max(1,heldOutCount);
  const meanCandidate=candidateScore/Math.max(1,heldOutCount);
  const gain=meanCandidate-meanReference;
  const relativeGain=meanReference>0?gain/meanReference:0;
  const accepted=heldOutCount>=18 && maxDisplacementPx>0.5 &&
    gain>=3 && relativeGain>=0.10 && maxDisplacementPx<=4;
  return {accepted,
    reason:accepted?'Held-out unmarked printed rings verify smoother mesh':
      heldOutCount<18?'Insufficient independently clean printed rings':
      maxDisplacementPx<=0.5?'No material mesh correction required':
      'Predicted mesh failed withheld landmark improvement gate',
    heldOutCount,
    referenceScore:Number(meanReference.toFixed(2)),
    candidateScore:Number(meanCandidate.toFixed(2)),
    relativeGain:Number(relativeGain.toFixed(3)),
    maxDisplacementPx:Number(maxDisplacementPx.toFixed(2)),
    predicted:accepted?predicted:{}
  };
}
