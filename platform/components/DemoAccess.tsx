'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
/** Guided demo entry only. This is NOT Neon authentication and creates no session. */
export default function DemoAccess(){
 const router=useRouter();
 const [username,setUsername]=useState('');
 const [password,setPassword]=useState('');
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const submit=(event:React.FormEvent<HTMLFormElement>)=>{
  event.preventDefault();setError('');
  if(username.trim()==='push'&&password==='12345678a'){setBusy(true);router.push('/sample');}
  else setError('Check your demo username and password.');
 };
 return <form className="pilotDemoForm" onSubmit={submit}>
  <label htmlFor="pilot-demo-user">Demo username</label>
  <input id="pilot-demo-user" value={username} onChange={e=>setUsername(e.target.value)} placeholder="push" autoComplete="username" required/>
  <label htmlFor="pilot-demo-pass">Demo password</label>
  <input id="pilot-demo-pass" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="12345678a" autoComplete="off" required/>
  {error&&<div className="alert" role="alert">{error}</div>}
  <button className="button primary block" type="submit" disabled={busy}>{busy?'Opening demo…':'Enter demo workspace'} <span aria-hidden="true">↗</span></button>
  <p className="pilotDemoHelper">Shared testing credentials · push / 12345678a</p>
  <p className="pilotLoginHint">Demo credentials only guide you to public synthetic data; they do not create an account or authorize private database access.</p>
 </form>;
}