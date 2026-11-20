import Link from "next/link";
import { notFound } from "next/navigation";
import { getDemoTenant } from "../../../lib/tenants";

export default async function TenantHome({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = getDemoTenant(slug);
  if (!tenant) notFound();
  return (
    <div className="shell interior">
      <div className="crumbs"><Link href="/dashboard">Institutes</Link><span>/</span><span>{tenant.name}</span></div>
      <div className="tenant-hero"><span className="tenant-avatar large" style={{ background: tenant.accent }}>{tenant.initials}</span><div><div className="eyebrow">INSTITUTE PORTAL · DEMO</div><h1>{tenant.name}</h1><p>{tenant.description}</p></div></div>
      <div className="action-grid">
        <article className="action-card"><span className="action-icon">▦</span><h2>OMR scanning</h2><p>Our existing v2.3 scanner is the validated baseline. The Next.js scanner integration is the next milestone.</p><Link className="button button-primary" href={`/s/${slug}/scan`}>Open scanner workspace ↗</Link></article>
        <article className="action-card"><span className="action-icon">◫</span><h2>Test operations</h2><p>Create tests, manage answer keys, control review and release results in a future phase.</p><span className="status-line">Planned · Database not connected</span></article>
        <article className="action-card"><span className="action-icon">↗</span><h2>Results & insights</h2><p>Compare performance across students, batches and exams after final results are approved.</p><span className="status-line">Planned · No rankings generated</span></article>
      </div>
      <div className="callout-neutral">Available sheet formats in this demo: <strong>{tenant.allowedFormats.map(n => `${n} questions`).join(", ")}</strong>. Only the original SFG 50-question sheet currently has a validated scanner implementation.</div>
    </div>
  );
}
