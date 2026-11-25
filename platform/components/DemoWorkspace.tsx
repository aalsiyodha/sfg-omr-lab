'use client';
import {useEffect,useState} from 'react';
import type {Choice} from '@/lib/key';
import {parseKeyCsv,TOTAL_QUESTIONS} from '@/lib/key';
import OmrEvaluation from '@/components/OmrEvaluation';
type Test={id:string;title:string;number:number;status:'draft'|'published';key:Choice[]};
const initial:Test[]=[
 {id:'demo-27',title:'Geography · Practice 27',number:27,status:'published',key:Array.from({length:50},(_,i)=>['A','B','C','D'][i%4] as Choice)},
 {id:'demo-28',title:'Modern History · Practice 28',number:28,status:'draft',key:Array.from({length:50},(_,i)=>i<18?(['B','C','A','D'][i%4] as Choice):null)}
];
const STORAGE='omrlab-institute-preview-v01';
export default function DemoWorkspace(){
 const [tests,setTests]=useState<Test[]>(initial);
 const [selected,setSelected]=useState('demo-28');
 const [name,setName]=useState('SFG Academy');
 const [testTitle,setTestTitle]=useState('');
 const [testNumber,setTestNumber]=useState(29);
 const [message,setMessage]=useState('');
 const [ready,setReady]=useState(false);
 useEffect(()=>{
  try{const stored=window.localStorage.getItem(STORAGE);
    if(stored){const parsed=JSON.parse(stored);
      if(Array.isArray(parsed.tests))setTests(parsed.tests);
      if(typeof parsed.name==='string')setName(parsed.name);
    }
  }catch{/* start fresh demo */}
  setReady(true);
 },[]);
 useEffect(()=>{if(!ready)return;
  try{window.localStorage.setItem(STORAGE,JSON.stringify({tests,name}));}
  catch{/* restricted browser storage */}
 },[ready,tests,name]);
 const active=tests.find(t=>t.id===selected)||tests[0];
 const drafts=tests.filter(t=>t.status==='draft').length;
 const published=tests.filter(t=>t.status==='published').length;
 const create=()=>{
  if(testTitle.trim().length<3||testNumber<1||testNumber>40){setMessage('Enter a test name and valid printed ID (01–40).');return;}
  const t:Test={id:'demo-'+Date.now(),title:testTitle.trim(),number:testNumber,status:'draft',key:Array(TOTAL_QUESTIONS).fill(null)};
  setTests(old=>[t,...old]);setSelected(t.id);setTestTitle('');setMessage('Draft created.');
 };
 const change=(i:number,v:Choice)=>{if(active.status!=='draft')return;
  setTests(old=>old.map(t=>t.id===active.id?{...t,key:t.key.map((old,j)=>j===i?(old===v?null:v):old)}:t));
 };
 const importCsv=async(file?:File)=>{
  if(!file||active.status!=='draft')return;
  if(file.size>100_000){setMessage('CSV is too large.');return;}
  const result=parseKeyCsv(await file.text());
  if(result.error){setMessage(result.error);return;}
  setTests(old=>old.map(t=>t.id===active.id?{...t,key:result.key}:t));
  setMessage('CSV imported. Review all responses.');
 };
 const publish=()=>{
  if(active.key.some(v=>v===null)){setMessage('Complete all 50 questions or cancel with X.');return;}
  if(!window.confirm('Publish and lock this demo answer key?'))return;
  setTests(old=>old.map(t=>t.id===active.id?{...t,status:'published'}:t));
  setMessage('Answer key published and locked.');
 };
 const reset=()=>{if(!window.confirm('Reset all locally stored demo changes?'))return;
  setTests(initial);setSelected('demo-28');setName('SFG Academy');setMessage('Demo reset.');
 };
 return <div className="dashboard">
  <div className="previewBanner"><strong>Interactive demo · no account required</strong>
    <span>Saved in this browser only. No Google login or database connection is used.</span></div>
  <div className="dashTop"><div><span className="miniEyebrow">INSTITUTE DASHBOARD</span>
    <h1>{name}</h1><p>Try creating tests, importing CSV keys and publishing approved answers.</p></div>
    <button className="textButton" onClick={reset}>Reset demo</button></div>
  <div className="statGrid">
    <div className="stat"><span>Total tests</span><strong>{tests.length}</strong><small>Demo library</small></div>
    <div className="stat"><span>Published keys</span><strong>{published}</strong><small>Read-only</small></div>
    <div className="stat"><span>Drafts</span><strong>{drafts}</strong><small>Available to edit</small></div>
  </div>
  <div className="dashColumns">
   <section className="surface mainColumn">
    <div className="sectionHeading"><div><span className="miniEyebrow">TEST LIBRARY</span><h2>Your tests</h2></div></div>
    <div className="testList">{tests.map(t=><button key={t.id} type="button"
      className={'testRow demoTest'+(selected===t.id?' active':'')} onClick={()=>{setSelected(t.id);setMessage('');}}>
      <span className="testNumber">{String(t.number).padStart(2,'0')}</span>
      <span className="testTitle"><strong>{t.title}</strong><small>50 questions · Test ID {t.number}</small></span>
      <span className={t.status==='published'?'status':'pill'}>{t.status==='published'?'● Published':'Draft'}</span>
     </button>)}</div>
   </section>
   <aside className="surface sideColumn"><span className="miniEyebrow">CREATE</span><h2>New test</h2>
    <div className="stack"><label>Test name<input value={testTitle} onChange={e=>setTestTitle(e.target.value)} placeholder="e.g. Polity Week 05"/></label>
    <label>Printed Test ID<input type="number" min={1} max={40} value={testNumber} onChange={e=>setTestNumber(Number(e.target.value))}/></label>
    <button className="button primary block" onClick={create}>Create draft <span>↗</span></button></div>
   </aside>
  </div>
  {active&&<section className="surface editor demoEditor">
   <div className="sectionHeading"><div><span className="miniEyebrow">ANSWER KEY · TEST {active.number}</span>
     <h2>{active.title}</h2><p>Select A–D, or X for a cancelled question.</p></div>
     <span className={active.status==='published'?'status':'pill'}>{active.status}</span>
   </div>
   <div className="editorTools"><span className="muted small">{active.key.filter(Boolean).length}/50 complete</span>
    <div className="toolActions">{active.status==='draft'&&<label className="button secondary compact">Import CSV
     <input type="file" hidden accept=".csv,text/csv" onChange={e=>void importCsv(e.target.files?.[0])}/></label>}
     <button className="button secondary compact" onClick={()=>{
      const csv=['question,answer',...active.key.map((v,i)=>(i+1)+','+(v||''))].join('\n');
      const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
      const a=document.createElement('a');a.href=url;a.download='demo-key.csv';a.click();URL.revokeObjectURL(url);
     }}>Export CSV</button></div></div>
   <div className="keyGrid">{active.key.map((v,i)=><div className="keyRow" key={i}><span className="keyNumber">{String(i+1).padStart(2,'0')}</span>
    <div className="keyChoices">{(['A','B','C','D','X'] as const).map(c=><button key={c} type="button"
      disabled={active.status==='published'} onClick={()=>change(i,c)}
      className={'choice'+(v===c?' selected':'')+(c==='X'?' cancelled':'')}>{c}</button>)}</div></div>)}</div>
   {active.status==='draft'&&<div className="editorBottom"><span className="muted">Demo changes save automatically in this browser.</span>
     <button className="button primary" onClick={publish}>Publish answer key <span>↗</span></button></div>}
  </section>}
  {active&&<OmrEvaluation key={active.id} testNumber={active.number} testTitle={active.title}
   answerKey={active.key} published={active.status==='published'}/>}
  {message&&<div className="notice" role="status">{message}</div>}
 </div>;
}
