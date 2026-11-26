import Link from 'next/link';
export default function Home(){return <div className="home">
  <div className="eyebrow"><span className="liveDot"/> OMRLABS · ASSESSMENT PLATFORM</div>
  <h1>Every test.<br/><em>One clear workspace.</em></h1>
  <p className="lead">Prepare answer keys, manage exams and review OMR results in an institute-specific workspace. Try our browser-based scanner, live sample analytics, and online MCQ practice.</p>
  <div className="buttons"><Link className="button primary" href="/sample">Explore Neon analytics <span>↗</span></Link><Link className="button secondary" href="/sample/scan">Try OMR upload</Link>
    <Link className="button secondary" href="/login">Sign in / Demo access</Link></div>
  <div className="heroPanel"><div className="heroPanelTop"><div><span className="miniEyebrow">YOUR WORKSPACE</span><h2>Everything in one place</h2></div><span className="status">● Preview</span></div>
    <div className="heroStats"><div><span>Tests</span><strong>01</strong></div><div><span>Published keys</span><strong>01</strong></div><div><span>Sample students</span><strong>04</strong></div></div>
    <div className="heroRows"><span>TEST 27 <strong>Geography practice</strong></span><span className="status">Published</span></div>
    <div className="heroRows"><span>SAMPLE <strong>Four fictional submissions</strong></span><span className="pill">Demo data</span></div>
  </div>
  <div className="features"><article><span>01</span><h3>Institute accounts</h3><p>Google sign-in and role-based institute membership.</p></article><article><span>02</span><h3>Answer-key workflow</h3><p>Enter manually or import CSV. Verify every answer before publishing.</p></article><article><span>03</span><h3>Privacy first</h3><p>Server-side membership checks keep institute records separated.</p></article></div>
  <div className="notice">Preview environment: synthetic student data and review-assisted grading. Production student accounts and online exams are not yet released.</div>
  </div>}
