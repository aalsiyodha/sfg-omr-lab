import Link from 'next/link';
export default function Home(){
 return <div className="pilotHome">
 <div className="pilotHero">
  <div className="pilotHeroContent">
   <span className="pilotEyebrow"><span className="pilotStatusDot"/> OMRLABS · ASSESSMENT PLATFORM</span>
   <h1>From answer sheets<br/>to <em>clear insights.</em></h1>
   <p>Scan OMR sheets, evaluate responses, and understand performance in one simple workspace. Try the complete sample experience with fictional student data.</p>
   <div className="pilotHeroActions">
     <Link className="button primary" href="/sample">Explore demo workspace <span>↗</span></Link>
     <Link className="button secondary" href="/login">Sign in with Google</Link>
   </div>
   <div className="pilotHeroMeta"><span>✓ Browser-local OMR scanning</span><span>✓ Neon-powered analytics</span><span>✓ No card or account needed for demo</span></div>
  </div>
  <div className="pilotHeroPreview" aria-label="Illustration of the sample leaderboard">
   <div className="pilotPreviewTop"><div><span className="pilotPreviewDot"/> OMRLabs / Demo workspace</div><span className="pilotPreviewPill">Sample data</span></div>
   <div className="pilotPreviewTitle"><span>Class performance</span><strong>Geography · Test 27</strong></div>
   <div className="pilotPreviewKpis"><div><span>Students</span><strong>04</strong></div><div><span>Average score</span><strong>55.42</strong></div></div>
   <div className="pilotPreviewRanks">
    {[['AS','Aditi Sharma',77.38],['RV','Rohan Verma',62.74],['PS','Priya Singh',48.10],['AM','Arjun Mehta',33.46]].map(([initials,name,score],i)=>
     <div key={String(name)} className="pilotPreviewRank"><span>{i+1}</span><b>{initials}</b><div><strong>{name}</strong><small>Demo student</small></div><em>{Number(score).toFixed(2)}</em></div>)}
   </div>
   <div className="pilotPreviewBottom"><span>✓ Live sample dataset</span><span>Compare your own scan ↗</span></div>
  </div>
 </div>
 <section className="pilotFeatureIntro"><div><span className="miniEyebrow">A WORKFLOW THAT MAKES SENSE</span>
  <h2>Everything you need, nothing you don't.</h2></div><p>Two clear ways to use OMRLabs: explore the demo or manage a real institute account.</p></section>
 <div className="pilotFeatureGrid">
  <Link href="/sample/scan" className="pilotFeature"><span className="pilotFeatureIcon">▦</span><h3>Scan & compare</h3><p>Upload an OMR image, apply strict automatic marking, and compare your score with the sample class.</p><strong>Try scanner ↗</strong></Link>
  <Link href="/sample" className="pilotFeature"><span className="pilotFeatureIcon">▥</span><h3>Class analytics</h3><p>View the sample leaderboard, score distributions, and every question's response pattern.</p><strong>View analytics ↗</strong></Link>
  <Link href="/practice" className="pilotFeature"><span className="pilotFeatureIcon">◉</span><h3>Online practice</h3><p>Try a short MCQ paper with negative marking and explanations. A prototype of our online test series.</p><strong>Start practicing ↗</strong></Link>
 </div>
 <div className="pilotHomeFoot">This is a testing environment with fictional students and an experimental scanner. Real institute data requires Google sign-in; scanned demo results stay in your browser.</div>
 </div>;
}