import Link from 'next/link';
import {redirect} from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { isConfigured } from '@/lib/env';
import { createTest } from '@/app/actions';
import type { TestRecord,Institute } from '@/lib/types';
export default async function Dashboard({searchParams}:{searchParams:Promise<{org?:string;error?:string}>}){
 if(!isConfigured())redirect('/demo');
 const {db,user}=await requireUser();
 const memberships=await db.from('institute_members').select('institute_id,role').eq('user_id',user.id);
 const ids=(memberships.data||[]).map(m=>m.institute_id);
 if(!ids.length)redirect('/setup');
 const orgs=await db.from('institutes').select('id,name,slug').in('id',ids);
 const list=(orgs.data||[]) as Institute[];
 if(!list.length)redirect('/setup');
 const p=await searchParams;
 const selected=list.find(o=>o.id===p.org)||list[0];
 const role=memberships.data?.find(m=>m.institute_id===selected.id)?.role||'reviewer';
 const mayEdit=role==='owner'||role==='admin';
 const {data}=await db.from('tests').select('*').eq('institute_id',selected.id).order('created_at',{ascending:false});
 const tests=(data||[]) as TestRecord[];
 const draft=tests.filter(t=>t.status==='draft').length;
 const published=tests.filter(t=>t.status==='published').length;
 return <div className="dashboard">
   <div className="dashTop">
    <div><span className="miniEyebrow">INSTITUTE WORKSPACE</span>
      <h1>{selected.name}</h1><p>Manage your tests, prepare answer keys and control publication.</p></div>
    <div className="dashUser"><span>{user.email}</span>
     <span className="pill">{role}</span>
     <form action="/auth/signout" method="post"><button className="textButton">Sign out</button></form></div>
   </div>
   {list.length>1&&<div className="orgSwitcher">{list.map(o=><Link key={o.id} href={'/dashboard?org='+o.id} className={o.id===selected.id?'active':''}>{o.name}</Link>)}</div>}
   <div className="statGrid">
    <div className="stat"><span>Total tests</span><strong>{tests.length}</strong><small>Created in this institute</small></div>
    <div className="stat"><span>Published keys</span><strong>{published}</strong><small>Read-only after publication</small></div>
    <div className="stat"><span>Drafts</span><strong>{draft}</strong><small>Awaiting confirmation</small></div>
   </div>
   <div className="dashColumns">
    <section className="surface mainColumn">
      <div className="sectionHeading"><div><span className="miniEyebrow">TEST LIBRARY</span><h2>Tests and answer keys</h2></div>
      <span className="pill">{tests.length} total</span></div>
      {tests.length?<div className="testList">{tests.map(t=><Link href={'/dashboard/tests/'+t.id} key={t.id} className="testRow">
        <span className="testNumber">{String(t.sheet_test_number).padStart(2,'0')}</span><span className="testTitle"><strong>{t.title}</strong><small>50 questions · Test ID {t.sheet_test_number}</small></span>
        <span className={t.status==='published'?'status':'pill'}>{t.status==='published'?'● Published':'Draft'}</span><span className="arrow">↗</span>
       </Link>)}</div>:<div className="empty"><span>▦</span><h3>No tests yet</h3><p>Create your first 50-question test, then enter or import its answer key.</p></div>}
    </section>
    <aside className="surface sideColumn">
      <span className="miniEyebrow">QUICK ACTION</span><h2>Create a test</h2>
      <p>Start with the 50-question SFG sheet supported by the current scanner.</p>
      {p.error&&<p className="alert">Unable to create test. Check your permissions and inputs.</p>}
      {mayEdit?<form action={createTest} className="stack">
        <input type="hidden" name="org" value={selected.id}/>
        <label>Test name<input name="title" minLength={3} maxLength={120} required placeholder="e.g. Geography — Week 04"/></label>
        <label>Printed Test ID (01–40)<input name="sheet_test_number" type="number" min={1} max={40} required defaultValue={1}/></label>
        <button className="button primary block" type="submit">Create draft <span>↗</span></button>
      </form>:<div className="notice">Your institute role is review-only. Ask an owner or admin to create tests.</div>}
      <div className="sideNote"><strong>Coming next</strong><p>100/150-question sheets, institute invitations, batch imports and student score reports.</p></div>
    </aside>
   </div>
 </div>
}
