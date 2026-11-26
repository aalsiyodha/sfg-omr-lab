import type {Choice} from './key';
import type {QuestionResult,ScanResult} from '../scanner-core/types';
export type ResponseChoice=Choice|'MULTIPLE';
export type Marking={correct:number;wrong:number};
export interface EvaluatedRow{
 question:number;key:Choice;response:ResponseChoice;
 status:string;correct:boolean;marks:number;reviewed:boolean;
}
export interface Evaluation{
 correct:number;incorrect:number;blank:number;cancelled:number;multiple:number;
 total:number;max:number;rows:EvaluatedRow[];
}
export function acceptedScan(result:ScanResult,testNumber:number,ignoreTestId=false):string|null {
 if(!result.qrValid) return 'The QR code was not verified. Scoring is blocked.';
 if(!result.perspectiveCorrected||result.alignmentVerified!==true||result.alignmentMatched!==50)
   return 'All 50 timing marks and page geometry must be verified before scoring.';
 if(!ignoreTestId && result.testId!==testNumber)
   return 'Sheet Test ID '+(result.testId??'unknown')+' does not match the selected Test '+testNumber+'.';
 if(result.overallStatus==='failed'||result.errors.length)
   return 'The scanner reported a failed scan. Upload a clearer photo.';
 if(result.answers.length!==50) return 'Expected exactly 50 scanned answers.';
 return null;
}
export function needsManualReview(row:QuestionResult):boolean {
 return row.status==='uncertain'||row.status==='error';
}
export function initialResponse(row:QuestionResult):ResponseChoice {
 if(row.status==='multiple')return 'MULTIPLE';
 if(row.status==='detected')return row.detectedAnswer;
 return null;
}
export function gradeAnswers(
 key:Choice[], answers:ResponseChoice[], statuses:string[], marking:Marking,
 confirmed:boolean[]
):Evaluation {
 if(key.length!==50||answers.length!==50||statuses.length!==50||confirmed.length!==50||
    key.some(v=>v===null))throw new Error('A complete published 50-question key is required.');
 if(!Number.isFinite(marking.correct)||marking.correct<=0||
    !Number.isFinite(marking.wrong)||marking.wrong>0)throw new Error('Invalid marking scheme.');
 const rows:EvaluatedRow[]=[];
 let correct=0,incorrect=0,blank=0,cancelled=0,multiple=0,total=0;
 for(let i=0;i<50;i++){
  const k=key[i],a=answers[i],state=statuses[i];
  let marks=0,matched=false;
  if(k==='X')cancelled++;
  else if(a==='MULTIPLE'){multiple++;incorrect++;marks=marking.wrong;}
  else if(a===null||a==='X'){blank++;}
  else if(a===k){correct++;matched=true;marks=marking.correct;}
  else{incorrect++;marks=marking.wrong;}
  total+=marks;
  rows.push({question:i+1,key:k,response:a,status:state,correct:matched,marks,reviewed:confirmed[i]});
 }
 return {correct,incorrect,blank,cancelled,multiple,
  total:Number(total.toFixed(2)),
  max:Number(((50-cancelled)*marking.correct).toFixed(2)),rows};
}
