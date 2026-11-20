import Link from "next/link";
import { notFound } from "next/navigation";
import { getDemoTenant } from "../../../../lib/tenants";

export default async function ScanWorkspace({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = getDemoTenant(slug);
  if (!tenant) notFound();
  return (
    <div className="shell interior">
      <div className="crumbs"><Link href={`/s/${slug}`}>{tenant.name}</Link><span>/</span><span>Scanning</span></div>
      <div className="eyebrow">ENGINE MIGRATION · PHASE 1</div>
      <h1>Scan with confidence.</h1>
      <p className="lead">We are extracting the existing v2.3 browser scanner into a versioned library. No new scanner is claimed to be working here yet.</p>
      <div className="scan-panel">
        <div className="scan-graphic" aria-hidden="true">▦</div>
        <h2>Scanner integration in progress</h2>
        <p>The 50-question SFG engine remains available on the current public site. This Next.js workspace will connect to the same engine after parity tests pass.</p>
        <a className="button button-primary" href="https://aalsiyodha.github.io/sfg-omr-lab/#/scan" target="_blank" rel="noopener noreferrer">Open current v2.3 scanner ↗</a>
      </div>
      <div className="callout-neutral">Protected migration boundary: no simulated OMR scores, no fabricated rankings, no student data storage.</div>
    </div>
  );
}
