import { redirect } from 'next/navigation';
import { isConfigured } from '@/lib/env';
import { requireUser } from '@/lib/auth';
import { createInstitute } from '@/app/actions';
export default async function Setup({searchParams}:{searchParams:Promise<{error?:string}>}){
 if(!isConfigured())redirect('/demo');
 await requireUser();
 const p=await searchParams;
 return <div className="authCard setupCard">
 <span className="miniEyebrow">STEP 01 · ORGANIZATION</span>
 <h1>Create your institute.</h1>
 <p>Give your staff a private workspace for preparing tests and answer keys.</p>
 {p.error&&<p className="alert">{p.error==='exists'?'Unable to create institute. This URL may already be in use.':'Check the institute name and URL.'}</p>}
 <form action={createInstitute} className="stack">
  <label>Institute name<input name="name" required minLength={3} maxLength={100} placeholder="e.g. SFG Academy"/></label>
  <label>Unique institute URL<input name="slug" required minLength={3} maxLength={40} pattern="[a-z0-9][a-z0-9-]{2,39}" placeholder="sfg-academy"/></label>
  <p className="muted small">This slug identifies your institute. Dedicated subdomains will be introduced after the workspace pilot.</p>
  <button className="button primary block" type="submit">Create workspace <span>↗</span></button>
 </form>
 </div>
}
