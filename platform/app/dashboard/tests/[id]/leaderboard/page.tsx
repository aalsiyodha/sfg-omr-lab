import Link from 'next/link';
import {notFound,redirect} from 'next/navigation';
import {requireUser} from '@/lib/auth';
import {isConfigured} from '@/lib/env';
type Row={candidate_code:string;display_name:string;rank:number;total_score:number;
 correct_count:number;incorrect_count:number;blank_count:number;multiple_count:number};
export default async function Leaderboard({params}:{params:Promise<{id:string}>}){
 if(!isConfigured())redirect('/demo');
 const {db}=await requireUser();
 const {id}=await params;
 if(!/^[0-9a-f-]{36}$/i.test(id))notFound();
 const {data:test}=await db.from('tests').select('id,title,institute_id').eq('id',id).single();
 if(!test)notFound();
 const {data, error}=await db.from('institute_leaderboard')
  .select('candidate_code,display_name,rank,total_score,correct_count,incorrect_count,blank_count,multiple_count')
  .eq('test_id',id).eq('institute_id',test.institute_id)
  .order('rank',{ascending:true}).order('candidate_code',{ascending:true}).limit(500);
 const rows=(data||[]) as Row[];
 return <div className="dashboard">
 <Link href={'/dashboard/tests/'+id} className="backLink">← Back to answer key</Link>
 <div className="dashTop"><div><span className="miniEyebrow">RESULTS AND COMPARISONS</span>
  <h1>{test.title}</h1><p>Best verified result per candidate. Tied scores share a rank.</p></div></div>
 <div className="statGrid">
  <div className="stat"><span>Candidates</span><strong>{rows.length}</strong></div>
  <div className="stat"><span>Average score</span><strong>{rows.length?(rows.reduce((sum,r)=>sum+Number(r.total_score),0)/rows.length).toFixed(1):'—'}</strong></div>
  <div className="stat"><span>Highest score</span><strong>{rows.length?Number(rows[0].total_score).toFixed(1):'—'}</strong></div>
 </div>
 <section className="surface">
  <div className="sectionHeading"><div><span className="miniEyebrow">INSTITUTE ONLY</span><h2>Leaderboard</h2></div></div>
  {error&&<p className="alert">Unable to load rankings. Verify that the results SQL migration has been applied.</p>}
  {!rows.length?<div className="empty"><h3>No scored attempts yet</h3><p>Verified, reviewed student scans will appear here after the scanner-to-platform integration is enabled.</p></div>:
   <div className="tableScroll"><table className="scoreTable"><thead><tr><th>Rank</th><th>Candidate</th><th>Score</th><th>Correct</th><th>Wrong</th><th>Blank</th><th>Multiple</th></tr></thead>
    <tbody>{rows.map(r=><tr key={r.candidate_code}><td>#{r.rank}</td><td><strong>{r.display_name}</strong><small>{r.candidate_code}</small></td><td><strong>{Number(r.total_score).toFixed(2)}</strong></td><td>{r.correct_count}</td><td>{r.incorrect_count}</td><td>{r.blank_count}</td><td>{r.multiple_count}</td></tr>)}</tbody></table></div>}
 </section>
 </div>;
}
