'use client';
import {useState} from 'react';
import {authClient} from '@/lib/auth/client';
export default function GoogleButton(){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const run=async()=>{setBusy(true);setError('');
  try{const response=await authClient.signIn.social({provider:'google',callbackURL:'/dashboard'});
   if(response.error){setError(response.error.message||'Could not sign in.');setBusy(false);}
  }catch(e){setError(e instanceof Error?e.message:'Google login failed.');setBusy(false);}
 };
 return <div><button className="button primary block" onClick={run} disabled={busy}>
  {busy?'Connecting…':'Continue with Google'} <span>↗</span></button>
  {error&&<p className="alert" role="alert">{error}</p>}</div>;
}
