import Link from 'next/link';
export default function Home(){return <div className="home">
  <div className="eyebrow"><span className="liveDot"/> INSTITUTE MANAGEMENT · EARLY PREVIEW</div>
  <h1>Every test.<br/><em>One clear workspace.</em></h1>
  <p className="lead">Prepare answer keys, manage exams and review OMR results in an institute-specific workspace. The trusted browser scanner stays separate from your administrative data.</p>
  <div className="buttons"><Link className="button primary" href="/demo">Explore the interactive demo <span>↗</span></Link>
    <Link className="button secondary" href="/login">Continue with Google</Link></div>
  <div className="heroPanel"><div className="heroPanelTop"><div><span className="miniEyebrow">YOUR WORKSPACE</span><h2>Everything in one place</h2></div><span className="status">● Preview</span></div>
    <div className="heroStats"><div><span>Tests</span><strong>12</strong></div><div><span>Published keys</span><strong>09</strong></div><div><span>Ready for review</span><strong>03</strong></div></div>
    <div className="heroRows"><span>TEST 27 <strong>Geography practice</strong></span><span className="status">Published</span></div>
    <div className="heroRows"><span>TEST 28 <strong>History practice</strong></span><span className="pill">Draft</span></div>
  </div>
  <div className="features"><article><span>01</span><h3>Institute accounts</h3><p>Google sign-in and role-based institute membership.</p></article><article><span>02</span><h3>Answer-key workflow</h3><p>Enter manually or import CSV. Verify every answer before publishing.</p></article><article><span>03</span><h3>Privacy first</h3><p>Membership-based database policies keep institute data separated.</p></article></div>
  <div className="notice">This is the institute-platform prototype, not a replacement for the <a href="https://aalsiyodha.github.io/sfg-omr-lab/#/scan">production v2.7.1 scanner</a>. The scanner remains available separately while integration is developed.</div>
  </div>}
