/**
 * Evaluate two independent answer-classification readings under the SAME
 * verified homography and printed-ring offset. The original grayscale is
 * a safety witness: a tone LUT may not erase clearly visible ink by
 * silently converting a manual-review candidate to "blank".
 *
 * No new marks are inferred from an isolated coloured pixel or a low
 * (<45%) raw fill. Do not auto-accept a conflicting valid answer.
 */
import type { QuestionResult, BubbleMeasurement } from '../types';
export type ClassificationDifference = {
  question:number; rawStatus:string; correctedStatus:string;
  rawFill:number; correctedFill:number; action:string;
};
const strongest=(row:QuestionResult):BubbleMeasurement=>
  [...row.measurements].sort((a,b)=>b.fillPercent-a.fillPercent)[0];
const strongInk=(row:QuestionResult):boolean=>{
  const item=strongest(row);
  // A documented high-density bubble or an existing shape-based review
  // is stronger than a near-zero residual caused by a printed outline.
  return item.fillPercent>=45 && (
    row.status==='detected' || row.status==='uncertain' ||
    row.status==='multiple'
  );
};
export function reconcileToneAnswers(
  raw:QuestionResult[], corrected:QuestionResult[]
):{answers:QuestionResult[]; differences:ClassificationDifference[]} {
  const reference=new Map(raw.map(r=>[r.question,r]));
  const differences:ClassificationDifference[]=[];
  const answers=corrected.map(row=>{
    const baseline=reference.get(row.question);
    if(!baseline)return row;
    const a=strongest(baseline),b=strongest(row);
    let action='retain_corrected';
    let final=row;
    // A manual-review indication may not be silently downgraded to blank
    // only because the tone calibration lowered its measured fill.
    if(row.status==='blank' && strongInk(baseline)) {
      final={...row,detectedAnswer:null,status:'uncertain',
        confidence:0,measurements:row.measurements.map(m=>({...m}))};
      const m=final.measurements.find(x=>x.option===a.option);
      if(m)m.rejectReason='Original-grayscale ink evidence conflicts with tonal blank; manual review';
      action='retain_manual_review';
    }
    // When a partially marked bubble is uncertain on original grayscale,
    // a tonal adjustment must not promote it into a confirmed selection.
    else if(row.status==='detected' && baseline.status==='uncertain' &&
      a.option===b.option && a.fillPercent>=45) {
      final={...row,detectedAnswer:null,status:'uncertain',confidence:0};
      action='avoid_tonal_promotion';
    }
    if(baseline.status!==row.status || baseline.detectedAnswer!==row.detectedAnswer ||
       Math.abs(a.fillPercent-b.fillPercent)>=5 || action!=='retain_corrected')
      differences.push({question:row.question,rawStatus:baseline.status,
        correctedStatus:row.status,rawFill:Number(a.fillPercent.toFixed(1)),
        correctedFill:Number(b.fillPercent.toFixed(1)),action});
    return final;
  });
  return {answers,differences};
}
