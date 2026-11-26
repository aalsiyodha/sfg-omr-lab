import Link from 'next/link';
import OmrEvaluation from '@/components/OmrEvaluation';
import {sql} from '@/lib/neon';
import type {Choice} from '@/lib/key';
export const dynamic='force-dynamic';
const demoTest='9e0d0e02-6d3b-4bbd-9b11-222222222222';
export default async function ScanSample(){
 let key:Choice[]=[];
 try{const r=await sql()`SELECT answer_key FROM tests WHERE id=${demoTest}::uuid AND created_by='demo-seed' AND status='published' LIMIT 1`;
  if(Array.isArray(r[0]?.answer_key))key=r[0].answer_key as Choice[];
 }catch{/* Show an explicit unavailable message */}
 return <div className="dashboard"><Link className="backLink" href="/sample">← Back to sample analytics</Link>
 <div className="dashTop"><div><span className="miniEyebrow">EXPERIMENTAL SCANNER TEST</span>
  <h1>Evaluate your own OMR photograph</h1>
  <p>Uses a synthetic answer key from Neon. The photograph is scanned locally in your browser.</p></div></div>
 <div className="notice"><strong>Demo safety:</strong> the selected Test ID is ignored for local scoring only; the actual Test ID is still displayed. QR validity, geometry and all 50 timing marks remain required. Scores are not added to the seeded leaderboard or saved in Neon.</div>
 {key.length===50?<OmrEvaluation testNumber={27} testTitle="Synthetic Geography Practice" answerKey={key}
  published={true} ignoreTestIdForDemo={true}/>:
  <div className="alert">The synthetic demo answer key was not found in the Neon development database.</div>}
 </div>;
