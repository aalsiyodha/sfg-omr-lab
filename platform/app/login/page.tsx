import Link from 'next/link';
import {isConfigured} from '@/lib/env';
import GoogleButton from '@/components/GoogleButton';
import DemoAccess from '@/components/DemoAccess';
export default function Login(){
 return <div className="newAuthShell">
  <div className="newAuthIntro"><span className="miniEyebrow">OMRLABS · INSTITUTE PLATFORM</span>
   <h1>Welcome to a clearer way to assess.</h1>
   <p>One workspace for OMR evaluation, answer keys, results, leaderboards, and online practice.</p>
   <div className="newAuthHighlights"><span>● Neon PostgreSQL</span><span>● 50-question OMR scanner</span><span>● Review-assisted scoring</span></div>
  </div>
  <div className="newAuthPanel">
    <span className="miniEyebrow">ACCOUNT ACCESS</span>
    <h2>Sign in to OMRLabs</h2>
    <p className="muted small">Use your Google account to manage an institute and save real reviewed submissions.</p>
    {isConfigured()?<GoogleButton/>:<p className="alert">Google sign-in is not configured for this deployment.</p>}
    <div className="previewAuthDivider"><span>or try the sample workspace</span></div>
    <DemoAccess/>
    <p className="newAuthFooter"><Link href="/practice">Try online MCQ practice</Link> · <Link href="/">Return home</Link></p>
  </div>
 </div>;
}
