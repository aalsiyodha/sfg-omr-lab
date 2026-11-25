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
  rejectionBreakdown:{
    noTrustworthyPrediction:number;predictionTooUncertain:number;
    displacementTooLarge:number;excludedInkRows:number;
    fittedAnchorSkipped:number;lowContrastLandmarks:number;
    testedRows:number;
  };
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
  const rejectionBreakdown={noTrustworthyPrediction:0,predictionTooUncertain:0,
    displacementTooLarge:0,excludedInkRows:0,fittedAnchorSkipped:0,
    lowContrastLandmarks:0,testedRows:0};
  for(let question=1;question<=50;question++){
    const base=offsetForQuestion(grid,question);
    const proposal=predictGridOffset(grid,question);
    if(!proposal.valid){rejectionBreakdown.noTrustworthyPrediction++;continue;}
    if(proposal.uncertaintyPx>2.5){rejectionBreakdown.predictionTooUncertain++;continue;}
    const dx=proposal.dx-base.dx,dy=proposal.dy-base.dy;
    const movement=Math.hypot(dx,dy);
    if(movement>4){rejectionBreakdown.displacementTooLarge++;continue;}
    predicted[question]={dx:proposal.dx,dy:proposal.dy,
      applied:true,confidence:Math.max(0,base.confidence-proposal.uncertaintyPx)};
    maxDisplacementPx=Math.max(maxDisplacementPx,movement);
    // The fitting sample rotates its selected answer option per row.
    // Choose only other options, and exclude every row with observed ink.
    if(excludedQuestions.has(question)){rejectionBreakdown.excludedInkRows++;continue;}
    rejectionBreakdown.testedRows++;
    const regionStart=question<=12?1:question<=25?13:question<=37?26:38;
    const fittedOption=(question-regionStart)%4;
    for(const opt of [1,2] as const){
      if(opt===fittedOption){rejectionBreakdown.fittedAnchorSkipped++;continue;}
      const centre=getBubbleCentre(question,opt);
      const x=mmToPx(centre.xMm,dpi),y=mmToPx(centre.yMm,dpi);
      const baseline=score(gray,x,y,dpi,base.dx,base.dy);
      const candidate=score(gray,x,y,dpi,proposal.dx,proposal.dy);
      if(baseline<4&&candidate<4){rejectionBreakdown.lowContrastLandmarks++;continue;}
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
      rejectionBreakdown.noTrustworthyPrediction===50
        ?'No independently trusted grid offsets; cannot propose a mesh':
      rejectionBreakdown.predictionTooUncertain>40
        ?'Predicted mesh too uncertain at most rows':
      heldOutCount<18?'Insufficient independently clean printed rings':
      maxDisplacementPx<=0.5?'No material mesh correction required':
      'Predicted mesh failed withheld landmark improvement gate',
    heldOutCount,
    referenceScore:Number(meanReference.toFixed(2)),
    candidateScore:Number(meanCandidate.toFixed(2)),
    relativeGain:Number(relativeGain.toFixed(3)),
    maxDisplacementPx:Number(maxDisplacementPx.toFixed(2)),
    predicted:accepted?predicted:{},rejectionBreakdown
  };
}
