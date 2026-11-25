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
    // The original grayscale is an independent safety witness. Tone
    // correction may confirm an already-detected solid fill, but cannot
    // create a new automatic selection from a raw blank or uncertain row.
    // Keep deliberate invalid markings unattempted under SFG strict-fill rules.
    if (row.status==='detected' && baseline.status!=='detected') {
      final={...row, detectedAnswer:null,
        status:baseline.status==='blank'?'blank':'uncertain',
        confidence:0, measurements:row.measurements.map(m=>({...m})),
        policyRejectedBlank:baseline.status==='blank' && baseline.policyRejectedBlank===true};
      const m=final.measurements.find(x=>x.option===b.option);
      if(m)m.rejectReason='Tone-only selection vetoed by original grayscale';
      action=a.fillPercent<45
        ? 'reject_tone_only_low_raw_ink':'reject_tone_only_conflict';
    }
    // A manual-review indication may not be silently downgraded to blank
    // only because the tone calibration lowered its measured fill.
    if(action==='retain_corrected' && row.status==='blank' && strongInk(baseline)) {
      final={...row,detectedAnswer:null,status:'uncertain',
        confidence:0,measurements:row.measurements.map(m=>({...m}))};
      const m=final.measurements.find(x=>x.option===a.option);
      if(m)m.rejectReason='Original-grayscale ink evidence conflicts with tonal blank; manual review';
      action='retain_manual_review';
    }
    // When a partially marked bubble is uncertain on original grayscale,
    // a tonal adjustment must not promote it into a confirmed selection.
    else if(action==='retain_corrected' && row.status==='detected' && baseline.status==='uncertain' &&
      a.option===b.option && a.fillPercent>=45) {
      final={...row,detectedAnswer:null,status:'uncertain',confidence:0};
      action='avoid_tonal_promotion';
    }
    // SFG strict-fill policy: ink is NOT a response. A lone dot, crescent,
    // hatch, tick, cross, stroke or partial bubble is treated as unattempted.
    // Preserve the measured evidence and reason for the debug overlay.
    // Keep genuine conflicts between the two reading methods for review,
    // especially v4 Q18 (58.4% raw versus 23% corrected).
    const disagreement=a.option===b.option && a.fillPercent>=50 &&
      a.fillPercent-b.fillPercent>=25 && baseline.status!=='blank';
    const rejectText=[a.rejectReason,b.rejectReason].filter(Boolean).join(' ').toLowerCase();
    const clearInvalid=/centre dot|central dot|crescent|partial|hatch|striped|stroke|slash|cross|outline|asymmetr|ink distribution|low fill|thin non-solid/.test(rejectText) ||
      a.radialShape==='centre_dot' || b.radialShape==='centre_dot' ||
      a.radialShape==='hollow_ring' || b.radialShape==='hollow_ring' ||
      (a.radialShape==='partial' && b.radialShape==='partial');
    if(final.status==='uncertain' && !disagreement &&
      baseline.status!=='detected' && clearInvalid) {
      final={...final,detectedAnswer:null,status:'blank',confidence:100,
        measurements:final.measurements.map(m=>({...m})),policyRejectedBlank:true};
      const mark=final.measurements.find(m=>m.option===b.option);
      if(mark)mark.rejectReason='Invalid/non-solid mark; treated as blank by strict-fill policy'
        +(mark.rejectReason?' ('+mark.rejectReason+')':'');
      action='invalid_mark_blank';
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
