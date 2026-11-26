import Link from 'next/link';
import {isConfigured} from '@/lib/env';
import GoogleButton from '@/components/GoogleButton';
import DemoAccess from '@/components/DemoAccess';
export default function Login(){
 return <div className="pilotLogin">
  <div className="pilotBreadcrumb"><Link href="/">HOME</Link> <span>›</span> CHOOSE YOUR WORKSPACE</div>
  <div className="pilotLoginHead"><span className="miniEyebrow">WELCOME TO OMRLABS</span>
    <h1>How would you like to start?</h1>
    <p>Just exploring? Use the demo. Managing real tests? Sign in with Google.</p></div>
  <div className="pilotLoginGrid">
    <section className="pilotLoginCard pilotLoginDemo">
      <div className="pilotLoginCardTop"><span className="pilotCardIcon">▥</span><span className="pilotPreviewPill">Recommended for testing</span></div>
      <h2>Explore the demo</h2>
      <p>Scan your OMR first, then see your rank and compare each answer with four fictional students. No real institute data.</p>
      <DemoAccess/>
    </section>
    <section className="pilotLoginCard">
      <div className="pilotLoginCardTop"><span className="pilotCardIcon">◈</span><span className="pilotSmallTag">Real institute workspace</span></div>
      <h2>Manage your institute</h2>
      <p>Use Google to create an institute, publish answer keys and save reviewed results securely to Neon.</p>
      {isConfigured()?<GoogleButton/>:<div className="alert">Google account access is not configured for this preview.</div>}
      <div className="pilotGoogleFoot"><strong>What you'll get</strong>
       <span>Private institute dashboard</span><span>Published test and answer-key management</span><span>Student records and reporting</span>
      </div>
      <p className="pilotLoginHint">For actual institute records. Not required to compare with the four demo students.</p>
    </section>
  </div>
  <div className="pilotLoginBottom">Want to see the app first? <Link href="/sample">Scan and compare without signing in ↗</Link></div>
 </div>;
}