'use client';
import {useState} from 'react';
import type {Evaluation} from '@/lib/evaluation';
export type DemoPeer={
 name:string;code:string;score:number;answers:(string|null)[];statuses:string[];
};
type Filter='all'|'wrong'|'correct'|'skipped';
function statusOf(answer:string|null,key:string|null,status:string){
 if(key==='X'||key===null)return 'cancelled';
 if(status==='multiple'||answer==='MULTIPLE')return 'wrong';
 if(answer===null||answer==='X'||answer==='')return 'skipped';
 return answer===key?'correct':'wrong';
}
function label(answer:string|null,status:string){
 if(status==='multiple'||answer==='MULTIPLE')return 'Multiple';
 return answer||'Skipped';
}
export default function DemoComparison({score,peers}:{score:Evaluation;peers:DemoPeer[]}){
 const [filter,setFilter]=useState<Filter>('all');
 const rows=score.rows.map(row=>{
  const mine=statusOf(row.response,row.key,row.status);
  const peerStatus=peers.map(p=>statusOf(p.answers[row.question-1],row.key,p.statuses[row.question-1]));
  const correct=peerStatus.filter(v=>v==='correct').length;
  const wrong=peerStatus.filter(v=>v==='wrong').length;
  const skipped=peerStatus.filter(v=>v==='skipped').length;
  return {...row,mine,correct,wrong,skipped};
 });
 const shown=rows.filter(r=>filter==='all'||r.mine===filter);
 const avg=peers.length?peers.reduce((total,p)=>total+p.score,0)/peers.length:0;
 const rank=1+peers.filter(p=>p.score>score.total).length;
 return <section className="demoReport" id="demo-comparison-report" aria-label="Your question comparison">
  <div className="demoReportHero">
   <div><span className="miniEyebrow">YOUR SCAN · SAVED COMPARISON</span>
    <h2>Your results, question by question</h2>
    <p>Every percentage uses responses saved for this same test in Neon. Seeded sample answers are included during testing.</p>
   </div>
   <div className="demoRank"><span>Your position</span><strong>#{rank} <small>/ {peers.length+1}</small></strong></div>
  </div>
  <div className="demoReportStats">
   <div><span>Your score</span><strong>{score.total.toFixed(2)}</strong><small>out of {score.max.toFixed(0)}</small></div>
   <div><span>Others' average</span><strong>{avg.toFixed(2)}</strong><small>{peers.length} other submissions</small></div>
   <div><span>Correct</span><strong>{score.correct}</strong><small>Your answers</small></div>
   <div><span>Wrong / skipped</span><strong>{score.incorrect+score.multiple} / {score.blank}</strong><small>Your answers</small></div>
  </div>
  <div className="demoReportSection">
   <div className="demoReportSectionHeading"><div>
    <h3>Compare every answer</h3><p>Correct, wrong and skipped percentages — no difficulty ratings.</p></div>
   </div>
   <div className="demoReportFilters">
    {([['all','All questions'],['wrong','I got wrong'],['correct','I got right'],['skipped','I skipped']] as const)
     .map(([id,name])=><button key={id} type="button" aria-pressed={filter===id}
      className={'demoFilter'+(filter===id?' selected':'')} onClick={()=>setFilter(id)}>{name}</button>)}
   </div>
   <p className="demoVisibleCount">{shown.length} of {score.rows.length} questions · {peers.length} comparison submissions</p>
   <div className="demoQuestionCards">
    {shown.map(row=>{
     const total=peers.length;
     const percent=(count:number)=>total?Math.round(count/total*100):0;
     return <article className="demoQuestionCard" key={row.question}>
      <div className="demoQuestionCardHead">
       <strong>Question {row.question}</strong>
       <span className={'demoResultPill '+(row.mine==='correct'?'right':row.mine==='cancelled'?'':'wrong')}>
        {row.mine==='correct'?'You got it right':row.mine==='wrong'?'You got it wrong':row.mine==='skipped'?'You skipped':'Cancelled'}</span>
      </div>
      <p className="demoAnswerLine">Your answer: <b>{label(row.response,row.status)}</b><span>Correct answer: <b>{row.key==='X'?'Cancelled':row.key}</b></span></p>
      <div className="demoQuestionStats" aria-label={total+' other students: '+percent(row.correct)+' percent correct, '+percent(row.wrong)+' percent wrong, '+percent(row.skipped)+' percent skipped'}>
       <div className="demoPercentTrack">
        <span style={{width:percent(row.correct)+'%',background:'#16a34a'}}/>
        <span style={{width:percent(row.wrong)+'%',background:'#ef4444'}}/>
        <span style={{width:percent(row.skipped)+'%',background:'#94a3b8'}}/>
       </div>
       <div className="demoPercentLegend">
        <span><i style={{background:'#16a34a'}}/>{percent(row.correct)}% correct</span>
        <span><i style={{background:'#ef4444'}}/>{percent(row.wrong)}% wrong</span>
        <span><i style={{background:'#94a3b8'}}/>{percent(row.skipped)}% skipped</span>
       </div>
       <small>Based on {total} other saved submissions</small>
      </div>
     </article>;
    })}
   </div>
   {!shown.length&&<p className="notice">No questions match this filter.</p>}
   <p className="demoReportDisclaimer">Development environment: seeded sample submissions and genuine preview scans are mixed in these comparisons. No OMR photo or personal name is saved by this demo flow.</p>
  </div>
 </section>;
}
