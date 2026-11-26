import Link from 'next/link';
import {notFound,redirect} from 'next/navigation';
import {requireUser} from '@/lib/auth';
import {isConfigured} from '@/lib/env';
import {authorizedTest,analysisForTest} from '@/lib/repository';
type Item={question:number;correct_answer:string;total_attempts:number;correct_count:number;option_a:number;option_b:number;option_c:number;option_d:number;blank_count:number;multiple_count:number;correct_percent:number};
export default async function QuestionAnalysis({params}:{params:Promise<{id:string}>}){
 if(!isConfigured())redirect('/demo');
 const {user}=await requireUser();
 const {id}=await params;
 if(!/^[0-9a-f-]{36}$/i.test(id))notFound();
 const test=await authorizedTest(user.id,id);
 if(!test)notFound();
 const rows=await analysisForTest(user.id,id);
 const error=null;
 return <div className="dashboard">
  <Link className="backLink" href={'/dashboard/tests/'+id}>← Back to answer key</Link>
  <div className="dashTop"><div><span className="miniEyebrow">INSTITUTE ANALYTICS</span>
   <h1>Question analysis</h1>
   <p>{test.title} · Option distributions and accuracy across verified, reviewed submissions.</p></div></div>
  {error&&<p className="alert">Unable to load question statistics. Run the analytics SQL migration.</p>}
  {!rows.length?<div className="surface empty"><h3>No completed scans yet</h3>
   <p>When reviewed student results are submitted, this screen will show question-by-question performance.</p></div>:
   <div className="analysisGrid">{rows.map(row=><section key={row.question} className="surface analysisCard">
    <div className="sectionHeading"><div><span className="miniEyebrow">QUESTION {String(row.question).padStart(2,'0')}</span>
      <h2>{row.correct_answer==='X'?'Cancelled':'Correct answer: '+row.correct_answer}</h2></div>
      <span className="pill">{row.total_attempts} attempts</span></div>
    <div className="analysisScore">{row.correct_answer==='X'?'Not scored':Number(row.correct_percent).toFixed(1)+'% correct'}</div>
    {([['A',row.option_a],['B',row.option_b],['C',row.option_c],['D',row.option_d],['Blank',row.blank_count],['Multiple',row.multiple_count]] as const).map(([option,count])=>
      <div className="analysisOption" key={option}>
       <div className="analysisLabel"><span>{option}{option===row.correct_answer?' ✓':''}</span><strong>{count}</strong></div>
       <div className="analysisTrack"><span className={option===row.correct_answer?'correct':''}
        style={{width:(row.total_attempts>0?100*count/row.total_attempts:0)+'%'}}/></div>
      </div>)}
   </section>)}</div>}
  <p className="muted small">Only reviewed submissions are included. A cancelled question does not contribute to the correctness percentage.</p>
 </div>;
}
