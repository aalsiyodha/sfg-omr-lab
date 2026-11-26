import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
export const metadata:Metadata={title:'OMRLabs — Institute & Assessment Platform',description:'Manage tests, answer keys, and OMR scanning for institutes.'};
export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="en"><body><div className="site">
    <header className="nav"><Link href="/" className="brand"><span className="mark">▦</span> omr<span>labs</span><small>INSTITUTES</small></Link>
      <nav className="links"><Link href="/sample">Sample analytics</Link><Link href="/sample/scan">OMR test</Link><Link href="/practice">Online practice</Link><Link href="/dashboard">Dashboard</Link><Link href="/login" className="navButton">Sign in</Link></nav>
    </header><main>{children}</main><footer className="footer">OMRLabs · Neon development preview <span>Built for responsible, review-assisted OMR workflows.</span></footer>
  </div></body></html>;
}
