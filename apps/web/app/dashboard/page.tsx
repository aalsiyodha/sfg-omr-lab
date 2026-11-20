import Link from "next/link";
import { DEMO_TENANTS } from "../../lib/tenants";

export default function Dashboard() {
  return (
    <div className="shell interior">
      <div className="eyebrow">INSTITUTE WORKSPACE · UI PROTOTYPE</div>
      <div className="page-title-row"><div><h1>Run exams with clarity.</h1><p>Select a demo institute to preview its isolated workspace. Authentication and the database are not connected yet.</p></div><span className="preview-tag">Demo mode</span></div>
      <div className="metric-grid">
        <div className="metric"><span>Scheduled tests</span><strong>12</strong><small>Illustrative</small></div>
        <div className="metric"><span>Sheets evaluated</span><strong>8,420</strong><small>Illustrative</small></div>
        <div className="metric"><span>Pending reviews</span><strong>34</strong><small>Illustrative</small></div>
        <div className="metric"><span>Active students</span><strong>2,450</strong><small>Illustrative</small></div>
      </div>
      <div className="section-heading compact"><span className="eyebrow">YOUR INSTITUTES</span><h2>Choose a workspace</h2></div>
      <div className="tenant-grid">{Object.values(DEMO_TENANTS).map(t => <Link className="tenant-card" key={t.slug} href={`/s/${t.slug}`}><span className="tenant-avatar" style={{ background: t.accent }}>{t.initials}</span><div><h3>{t.name}</h3><p>{t.description}</p><small>Formats: {t.allowedFormats.join(" / ")} questions</small></div><span className="tenant-arrow">↗</span></Link>)}</div>
      <p className="callout-neutral">Next milestone: connect login, institute memberships and authorization. Demo workspaces are intentionally public and contain no real student data.</p>
    </div>
  );
}
