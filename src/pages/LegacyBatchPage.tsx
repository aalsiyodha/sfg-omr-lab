import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { AppState } from '../App';
import { runFullScan } from '../scanner/scanOrchestrator';
import type { ScanResult } from '../types';

type Entry={file:File;result:ScanResult|null;error:string|null;elapsed:number};
const identity=(r:ScanResult)=>r.qrValid&&r.studentId&&r.testId!==null
  ? r.studentId+' / Test '+r.testId:null;
const count=(r:ScanResult,status:string)=>r.answers.filter(a=>a.status===status).length;
const download=(name:string,body:string)=>{
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([body],{type:'text/plain;charset=utf-8'}));
  a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),3000);
};
function report(entries:Entry[]):string{
  const verified=entries.filter(e=>e.result&&identity(e.result)&&
    e.result.alignmentVerified&&e.result.overallStatus!=='failed');
  const idCounts=new Map<string,number>();
  verified.forEach(e=>{const key=identity(e.result!)!;idCounts.set(key,(idCounts.get(key)??0)+1)});
  const reference=[...idCounts].sort((a,b)=>b[1]-a[1])[0]?.[0]??null;
  const matching=verified.filter(e=>identity(e.result!)===reference);
  const rows=[
    'SFG OMR Lab — Experiment 2.3.3-full — Multi-photo diagnostic (same physical OMR)',
    'Generated: '+new Date().toISOString(),
    'Scanner runs: '+entries.length+' | Verified same-identity scans: '+matching.length,
    'Reference: '+(reference??'none'),
    'LEGACY FULL ENGINE: 2.3.3 original scanner, without Lite, no geometry code ported.',
    'NOTE: Each photo is scanned independently. No answers are merged.',
    '',
    'PER-PHOTO SUMMARY'
  ];
  for(const [i,e] of entries.entries()){
    const r=e.result;
    rows.push('#'+(i+1)+' '+e.file.name+' | '+(e.file.size/1024).toFixed(1)+' KB | '+e.file.type);
    rows.push('  '+(r
      ? 'Status '+r.overallStatus+' | '+(identity(r)??'identity not verified')+
        ' | QR '+(r.qrValid?'valid':'invalid')+
        ' | timing '+(r.alignmentMatched??0)+'/50 | registration '+(r.registrationMethod??'none')+
        ' | answers '+count(r,'detected')+' detected / '+count(r,'blank')+
        ' blank / '+count(r,'multiple')+' multiple / '+count(r,'uncertain')+' uncertain'+
        ' | scan '+(r.processingTimeMs/1000).toFixed(2)+'s'
      : 'Status failed | QR invalid | timing 0/50 | registration none | scan '+(e.elapsed/1000).toFixed(2)+'s'));
    if(e.error)rows.push('  Error: '+e.error);
    else if(r?.errors.length)rows.push('  Error: '+r.errors.join('; '));
    if(r?.overallStatus==='failed')for(const event of r.stageLogs
      .filter(l=>/registration|timing|qr|marker/i.test(l.message)).slice(-3))
      rows.push('  Historical engine log: '+event.message+
        (event.data?' | '+JSON.stringify(event.data).slice(0,600):''));
  }
  rows.push('', 'IDENTITY VALIDATION', 'Reference '+(reference??'not established'));
  entries.filter(e=>!matching.includes(e)).forEach(e=>rows.push(
    'Excluded from comparison: '+e.file.name+' (identity unverified or failed)'));
  rows.push('', 'QUESTION DISAGREEMENTS');
  if(matching.length<2)rows.push('At least two same-identity verified scans required.');
  else for(let q=1;q<=50;q++){
    const values=matching.map(e=>e.result!.answers.find(a=>a.question===q))
      .map(row=>row?.status==='detected'?row.detectedAnswer??'blank':row?.status??'missing');
    if(new Set(values).size>1)rows.push('Q'+String(q).padStart(2,'0')+': '+
      matching.map((e,i)=>e.file.name+'='+values[i]).join(' | '));
  }
  rows.push('','Build and runtime','App '+location.host+location.pathname,
    'Browser '+navigator.userAgent,'Original photographs are not included.');
  return rows.join('\n')+'\n';
}

