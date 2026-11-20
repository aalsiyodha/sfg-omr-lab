import Link from "next/link";

const features = [
  { num: "01", name: "Scan with precision", body: "Geometry-aware OMR reading with registration checks, calibration and human review." },
  { num: "02", name: "Run every test", body: "Create examinations, manage answer keys and configure scoring policies." },
  { num: "03", name: "Understand performance", body: "Publish approved results, rankings, and meaningful cohort comparisons." },
];

export default function Home() {
  return (
    <>
      <section className="hero shell">
        <div className="hero-main">
          <div className="eyebrow"><span className="eyebrow-dot" /> MADE FOR EXAMINATION TEAMS</div>
          <h1>Every answer counts.<br /><span>Make every test count.</span></h1>
          <p className="hero-description">A modern examination workspace for institutes. One reliable OMR engine, configurable test formats, and powerful results — without fragmented tools.</p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/dashboard">Explore institute dashboard <span aria-hidden="true">↗</span></Link>
            <Link className="button button-outline" href="/s/sfg">View SFG demo</Link>
          </div>
          <p className="hero-note">Architecture prototype · Existing v2.3 scanner remains available separately.</p>
        </div>
        <div className="hero-visual" aria-label="Preview of the institute dashboard">
          <div className="preview-top"><span className="preview-dots"><i /><i /><i /></span><span>Institute overview</span><span>DEMO</span></div>
          <div className="preview-content">
            <div className="mini-heading">Good morning, examination team <span>↗</span></div>
            <div className="mini-stats">
              <div><small>Active exams</small><strong>12</strong><span className="mini-pill">On track</span></div>
              <div><small>Sheets processed</small><strong>8,420</strong><span className="mini-pill">Demo data</span></div>
            </div>
            <div className="mini-chart">
              <div className="mini-chart-top"><b>Student performance</b><span>Last six tests</span></div>
              <div className="bar-group">{[35, 56, 43, 71, 60, 86, 74, 94, 78].map((height, i) => <span key={i} style={{ height: `${height}%` }} />)}</div>
            </div>
            <div className="mini-bottom"><span className="green-dot" /> Evaluation pipeline ready <span>50 / 100 / 150</span></div>
          </div>
        </div>
      </section>
      <section className="section pale" id="platform">
        <div className="shell">
          <div className="section-heading"><span className="eyebrow">THE PLATFORM</span><h2>One system. Every examination.</h2><p>Purpose-built components work together, while every institute keeps its own workspace and data.</p></div>
          <div className="feature-grid">{features.map(f => <article className="feature-card" key={f.num}><span className="feature-number">{f.num}</span><h3>{f.name}</h3><p>{f.body}</p></article>)}</div>
        </div>
      </section>
      <section className="section shell" id="workflow">
        <div className="split-section">
          <div><span className="eyebrow">DESIGNED TO SCALE</span><h2>From the first sheet to the final rank.</h2><p className="subtext">Start with SFG’s validated 50-question scanner. Extend through versioned 100- and 150-question sheet definitions, institute-level policies and secure multi-tenant data access.</p><Link className="text-link" href="/dashboard">Explore the workspace ↗</Link></div>
          <div className="steps"><div><b>01</b><span>Create an exam and answer key</span></div><div><b>02</b><span>Scan and review OMR sheets</span></div><div><b>03</b><span>Approve marks and publish ranks</span></div></div>
        </div>
      </section>
    </>
  );
}
