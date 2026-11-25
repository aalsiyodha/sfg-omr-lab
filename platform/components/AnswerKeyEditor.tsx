'use client';
import {useRef,useState} from 'react';
import type {Choice} from '@/lib/key';
import {parseKeyCsv,TOTAL_QUESTIONS} from '@/lib/key';
import {saveKey,publishKey} from '@/app/actions';
type Props={testId:string;initial:Choice[];published:boolean;mayEdit:boolean};
const choices:['A','B','C','D','X']=['A','B','C','D','X'];
export default function AnswerKeyEditor({testId,initial,published,mayEdit}:Props){
 const [key,setKey]=useState<Choice[]>(initial);
 const [error,setError]=useState('');
 const [dirty,setDirty]=useState(false);
 const file=useRef<HTMLInputElement>(null);
 const complete=key.filter(v=>v!==null).length;
 const cancellations=key.filter(v=>v==='X').length;
 const allowed=mayEdit&&!published;
 const change=(index:number,value:Choice)=>{
   if(!allowed)return;
   setKey(prev=>prev.map((a,i)=>i===index?(a===value?null:value):a));
   setDirty(true);
 };
 const importCsv=async(f?:File)=>{
  if(!f||!allowed)return;
  if(f.size>100_000){setError('CSV must be smaller than 100 KB.');return;}
  const data=parseKeyCsv(await f.text());
  if(data.error){setError(data.error);return;}
  setKey(data.key);setDirty(true);setError('');
  if(file.current)file.current.value='';
 };
 const exportCsv=()=>{
  const text=['question,answer',...key.map((v,i)=>String(i+1)+','+(v??''))].join('\n');
  const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');
  link.href=url;link.download='answer-key-'+testId.slice(0,8)+'.csv';link.click();
  URL.revokeObjectURL(url);
 };
 return <div className="surface editor">
  <div className="sectionHeading">
   <div><span className="miniEyebrow">MASTER ANSWER KEY</span><h2>Review and confirm every answer</h2>
    <p>Choose A–D, or X for an officially cancelled question. Click the selected choice again to clear it.</p></div>
   <span className={complete===TOTAL_QUESTIONS?'status':'pill'}>{complete}/{TOTAL_QUESTIONS} complete</span>
  </div>
  <div className="progressTrack"><span style={{width:100*complete/TOTAL_QUESTIONS+'%'}}/></div>
  <div className="editorTools">
   <div className="muted small">{TOTAL_QUESTIONS-complete} missing · {cancellations} cancelled {dirty?' · Unsaved changes':''}</div>
   <div className="toolActions">
    <button type="button" className="button secondary compact" onClick={exportCsv}>Export CSV</button>
    {allowed&&<><input ref={file} type="file" accept=".csv,text/csv" hidden onChange={e=>void importCsv(e.target.files?.[0])}/>
     <button type="button" className="button secondary compact" onClick={()=>file.current?.click()}>Import CSV</button></>}
   </div>
  </div>
  {error&&<p role="alert" className="alert">{error}</p>}
  <div className="keyGrid">
   {key.map((answer,i)=><div className="keyRow" key={i}>
    <span className="keyNumber">{String(i+1).padStart(2,'0')}</span>
    <div className="keyChoices">{choices.map(c=><button type="button" key={c}
       disabled={!allowed} aria-label={'Question '+(i+1)+': '+(c==='X'?'cancelled':c)}
       aria-pressed={answer===c} className={'choice'+(answer===c?' selected':'')+(c==='X'?' cancelled':'')}
       onClick={()=>change(i,c)}>{c}</button>)}</div>
   </div>)}
  </div>
  <div className="editorBottom">
    <div><strong>{published?'This key is published':'Answer-key approval'}</strong>
      <p>{published?'The official key is read-only.': 'Save your draft, then publish only after confirming every question.'}</p></div>
    <div className="toolActions">
    {allowed&&<form action={saveKey}><input type="hidden" name="test_id" value={testId}/>
      <input type="hidden" name="key" value={JSON.stringify(key)}/>
      <button type="submit" className="button secondary">Save draft</button></form>}
    {allowed&&<form action={publishKey} onSubmit={e=>{
      if(dirty){e.preventDefault();setError('Save your changes before publishing.');return;}
      if(complete!==TOTAL_QUESTIONS||!window.confirm('Publish and permanently lock this answer key?'))e.preventDefault();
    }}><input type="hidden" name="test_id" value={testId}/>
      <button type="submit" className="button primary" disabled={complete!==TOTAL_QUESTIONS||dirty}>
        Publish official key <span>↗</span></button></form>}
    </div>
  </div>
  {!mayEdit&&<p className="muted small">Your role allows viewing but not editing answer keys.</p>}
 </div>;
}
