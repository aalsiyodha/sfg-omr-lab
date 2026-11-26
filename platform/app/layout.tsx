import type {Metadata} from 'next';
import Link from 'next/link';
import './globals.css';
export const metadata:Metadata={title:'OMRLabs — Scan. Score. Understand.',description:'A simple institute platform for OMR scanning, student comparison and results analytics.'};
export default function RootLayout({children}:{children:React.ReactNode}){
 return <html lang="en"><body><div className="site">
  <header className="nav pilotNav">
   <Link href="/" className="brand"><span className="mark">▦</span> omr<span>labs</span><small>ASSESSMENTS</small></Link>
   <nav className="links" aria-label="Main navigation">
    <Link href="/sample">Try demo</Link>
    <Link href="/sample/class">Sample class</Link>
    <Link href="/practice">Online practice</Link>
    <Link href="/login" className="navButton">Sign in</Link>
   </nav>
  </header>
  <main>{children}</main>
  <footer className="footer">OMRLabs · Development preview <span>Simple. Accurate. Transparent. · Synthetic demo results are not real student records.</span></footer>
 </div></body></html>;
}