export default function LegacyBatchPage({appState}:{appState:AppState}){
  const [files,setFiles]=useState<File[]>([]);
  const [results,setResults]=useState<Entry[]>([]);
  const [working,setWorking]=useState(false);
  const [progress,setProgress]=useState('');
  const [copyStatus,setCopyStatus]=useState('');
  const runningRef=useRef(false);
  const autoStartedRef=useRef<File[]|null>(null);
  const ready=appState.opencv==='ready';
  const eligible=files.length===10&&files.every(f=>/image\/(jpeg|jpg|png|webp)/.test(f.type));
  const same=useMemo(()=>results.filter(e=>e.result?.qrValid&&
    e.result.alignmentVerified&&e.result.overallStatus!=='failed'),[results]);
  const onChange=(e:ChangeEvent<HTMLInputElement>)=>{
    setFiles(Array.from(e.target.files??[]).sort((a,b)=>a.name.localeCompare(b.name)));
    setResults([]);setProgress('');setCopyStatus('');
    autoStartedRef.current=null;
  };
  const start=async(batch:File[])=>{
    if(batch.length!==10||!ready||runningRef.current)return;
    runningRef.current=true;
    setWorking(true);setResults([]);
    const all:Entry[]=[];
    try{
      for(const [i,file] of batch.entries()){
        setProgress('Scanning '+(i+1)+'/10: '+file.name);
        const t=performance.now();
        let entry:Entry;
        try{
          const {result}=await runFullScan(file,p=>
            setProgress('Scanning '+(i+1)+'/10: '+file.name+' — '+p.stage));
          entry={file,result,error:null,elapsed:performance.now()-t};
        }catch(error){
          entry={file,result:null,error:String(error),elapsed:performance.now()-t};
        }
        all.push(entry);setResults([...all]);
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      setProgress('Complete: '+all.length+'/10 photographs tested.');
    }finally{runningRef.current=false;setWorking(false);}
  };
  // Automatic regression: choosing ten photographs should immediately scan
  // them once OpenCV is ready. This also works when files arrive before WASM.
  useEffect(()=>{
    if(!eligible||!ready||runningRef.current||autoStartedRef.current===files)return;
    autoStartedRef.current=files;
    void start(files);
  },[files,eligible,ready]);
  const copyReport=async()=>{
    if(results.length!==10)return;
    const body=report(results);
    try{
      if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(body);
      else{
        const textarea=document.createElement('textarea');
        textarea.value=body;textarea.style.position='fixed';
        textarea.style.opacity='0';document.body.appendChild(textarea);
        textarea.select();
        const copied=document.execCommand('copy');textarea.remove();
        if(!copied)throw new Error('Clipboard unavailable');
      }
      setCopyStatus('Report copied to clipboard.');
    }catch(e){setCopyStatus('Copy failed: '+String(e)+'. Use Download instead.');}
  };
  return <div className="container py-4" style={{maxWidth:1000}}>
    <h1>Experiment 2.3.3-full — historical full engine</h1>
    <p className="text-muted">Archived full scanner before Lite. Choosing exactly ten photos starts scanning automatically as soon as OpenCV is ready. All processing stays local.
      Core legacy registration and bubble-reading code has not been modified.</p>
    <div className="alert alert-secondary" role="status">OpenCV: {appState.opencv}.
      {' '}{progress||'Choose all ten Test 27 photos; scanning starts automatically.'}</div>
    <label className="form-label" htmlFor="legacy-files">Choose exactly 10 photographs</label>
    <input id="legacy-files" className="form-control mb-3" type="file"
      multiple accept="image/jpeg,image/png,image/webp" onChange={onChange} disabled={working}/>
    <button type="button" className="btn btn-primary mb-3" disabled={!eligible||!ready||working}
      onClick={()=>void start(files)}>Analyse 10 photos</button>
    <p className="small text-muted">Selected {files.length}/10 · Completed {results.length}/10 ·
      Verified {same.length}. Unverified sheets remain unscored.</p>
    <div className="table-responsive">
      <table className="table table-sm table-striped"><thead><tr>
        <th>Photo</th><th>Result</th><th>QR</th><th>Timing</th><th>Time</th></tr></thead>
        <tbody>{results.map(e=><tr key={e.file.name}>
          <td>{e.file.name}</td><td>{e.result?.overallStatus??'failed'}</td>
          <td>{e.result?.qrValid?'valid':'invalid'}</td>
          <td>{e.result?.alignmentMatched??0}/50</td>
          <td>{((e.result?.processingTimeMs??e.elapsed)/1000).toFixed(2)} s</td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="d-flex flex-wrap gap-2 mb-2">
    <button type="button" className="btn btn-outline-secondary"
      disabled={working||results.length!==10}
      onClick={()=>download('omrlab-multi-photo-diagnostic.txt',report(results))}>
      Download combined diagnostic .txt
    </button>
    <button type="button" className="btn btn-outline-primary"
      disabled={working||results.length!==10} onClick={()=>void copyReport()}>
      Copy report
    </button>
    </div>
    <p role="status" aria-live="polite" className="small">{copyStatus}</p>
  </div>;
}
