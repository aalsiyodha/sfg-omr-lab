'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';

/** Demo only. This form NEVER authenticates to Neon and grants no database access. */
export default function DemoAccess(){
 const router=useRouter();
 const [username,setUsername]=useState('');
 const [password,setPassword]=useState('');
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const signIn=(e:React.FormEvent<HTMLFormElement>)=>{
  e.preventDefault();setError('');
  if(username.trim()==='push'&&password==='12345678a'){
   setBusy(true);router.push('/sample');return;
  }
  setError('Demo username or password is incorrect.');
 };
 return <form onSubmit={signIn} className="previewAuthForm">
  <div className="previewAuthHead"><span className="miniEyebrow">SANDBOX ACCESS</span><h2>Explore with demo credentials</h2>
   <p>View real Neon-backed sample analytics and test the OMR scanner without creating an account.</p></div>
  <label htmlFor="preview-user">Demo username</label>
  <input id="preview-user" autoComplete="username" value={username}
   onChange={e=>setUsername(e.target.value)} placeholder="push" required/>
  <label htmlFor="preview-pass">Demo password</label>
  <input id="preview-pass" type="password" autoComplete="off" value={password}
   onChange={e=>setPassword(e.target.value)} placeholder="12345678a" required/>
  {error&&<p role="alert" className="alert">{error}</p>}
  <button type="submit" className="button secondary block" disabled={busy}>
   {busy?'Opening sandbox…':'Explore sandbox dashboard'} <span aria-hidden="true">↗</span>
  </button>
  <p className="previewAuthHint">Testing only. These shared credentials do not create a real sign-in session or provide access to private institute data.</p>
 </form>;
}
