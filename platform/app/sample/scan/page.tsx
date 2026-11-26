import Link from 'next/link';
import OmrEvaluation from '@/components/OmrEvaluation';
import {sql} from '@/lib/neon';
import type {Choice} from '@/lib/key';
import type {DemoPeer} from '@/components/DemoComparison';
export const dynamic='force-dynamic';
const demoTest='9e0d0e02-6d3b-4bbd-9b11-222222222222';
export default async function ScanSample(){
 let key:Choice[]=[];
 let peers:DemoPeer[]=[];
 try{const r=await sql()`SELECT answer_key FROM tests WHERE id=${demoTest}::uuid AND created_by='demo-seed' AND status='published' LIMIT 1`;
  if(Array.isArray(r[0]?.answer_key))key=r[0].answer_key as Choice[];
  const scores=await sql()`SELECT c.display_name,c.candidate_code,s.score,s.answers,s.answer_statuses
   FROM scan_submissions s JOIN candidates c ON c.id=s.candidate_id AND c.institute_id=s.institute_id
   WHERE s.test_id=${demoTest}::uuid AND s.scanner_version='synthetic-seed-v1'
   ORDER BY s.score DESC`;
  peers=scores.filter(row=>Array.isArray(row.answers)&&Array.isArray(row.answer_statuses)
    &&row.answers.length===50&&row.answer_statuses.length===50)
   .map(row=>({name:String(row.display_name),code:String(row.candidate_code),score:Number(row.score),
    answers:row.answers as (string|null)[],statuses:row.answer_statuses as string[]}));
 }catch{/* Show an explicit unavailable message */}
 return <div className="dashboard demoScanDashboard"><Link className="backLink" href="/">← Home</Link>
 <div className="pilotBreadcrumb">DEMO WORKSPACE <span>›</span> SCAN & COMPARE</div>
 <div className="dashTop pilotPageHeader"><div><span className="miniEyebrow">START HERE · SCAN FIRST</span>
  <h1>Scan your OMR. Compare every answer.</h1>
  <p>Upload your sheet to see your score, rank, and a question-by-question comparison with four fictional students.</p></div></div>
 <div className="pilotInfoLine"><span>1 · Upload or photograph your OMR</span><span>2 · Automatic scoring</span><span>3 · Compare every question</span></div>
 <div className="notice"><strong>Demo-only rule:</strong> a printed Test ID mismatch is allowed for comparison, but valid QR, sheet alignment and all 50 timing marks are still required. Your score is not saved to Neon.</div>
 {peers.length>0&&<div className="demoComparePrompt"><strong>Four sample students are ready for comparison.</strong><span>We'll show their selected choices beside yours for every question once your scan passes validation.</span></div>}
 {key.length===50?<OmrEvaluation testNumber={27} testTitle="Synthetic Geography Practice" answerKey={key}
  published={true} ignoreTestIdForDemo={true} demoPeers={peers}/>:
  <div className="alert">The synthetic demo answer key was not found in the Neon development database.</div>}
 <p className="demoClassLink">Prefer to browse the fictional class first? <Link href="/sample/class">View class overview ↗</Link></p>
 </div>;

}
