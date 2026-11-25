/**
 * v2.5.1 ProofScan: inexpensive, closed-set DECISION AUDIT.
 * Inspiration: bounded decision heads, selective prediction, and local
 * counterfactual agreement. This is NOT a pretrained Gemini/Jev/JEPA model.
 * There is no learned probability without a labeled calibration set.
 * The existing strict-fill classifier remains the authority; this module
 * cannot promote an invalid/blank/uncertain bubble into an accepted answer.
 */
import type { BubbleMeasurement, QuestionResult } from '../types';

export type MarkClass = 'empty' | 'solid_candidate' | 'stroke' | 'hatching' |
  'ring_or_crescent' | 'partial' | 'multiple' | 'ambiguous';
export type ProofAction = 'accept_existing' | 'keep_blank' | 'keep_multiple' | 'review';
export type BubbleProof = {
  question:number;
  markClass:MarkClass;
  action:ProofAction;
  option:string|null;
  reason:string;
  evidence:{
    fill:number;core:number;middle:number;outer:number;
    sectors:number;quadrants:number;stability:number;
    geometryOffsetPx:number;geometryConfidence:number;
    rawToneDisagreement:boolean;
  };
};
export type GeometryProofContext = {
  dx:number;dy:number;confidence:number;applied:boolean;
};
const clamp=(v:number)=>Math.max(0,Math.min(100,v));
function strongest(row:QuestionResult):BubbleMeasurement | undefined {
  return [...row.measurements].sort((a,b)=>b.fillPercent-a.fillPercent)[0];
}
function classify(m:BubbleMeasurement | undefined,row:QuestionResult):MarkClass {
  if(row.status==='multiple')return 'multiple';
  if(!m||m.fillPercent<18)return 'empty';
  if(m.hatchLike||((m.hatchGapRows??0)>=4 && m.fillPercent<88))return 'hatching';
  if(m.strokeLike||/stroke|tick|slash|cross/.test(m.rejectReason?.toLowerCase()??''))return 'stroke';
  if(m.radialShape==='hollow_ring'||m.radialShape==='centre_dot'||
     (m.radialCore??0)<35&&(m.radialOuter??0)>55)return 'ring_or_crescent';
  if(m.radialShape==='partial'||m.filledSectors!==undefined&&m.filledSectors<=5||
     m.filledQuadrants!==undefined&&m.filledQuadrants<=2)return 'partial';
  if(row.status==='detected'&&m.fillPercent>=70&&m.validMark!==false)return 'solid_candidate';
  return 'ambiguous';
}
/**
 * Shadow/audit classification; select a review candidate only when the
 * existing optical reading has conflicting evidence. An invalid mark is NOT
 * made valid by shifting or rethresholding a crop.
 */
export function auditBubbleDecision(
  row:QuestionResult,geometry:GeometryProofContext,
  rawRow?:QuestionResult
):BubbleProof {
  const m=strongest(row), raw=rawRow?strongest(rawRow):undefined;
  const rawToneDisagreement=Boolean(rawRow&&(
    rawRow.status!==row.status ||
    rawRow.detectedAnswer!==row.detectedAnswer ||
    (raw?.option===m?.option&&Math.abs((raw?.fillPercent??0)-(m?.fillPercent??0))>=25)
  ));
  const markClass=classify(m,row);
  const fill=m?.fillPercent??0;
  const unstable=(m?.stabilitySpread??0)>=22;
  const geometryOffsetPx=Math.hypot(geometry.dx,geometry.dy);
  const geometryRisk=geometry.applied&&geometryOffsetPx>=5&&geometry.confidence<9;
  const riskyAccepted=row.status==='detected' && (
    markClass!=='solid_candidate' || unstable || rawToneDisagreement || geometryRisk ||
    (m?.radialCore!==undefined&&m.radialCore<55) ||
    (m?.filledSectors!==undefined&&m.filledSectors<6));
  let action:ProofAction='keep_blank',reason='Existing strict blank retained';
  if(row.status==='multiple'){action='keep_multiple';reason='Existing multiple marks retained';}
  else if(row.status==='uncertain'||riskyAccepted) {
    action='review';
    reason=riskyAccepted?'Accepted mark conflicts with morphology, tone or local alignment':
      'Existing uncertain optical decision';
  }else if(row.status==='detected'){
    action='accept_existing';
    reason='Existing acceptance supported; this is not a calibrated probability';
  }else if(rawToneDisagreement&&fill>=45&&markClass==='ambiguous'){
    action='review';reason='Raw and tone readings disagree on ambiguous ink';
  }
  return {
    question:row.question,markClass,action,option:m?.option??null,reason,
    evidence:{fill:clamp(fill),core:clamp(m?.radialCore??0),
      middle:clamp(m?.radialMiddle??0),outer:clamp(m?.radialOuter??0),
      sectors:m?.filledSectors??0,quadrants:m?.filledQuadrants??0,
      stability:m?.stabilitySpread??0,geometryOffsetPx,
      geometryConfidence:geometry.confidence,rawToneDisagreement}
  };
}
/** Never create an automatic answer. A review demotes only an already
 * accepted ambiguous result, without changing multiple/invalid blanks. */
export function applyDecisionReview(
  row:QuestionResult,proof:BubbleProof,enabled:boolean
):QuestionResult {
  if(!enabled||proof.action!=='review'||row.status!=='detected')return row;
  return {...row,status:'uncertain',detectedAnswer:null,confidence:0};
}
