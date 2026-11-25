'use client';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/browser';
export default function GoogleButton(){
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const run=async()=>{setBusy(true);setError('');
   const supabase=supabaseBrowser();
   const {error}=await supabase.auth.signInWithOAuth({
     provider:'google',options:{redirectTo:window.location.origin+'/auth/callback'}
   });
   if(error){setError(error.message);setBusy(false);}
 };
 return <div><button className="button primary block" onClick={run} disabled={busy}>
  {busy?'Connecting…':'Continue with Google'} <span>↗</span></button>
  {error&&<p className="alert">{error}</p>}</div>;
}
