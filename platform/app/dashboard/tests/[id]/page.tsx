import Link from 'next/link';
import {notFound,redirect} from 'next/navigation';
import {requireUser} from '@/lib/auth';
import {isConfigured} from '@/lib/env';
import type {TestRecord} from '@/lib/types';
import {validKey} from '@/lib/key';
import AnswerKeyEditor from '@/components/AnswerKeyEditor';
import OmrEvaluation from '@/components/OmrEvaluation';
export default async function TestDetail({params,searchParams}:{
 params:Promise<{id:string}>;searchParams:Promise<{error?:string;saved?:string;published?:string}>
}){
 if(!isConfigured())redirect('/demo');
 const {db,user}=await requireUser();
 const {id}=await params;
 if(!/^[0-9a-f-]{36}$/i.test(id))notFound();
 const {data}=await db.from('tests').select('*').eq('id',id).single();
 if(!data)notFound();
 const test=data as TestRecord;
 const {data:org}=await db.from('institutes').select('name').eq('id',test.institute_id).single();
 const {data:membership}=await db.from('institute_members').select('role')
   .eq('institute_id',test.institute_id).eq('user_id',user.id).single();
 const mayEdit=membership?.role==='owner'||membership?.role==='admin';
 const paramsQuery=await searchParams;
 return <div className="keyPage">
   <Link className="backLink" href={'/dashboard?org='+test.institute_id}>← Back to dashboard</Link>
   <div className="dashTop"><div><span className="miniEyebrow">{org?.name||'INSTITUTE'} · TEST {test.sheet_test_number}</span>
     <h1>{test.title}</h1><p>50 questions · Correct {test.correct_marks} · Incorrect {test.wrong_marks} · Unattempted 0</p></div>
     <div className="toolActions"><Link className="button secondary compact" href={'/dashboard/tests/'+test.id+'/leaderboard'}>View leaderboard ↗</Link><Link className="button secondary compact" href={'/dashboard/tests/'+test.id+'/analysis'}>Question analytics ↗</Link>
     <span className={test.status==='published'?'status':'pill'}>{test.status==='published'?'● Published':'Draft'}</span></div>
   </div>
   {paramsQuery.error&&<div className="alert">{paramsQuery.error==='incomplete'?'Complete all 50 answers or mark cancelled questions with X before publishing.':'Unable to save. Check the input and your permissions.'}</div>}
   {paramsQuery.saved&&<div className="successBox">Draft saved. Review all answers before publishing.</div>}
   {paramsQuery.published&&<div className="successBox">Official answer key published and locked.</div>}
   <AnswerKeyEditor testId={test.id} initial={validKey(test.answer_key)?test.answer_key:Array(50).fill(null)}
     published={test.status==='published'} mayEdit={mayEdit}/>
   <OmrEvaluation key={test.id} testDbId={test.id} testNumber={test.sheet_test_number} testTitle={test.title}
     answerKey={test.answer_key} published={test.status==='published'}
     correctMarks={Number(test.correct_marks)} wrongMarks={Number(test.wrong_marks)}/>
   <div className="notice">Publishing locks the official answer key. Versioned corrections and rescoring will be added in a later release.</div>
 </div>
}
