import Link from 'next/link';
import {sql} from '@/lib/neon';

export const dynamic='force-dynamic';
const demoInstitute='9e0d0e01-6d3b-4bbd-9b11-111111111111';
const demoTest='9e0d0e02-6d3b-4bbd-9b11-222222222222';

type Leader={display_name:string;candidate_code:string;score:string;correct_count:number;incorrect_count:number;blank_count:number;multiple_count:number};
type Breakdown={question:number;correct_answer:string;total_attempts:number;correct_count:number;option_a:number;option_b:number;option_c:number;option_d:number;blank_count:number;multiple_count:number};
function percent(value:number,total:number){return total?Math.round(value*100/total):0;}
export default async function SampleAnalytics(){
 const q=sql();
 let leaders:Leader[]=[],details:Breakdown[]=[],error='';
 try{
  const a=await q`SELECT c.display_name,c.candidate_code,s.score,s.correct_count,s.incorrect_count,
     s.blank_count,s.multiple_count FROM scan_submissions s
     JOIN candidates c ON c.id=s.candidate_id AND c.institute_id=s.institute_id
     WHERE s.institute_id=${demoInstitute}::uuid AND s.test_id=${demoTest}::uuid
       AND s.scanner_version='synthetic-seed-v1'
     ORDER BY s.score DESC,c.candidate_code`;
  leaders=a as Leader[];
  const b=await q`WITH responses AS(
    SELECT q.n::int AS question,s.answers->>(q.n-1) AS answer,
      s.answer_statuses->>(q.n-1) AS response_status,
      t.answer_key->>(q.n-1) AS correct_answer
    FROM scan_submissions s
    JOIN tests t ON t.id=s.test_id AND t.institute_id=s.institute_id
    CROSS JOIN LATERAL generate_series(1,50) q(n)
    WHERE s.institute_id=${demoInstitute}::uuid AND s.test_id=${demoTest}::uuid
     AND s.scanner_version='synthetic-seed-v1'
    ) SELECT question,correct_answer, count(*)::int AS total_attempts,
      count(*) FILTER(WHERE answer=correct_answer AND response_status<>'multiple')::int AS correct_count,
      count(*) FILTER(WHERE answer='A' AND response_status<>'multiple')::int AS option_a,
      count(*) FILTER(WHERE answer='B' AND response_status<>'multiple')::int AS option_b,
      count(*) FILTER(WHERE answer='C' AND response_status<>'multiple')::int AS option_c,
      count(*) FILTER(WHERE answer='D' AND response_status<>'multiple')::int AS option_d,
      count(*) FILTER(WHERE answer IS NULL AND response_status<>'multiple')::int AS blank_count,
      count(*) FILTER(WHERE response_status='multiple')::int AS multiple_count
      FROM responses GROUP BY question,correct_answer ORDER BY question`;
  details=b as Breakdown[];
 }catch{error='The Neon demo data could not be loaded. Check the development database configuration.';}
 const attempts=leaders.length;
 const avg=attempts?leaders.reduce((sum,v)=>sum+Number(v.score),0)/attempts:0;
 const correct=details.reduce((sum,v)=>sum+v.correct_count,0);
 const total=details.reduce((sum,v)=>sum+v.total_attempts,0);
 const hard=details.filter(v=>percent(v.correct_count,v.total_attempts)<50).length;
 const bars=[['A','option_a'],['B','option_b'],['C','option_c'],['D','option_d'],['Blank','blank_count'],['Multiple','multiple_count']] as const;
 const ranked=[...details].sort((a,b)=>percent(a.correct_count,a.total_attempts)-percent(b.correct_count,b.total_attempts)).slice(0,6);
 return <div className="dashboard sampleDashboard">
  <div className="pilotBreadcrumb"><Link href="/">HOME</Link> <span>›</span> DEMO DASHBOARD</div>
  <div className="dashTop pilotPageHeader"><div><span className="miniEyebrow">OMRLABS / DEMO WORKSPACE</span>
    <h1>Your sample classroom, at a glance.</h1>
    <p>Explore the class results below, then scan your own OMR sheet to see how it compares.</p></div>
    <div className="toolActions"><Link className="button primary" href="/sample/scan">Scan & compare ↗</Link>
    <Link className="button secondary" href="/practice">Try online practice</Link></div>
  </div>
  <div className="pilotDemoNotice"><strong>Demo workspace</strong><span>All 4 students and their responses are fictional, stored in Neon for testing. Your own uploaded scans stay on your device.</span></div>
  <div className="pilotStepGuide"><div><b>01</b><span><strong>View class results</strong><small>Sample scores, rankings and analytics</small></span></div><span className="pilotStepArrow">→</span><div><b>02</b><span><strong>Scan your sheet</strong><small>Get your score and comparison</small></span></div><Link href="/sample/scan" className="button secondary compact">Start scan ↗</Link></div>
  {error&&<p role="alert" className="alert">{error}</p>}
  <div className="sampleStats">
    <div className="sampleMetric"><span>Students</span><strong>{attempts}</strong><small>Demo submissions</small></div>
    <div className="sampleMetric"><span>Average marks</span><strong>{avg.toFixed(2)}</strong><small>Out of 100</small></div>
    <div className="sampleMetric"><span>Overall accuracy</span><strong>{percent(correct,total)}%</strong><small>Across 200 question responses</small></div>
    <div className="sampleMetric"><span>Hard questions</span><strong>{hard}</strong><small>Below 50% accuracy</small></div>
  </div>
  <div className="sampleColumns">
   <section className="surface">
    <div className="sectionHeading"><div><span className="miniEyebrow">RANKINGS</span><h2>Student leaderboard</h2>
      <p>Scores use +2 / −0.66; multiple marked bubbles count as incorrect.</p></div></div>
    <div className="sampleLeaderList">{leaders.map((p,i)=><div key={p.candidate_code} className="sampleLeader">
      <span className="sampleRank">#{i+1}</span>
      <div className="sampleLeaderMain"><strong>{p.display_name}</strong><small>{p.candidate_code} · {p.correct_count} correct · {p.incorrect_count} incorrect</small>
        <div className="sampleTrack"><span style={{width:Math.max(0,Math.min(100,Number(p.score)))+'%'}}/></div></div>
      <strong className="sampleLeaderScore">{Number(p.score).toFixed(2)}</strong>
    </div>)}</div>
   </section>
   <section className="surface"><span className="miniEyebrow">DIFFICULTY</span><h2>Hardest questions</h2>
    <p className="muted small">Based on the sample students who answered each question correctly.</p>
    {ranked.map(q=><div className="sampleDifficulty" key={q.question}>
     <span>Q{String(q.question).padStart(2,'0')}</span>
     <div className="sampleTrack"><span style={{width:percent(q.correct_count,q.total_attempts)+'%'}}/></div>
     <strong>{percent(q.correct_count,q.total_attempts)}%</strong>
    </div>)}
   </section>
  </div>
  <details className="surface pilotQuestionDetails"><summary><span><span className="miniEyebrow">DETAILED ANALYTICS</span><strong>View all 50 question charts</strong><small>Optional deeper dive into responses and difficulty.</small></span><b>Expand ↘</b></summary><div className="pilotQuestionDetailsBody"><div className="sectionHeading"><div>
   <span className="miniEyebrow">QUESTION ANALYTICS</span><h2>Choice distribution — every question</h2>
   <p>The charts below use actual answer arrays stored in Neon, not preset frontend percentages.</p></div>
   <span className="pill">{details.length} questions</span></div>
   <div className="sampleQuestionGrid">{details.map(d=><article key={d.question} className="sampleQuestion">
    <div className="sampleQuestionHead"><strong>Q{String(d.question).padStart(2,'0')}</strong>
      <span>{percent(d.correct_count,d.total_attempts)}% correct</span></div>
    <p className="muted small">Key: <strong>{d.correct_answer}</strong> · {d.total_attempts} attempts</p>
    {bars.map(([name,k])=><div key={name} className="sampleAnswerBar">
      <span>{name}</span><div className="sampleTrack"><span className={name===d.correct_answer?'isRight':''}
       style={{width:percent(d[k],d.total_attempts)+'%'}}/></div>
      <strong>{d[k]}</strong>
    </div>)}
   </article>)}</div>
  </div></details>
 </div>;
}
