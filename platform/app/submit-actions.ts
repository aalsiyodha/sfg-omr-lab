'use server';
import {requireUser} from '@/lib/auth';
import {authorizedTest} from '@/lib/repository';
import {sql} from '@/lib/neon';
import {gradeAnswers,type ResponseChoice} from '@/lib/evaluation';
import {revalidatePath} from 'next/cache';

export type ReviewedSubmission={
 testId:string;printedTestId:number;candidateCode:string;candidateName:string;
 qrVerified:boolean;timingMatched:number;alignmentVerified:boolean;
 responses:ResponseChoice[];statuses:string[];confirmed:boolean[];
 scannerVersion:string;
};
const option=(x:unknown):x is ResponseChoice=>x===null||['A','B','C','D','MULTIPLE'].includes(String(x));
export async function saveReviewedSubmission(payload:ReviewedSubmission):Promise<{ok:boolean;message:string}>{
 const {user}=await requireUser();
 if(!/^[0-9a-f-]{36}$/i.test(payload.testId||''))return {ok:false,message:'Invalid test ID'};
 const test=await authorizedTest(user.id,payload.testId);
 if(!test||test.status!=='published')return {ok:false,message:'Published test access required'};
 if(!payload.qrVerified||!payload.alignmentVerified||payload.timingMatched!==50||
    payload.printedTestId!==test.sheet_test_number)
  return {ok:false,message:'QR, printed Test ID and all timing marks must be verified'};
 const code=payload.candidateCode?.trim(),name=payload.candidateName?.trim();
 if(!code||code.length>80||!name||name.length>120)
  return {ok:false,message:'A valid QR candidate ID and name are required'};
 if(payload.responses?.length!==50||payload.statuses?.length!==50||
    payload.confirmed?.length!==50||payload.confirmed.some(v=>v!==true)||
    payload.responses.some(v=>!option(v))||
    payload.statuses.some(v=>!['detected','blank','multiple','uncertain','error','manual'].includes(v)))
  return {ok:false,message:'All 50 responses must be reviewed and valid'};
 if(!Array.isArray(test.answer_key)||test.answer_key.length!==50||
    test.answer_key.some(k=>!['A','B','C','D','X'].includes(String(k))))
  return {ok:false,message:'Published key is incomplete'};
 const grade=gradeAnswers(test.answer_key,payload.responses,payload.statuses,
  {correct:Number(test.correct_marks),wrong:Number(test.wrong_marks)},payload.confirmed);
 // The scanner runs client-side. A logged-in reviewer explicitly signs off on this
 // submission; the server NEVER accepts browser-computed marks.
 const s=sql();
 const candidates=await s`INSERT INTO candidates(institute_id,candidate_code,display_name)
  VALUES(${test.institute_id}::uuid,${code},${name})
  ON CONFLICT(institute_id,candidate_code) DO UPDATE SET display_name=EXCLUDED.display_name
  RETURNING id`;
 const candidate=candidates[0]?.id;
 if(!candidate)return {ok:false,message:'Candidate record could not be saved'};
 const saved=await s`INSERT INTO scan_submissions(
 institute_id,test_id,candidate_id,reviewer_id,qr_verified,timing_matched,
 scanner_version,answers,answer_statuses,review_confirmed,
 score,correct_count,incorrect_count,blank_count,multiple_count)
 VALUES(${test.institute_id}::uuid,${test.id}::uuid,${String(candidate)}::uuid,${user.id},
 TRUE,50,${payload.scannerVersion||'v2.7.1'},${JSON.stringify(payload.responses)}::jsonb,
 ${JSON.stringify(payload.statuses)}::jsonb,TRUE,${grade.total},${grade.correct},
 ${grade.incorrect},${grade.blank},${grade.multiple}) RETURNING id`;
 if(!saved.length)return {ok:false,message:'Unable to store reviewed result'};
 revalidatePath('/dashboard/tests/'+test.id+'/leaderboard');
 revalidatePath('/dashboard/tests/'+test.id+'/analysis');
 return {ok:true,message:'Reviewed score saved in Neon. It is now included in the leaderboard and question analysis.'};
}
