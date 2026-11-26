'use client';
import {useState} from 'react';
import type {Evaluation,EvaluatedRow} from '@/lib/evaluation';
import type {Choice} from '@/lib/key';

export type DemoPeer={
  name:string;
  code:string;
  score:number;
  answers:(string|null)[];
  statuses:string[];
};
type Filter='all'|'missed'|'different'|'correct';
const LABELS=['A','B','C','D'] as const;
function responseLabel(response:string|null,status:string){
 if(status==='multiple'||response==='MULTIPLE')return 'Multiple';
 if(response===null||response==='X'||response==='')return 'Blank';
 return response;
}
function peerCorrect(peer:DemoPeer,index:number,key:Choice){
 if(key==='X')return null;
 const value=peer.answers[index],status=peer.statuses[index];
 return status!=='multiple'&&value===key;
}
function yours(row:EvaluatedRow){
 if(row.key==='X')return 'Cancelled';
 if(row.response==='MULTIPLE')return 'Multiple';
 if(row.response===null)return 'Blank';
 return row.correct?'Correct':'Incorrect';
}
export default function DemoComparison({score,peers}:{score:Evaluation;peers:DemoPeer[]}){
 const [filter,setFilter]=useState<Filter>('all');
 const [showPeers,setShowPeers]=useState(true);
 const comparison=score.rows.map((row,index)=>{
  const peersCorrect=peers.filter(peer=>peerCorrect(peer,index,row.key)===true).length;
  const youCorrect=row.key!=='X'&&row.correct;
  const peersDiffer=peers.some(peer=>peer.answers[index]!==row.response||
    peer.statuses[index]==='multiple');
  return {...row,peersCorrect,youCorrect,peersDiffer};
 });
 const missed=comparison.filter(row=>row.key!=='X'&&!row.youCorrect).length;
 const betterThanPeers=comparison.filter(row=>row.youCorrect&&row.peersCorrect<peers.length).length;
 const missedEasy=comparison.filter(row=>!row.youCorrect&&row.key!=='X'&&row.peersCorrect>=Math.ceil(peers.length*.75)).length;
 const avg=peers.length?peers.reduce((sum,p)=>sum+p.score,0)/peers.length:0;
 const rank=1+peers.filter(p=>p.score>score.total).length;
 const sorted=[...peers.map(p=>({name:p.name,score:p.score,you:false})),{name:'You (uploaded OMR)',score:score.total,you:true}]
  .sort((a,b)=>b.score-a.score||Number(b.you)-Number(a.you));
 const shown=comparison.filter(row=>{
  if(filter==='missed')return row.key!=='X'&&!row.youCorrect;
  if(filter==='different')return row.peersDiffer;
  if(filter==='correct')return row.youCorrect;
  return true;
 });
 return <section className="demoReport" id="demo-comparison-report" aria-label="Your OMR comparison report">
  <div className="demoReportHero">
   <div><span className="miniEyebrow">YOUR SCAN · COMPARISON REPORT</span>
    <h2>How did you do against the class?</h2>
    <p>50-question synthetic practice test · four fictional student submissions</p></div>
   <div className="demoRank"><span>Your position</span><strong>#{rank} <small>/ {peers.length+1}</small></strong></div>
  </div>
  <div className="demoReportStats">
   <div><span>Your marks</span><strong>{score.total.toFixed(2)}</strong><small>of {score.max.toFixed(0)}</small></div>
   <div><span>Class average</span><strong>{avg.toFixed(2)}</strong><small>{(score.total-avg)>=0?'+':''}{(score.total-avg).toFixed(2)} vs average</small></div>
   <div><span>Questions missed</span><strong>{missed}</strong><small>Wrong, multiple or blank</small></div>
   <div><span>Correct when peers missed</span><strong>{betterThanPeers}</strong><small>Your relative strengths</small></div>
  </div>
  <div className="demoReportSection">
   <div className="demoReportSectionHeading"><div><h3>Overall leaderboard</h3><p>Your mark is highlighted among the sample students.</p></div></div>
   <div className="demoPeerBars">{sorted.map((p,i)=><div key={p.name} className={'demoPeerBar'+(p.you?' you':'')}>
     <b>{i+1}</b><span>{p.name}</span>
     <div className="sampleTrack"><span style={{width:Math.max(0,Math.min(100,p.score))+'%'}}/></div>
     <strong>{p.score.toFixed(2)}</strong></div>)}</div>
  </div>
  <div className="demoReportSection">
   <div className="demoReportSectionHeading"><div>
    <h3>Question-by-question comparison</h3>
    <p>For each question: your marked answer, the key, how many classmates got it right, and the choices they marked.</p></div>
    <div className="demoPeerStat"><strong>{missedEasy}</strong><span>questions you missed that at least 75% of peers solved</span></div>
   </div>
   <div className="demoReportFilters">
    {([['all','All 50'],['missed','My missed questions'],['correct','My correct answers'],['different','Different peer choices']] as const)
     .map(([id,label])=><button type="button" key={id} aria-pressed={filter===id}
      className={'demoFilter'+(filter===id?' selected':'')} onClick={()=>setFilter(id)}>{label}</button>)}
    <label className="demoPeerToggle"><input type="checkbox" checked={showPeers} onChange={e=>setShowPeers(e.target.checked)}/> Show each student</label>
   </div>
   <p className="demoVisibleCount">{shown.length} of 50 questions shown · <span className="demoLegendRight">✓ correct</span> · <span className="demoLegendWrong">× wrong or blank</span></p>
   <div className="demoQuestionScroll"><table className="demoCompareTable">
    <thead><tr><th>Question</th><th>Key</th><th>Your answer</th><th>Your result</th><th>Peers correct</th>
     {showPeers&&peers.map(peer=><th key={peer.code} title={peer.name}>{peer.name.split(' ')[0]}</th>)}
    </tr></thead>
    <tbody>{shown.map(row=><tr key={row.question} className={row.youCorrect?'rowRight':row.key==='X'?'rowCancelled':'rowMissed'}>
     <td><strong>Q{String(row.question).padStart(2,'0')}</strong></td>
     <td><strong>{row.key}</strong></td>
     <td>{responseLabel(row.response,row.status)}</td>
     <td><span className={'demoResultPill '+(row.youCorrect?'right':'wrong')}>{yours(row)}</span></td>
     <td><div className="demoPeerCorrect"><strong>{row.peersCorrect}/{peers.length}</strong>
      <span className="sampleTrack"><span style={{width:(peers.length?100*row.peersCorrect/peers.length:0)+'%'}}/></span></div></td>
     {showPeers&&peers.map(peer=>{
       const ok=peerCorrect(peer,row.question-1,row.key);
       return <td key={peer.code}><span className={'demoPeerResponse '+(ok?'right':'wrong')}
        title={peer.name+': '+responseLabel(peer.answers[row.question-1],peer.statuses[row.question-1])}>
        {responseLabel(peer.answers[row.question-1],peer.statuses[row.question-1])} {ok===null?'—':ok?'✓':'×'}</span></td>;
     })}
    </tr>)}</tbody>
   </table></div>
   {!shown.length&&<p className="notice">No questions match this filter.</p>}
   <p className="demoReportDisclaimer">These are simulated student responses stored in the Neon development database. Your scanned image and calculated report remain in your browser and are not added to the sample leaderboard.</p>
  </div>
 </section>;
}
