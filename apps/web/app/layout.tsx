import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "OMR Labs — Exam Operations, Simplified",
  description: "A modular examination platform for institutes: OMR scanning, test management, scoring and analytics.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="shell nav-shell">
            <Link href="/" className="wordmark" aria-label="OMR Labs home">
              <span className="brand-icon" aria-hidden="true">▦</span>
              <span>OMR<span className="wordmark-emphasis">Labs</span></span>
            </Link>
            <nav className="top-nav" aria-label="Main navigation">
              <Link href="/#platform">Platform</Link>
              <Link href="/#workflow">How it works</Link>
              <Link href="/dashboard">Institute dashboard</Link>
              <Link href="/s/sfg" className="nav-cta">Explore demo <span aria-hidden="true">↗</span></Link>
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          <div className="shell footer-inner">
            <span>© OMR Labs · Migration prototype</span>
            <span>Demo tenants and metrics only · No user accounts or live scans yet</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
