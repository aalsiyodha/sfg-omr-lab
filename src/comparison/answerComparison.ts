import type {EngineResult} from './engines';

/** A factual inter-engine comparison, NOT a claim of human-verified ground truth.
 * Never convert uncertain, unobserved or unvalidated marks to blank.
 */
export type AnswerClass='detected'|'blank'|'multiple'|'uncertain'|'unobserved';
export type ComparisonRow={q:number;referenceAnswer:string|null;referenceStatus:AnswerClass;
  candidateAnswer:string|null;candidateStatus:AnswerClass;
  verdict:'match'|'wrong-option'|'extra-mark'|'missed-mark'|'status-mismatch'|'unresolved'};
export type ComparisonSummary={engineId:string;referenceId:string;rows:ComparisonRow[];
  exactMatches:number;optionErrors:number;extraMarks:number;missedMarks:number;
  statusErrors:number;unresolved:number;comparable:number;coverage:number;
  referenceIsGroundTruth:false};
const status=(s:string|undefined,answer:string|null|undefined):AnswerClass=>{
  if(s==='multiple')return 'multiple';
  if(s==='blank')return 'blank';
  if(s==='uncertain'||s==='experimental')return 'uncertain';
  if(s==='detected'||(s==='experimental'&&answer))return 'detected';
  return 'unobserved';
};
export function compareAnswers(reference:EngineResult,candidate:EngineResult):ComparisonSummary{
  const rows:ComparisonRow[]=[];
  for(let q=1;q<=50;q++){
    const a=reference.answers.find(x=>x.q===q),b=candidate.answers.find(x=>x.q===q);
    const referenceStatus=a?status(a.status,a.answer):'unobserved';
    const candidateStatus=b?status(b.status,b.answer):'unobserved';
    let verdict:ComparisonRow['verdict']='unresolved';
    if(referenceStatus!=='unobserved'&&candidateStatus!=='unobserved'
      &&referenceStatus!=='uncertain'&&candidateStatus!=='uncertain'){
      if(referenceStatus===candidateStatus){
        verdict=referenceStatus==='detected'?
          (a?.answer===b?.answer?'match':'wrong-option'):'match';
      }else if(referenceStatus==='detected'&&candidateStatus==='blank')verdict='missed-mark';
      else if(referenceStatus==='blank'&&candidateStatus==='detected')verdict='extra-mark';
      else verdict='status-mismatch';
    }
    rows.push({q,referenceAnswer:a?.answer??null,referenceStatus,
      candidateAnswer:b?.answer??null,candidateStatus,verdict});
  }
  const count=(v:ComparisonRow['verdict'])=>rows.filter(r=>r.verdict===v).length;
  return {engineId:candidate.id,referenceId:reference.id,rows,
    exactMatches:count('match'),optionErrors:count('wrong-option'),extraMarks:count('extra-mark'),
    missedMarks:count('missed-mark'),statusErrors:count('status-mismatch'),
    unresolved:count('unresolved'),comparable:50-count('unresolved'),
    coverage:candidate.answers.length,referenceIsGroundTruth:false};
}
