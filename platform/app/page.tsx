import Link from 'next/link';
export default function Home(){
 return <div className="pilotHome">
 <div className="pilotHero">
  <div className="pilotHeroContent">
   <span className="pilotEyebrow"><span className="pilotStatusDot"/> OMRLABS · ASSESSMENT PLATFORM</span>
   <h1>Scan your OMR.<br/><em>See how you compare.</em></h1>
   <p>Upload a photo of your answer sheet, get your score, and compare every answer with other submissions to the same practice test. No account needed to try.</p>
   <div className="pilotHeroActions">
     <Link className="button primary" href="/sample/scan">Scan my OMR <span>↗</span></Link>
     <Link className="button secondary" href="/login">Sign in with Google</Link>
   </div>
   <div className="pilotHeroMeta"><span>✓ Browser-local OMR scanning</span><span>✓ Answers saved to Neon test database</span><span>✓ No card or account needed for demo</span></div>
  </div>
  <div className="pilotHeroPreview" aria-label="Illustrative preview of the test comparison">
   <div className="pilotPreviewTop"><div><span className="pilotPreviewDot"/> OMRLabs / Demo workspace</div><span className="pilotPreviewPill">Sample data</span></div>
   <div className="pilotPreviewTitle"><span>Class performance</span><strong>Geography · Test 27</strong></div>
   <div className="pilotPreviewKpis"><div><span>Students</span><strong>04</strong></div><div><span>Average score</span><strong>55.42</strong></div></div>
   <div className="pilotPreviewRanks">
    {[['AS','Aditi Sharma',77.38],['RV','Rohan Verma',62.74],['PS','Priya Singh',48.10],['AM','Arjun Mehta',33.46]].map(([initials,name,score],i)=>
     <div key={String(name)} className="pilotPreviewRank"><span>{i+1}</span><b>{initials}</b><div><strong>{name}</strong><small>Demo student</small></div><em>{Number(score).toFixed(2)}</em></div>)}
   </div>
   <div className="pilotPreviewBottom"><span>✓ Live sample dataset</span><span>Scan and compare yours ↗</span></div>
  </div>
 </div>
 <section className="pilotFeatureIntro"><div><span className="miniEyebrow">A WORKFLOW THAT MAKES SENSE</span>
  <h2>Everything you need, nothing you don't.</h2></div><p>Start with your own OMR scan. Explore the sample class or institute tools only when you need them.</p></section>
 <div className="pilotFeatureGrid">
  <Link href="/sample/scan" className="pilotFeature"><span className="pilotFeatureIcon">▦</span><h3>Scan & compare</h3><p>Upload an OMR image, apply strict automatic marking, and save your results to Neon and compare each question with other submissions.</p><strong>Try scanner ↗</strong></Link>
  <Link href="/sample" className="pilotFeature"><span className="pilotFeatureIcon">▥</span><h3>Class analytics</h3><p>View the sample leaderboard, score distributions, and every question's response pattern.</p><strong>View analytics ↗</strong></Link>
  <Link href="/practice" className="pilotFeature"><span className="pilotFeatureIcon">◉</span><h3>Online practice</h3><p>Try a short MCQ paper with negative marking and explanations. A prototype of our online test series.</p><strong>Start practicing ↗</strong></Link>
 </div>
 <div className="pilotHomeFoot">Development preview: sample classmates are fictional, and verified guest scans are saved anonymously to Neon. The scanner and comparison experience are still being tested.</div>
 </div>;
}