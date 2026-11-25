import Link from 'next/link';
import { isConfigured } from '@/lib/env';
import GoogleButton from '@/components/GoogleButton';
export default async function Login({searchParams}:{searchParams:Promise<{error?:string}>}){
 const p=await searchParams;const ready=isConfigured();
 return <div className="authCard">
  <span className="miniEyebrow">SECURE ACCESS</span><h1>Welcome to OMR Lab.</h1>
  <p>Sign in with Google to create or manage your institute workspace.</p>
  {p.error&&<p className="alert">Sign-in couldn't be completed. Check the OAuth callback configuration.</p>}
  {ready?<GoogleButton/>:<div className="alert">Google sign-in is not activated on this preview. The owner must connect a Supabase project and Google OAuth credentials.</div>}
  <Link href="/demo" className="button secondary block">Explore without signing in</Link>
  <small className="muted">Demo content is stored only in your browser and is not a real institute account.</small>
 </div>
}
