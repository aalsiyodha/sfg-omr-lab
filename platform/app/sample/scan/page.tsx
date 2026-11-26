import Link from 'next/link';
import OmrEvaluation from '@/components/OmrEvaluation';
import {sql} from '@/lib/neon';
import type {Choice} from '@/lib/key';
export const dynamic='force-dynamic';
const demoTest='9e0d0e02-6d3b-4bbd-9b11-222222222222';
export default async function ScanSample(){
 let key:Choice[]=[];
 let peers:{name:string;score:number}[]=[];
 try{const r=await sql()`SELECT answer_key FROM tests WHERE id=${demoTest}::uuid AND created_by='demo-seed' AND status='published' LIMIT 1`;
  if(Array.isArray(r[0]?.answer_key))key=r[0].answer_key as Choice[];
  const scores=await sql()`SELECT c.display_name,s.score FROM scan_submissions s JOIN candidates c ON c.id=s.candidate_id WHERE s.test_id=${demoTest}::uuid AND s.scanner_version='synthetic-seed-v1' ORDER BY s.score DESC`;
  peers=scores.map(row=>({name:String(row.display_name),score:Number(row.score)}));
 }catch{/* Show an explicit unavailable message */}
 return <div className="dashboard"><Link className="backLink" href="/sample">← Back to sample analytics</Link>
 <div className="pilotBreadcrumb">DEMO WORKSPACE <span>›</span> SCAN & COMPARE</div>
 <div className="dashTop pilotPageHeader"><div><span className="miniEyebrow">STEP 2 OF 2 · PRACTICE EVALUATION</span>
  <h1>Scan an OMR. See where you stand.</h1>
  <p>Take a photo or upload a sheet, calculate the score, and compare it against four fictional students using the same sample key.</p></div></div>
 <div className="pilotInfoLine"><span>✓ No account needed</span><span>✓ 50-question sample key</span><span>✓ Results remain in your browser</span></div>
 <div className="notice"><strong>Demo-only rule:</strong> a printed Test ID mismatch is allowed for comparison, but valid QR, sheet alignment and all 50 timing marks are still required. Your score is not saved to Neon.</div>
 {key.length===50?<OmrEvaluation testNumber={27} testTitle="Synthetic Geography Practice" answerKey={key}
  published={true} ignoreTestIdForDemo={true} demoPeers={peers}/>:
  <div className="alert">The synthetic demo answer key was not found in the Neon development database.</div>}
 </div>;

}
