import Link from 'next/link';
import {isConfigured} from '@/lib/env';
import GoogleButton from '@/components/GoogleButton';
export default function Login(){
 return <div className="authCard">
  <span className="miniEyebrow">NEON AUTH · SECURE ACCESS</span><h1>Welcome to OMRLabs.</h1>
  <p>Sign in with Google to create or manage your institute.</p>
  {isConfigured()?<GoogleButton/>:<div className="alert">Neon Auth isn't configured for this deployment yet.</div>}
  <Link href="/demo" className="button secondary block">Explore the local demo</Link>
  <small className="muted">The demo is browser-local and does not create an institute account.</small>
 </div>;
}
