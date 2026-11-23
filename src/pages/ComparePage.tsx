import {useEffect,useMemo,useRef,useState} from 'react';
import {APP_BUILD_META} from '../config/version';
import {ENGINES,runEngine,imageSha256} from '../comparison/engines';
import type {EngineId,EngineResult} from '../comparison/engines';
import {buildCompareReport,downloadJson,downloadText} from '../comparison/reports';
import type {ReportMode} from '../comparison/reports';

const initial:EngineId[]=['current','v2345','v226','scanic','lcnet'];
const overlayColors=['#10b981','#f97316','#6366f1','#ec4899','#06b6d4','#a855f7','#eab308'];
function word(outcome:string){return outcome==='verified'?'Verified':outcome==='partial'?'Review':
  outcome==='provisional'?'Provisional':outcome==='detected'?'Page candidate':
  outcome==='rejected'?'Rejected':outcome==='error'?'Engine error':'Failed';}
export default function ComparePage(){
 const [file,setFile]=useState<File|null>(null);
 const [imageUrl,setImageUrl]=useState<string|null>(null);
 const [dimensions,setDimensions]=useState<{w:number;h:number}|null>(null);
 const [selected,setSelected]=useState<EngineId[]>(initial);
 const [results,setResults]=useState<EngineResult[]>([]);
 const [hash,setHash]=useState('');
 const [busy,setBusy]=useState(false);
 const [current,setCurrent]=useState('');
 const [error,setError]=useState('');
 const [reportMode,setReportMode]=useState<ReportMode>('compact');
 const [showAllCorners,setShowAllCorners]=useState(true);
 const [tab,setTab]=useState<'results'|'overlay'|'diagnostics'>('results');
 const stop=useRef(false);
 const active=useRef(0);
 const choose=(value:EngineId,on:boolean)=>{
   setSelected(prev=>on?[...prev,value]:prev.filter(x=>x!==value));
 };
 useEffect(()=>{
   if(!file){setImageUrl(null);setDimensions(null);setHash('');return;}
   const url=URL.createObjectURL(file);
   setImageUrl(url);
   const img=new Image();img.onload=()=>setDimensions({w:img.naturalWidth,h:img.naturalHeight});
   img.onerror=()=>setDimensions(null);img.src=url;
   imageSha256(file).then(setHash).catch(()=>setHash('unavailable'));
   return ()=>URL.revokeObjectURL(url);
 },[file]);
 const ordered=ENGINES.filter(e=>selected.includes(e.id));
 const report=useMemo(()=>buildCompareReport({fileName:file?.name||'unselected',
   fileBytes:file?.size||0,hash:hash||'pending',selected:ordered,results,mode:reportMode}),
 [file,hash,ordered.map(e=>e.id).join(','),results,reportMode]);
 const resetFile=(f:File|null)=>{
   if(busy)return;
   setFile(f);setResults([]);setError('');setTab('results');
 };
 const run=async()=>{
   if(!file||!ordered.length||busy)return;
   if(file.size>25*1024*1024){setError('Image exceeds 25 MB maximum.');return;}
   if(!file.type.startsWith('image/')){setError('Choose a JPEG, PNG or WebP image.');return;}
   stop.current=false;setBusy(true);setResults([]);setError('');setTab('results');
   const id=++active.current;
   try{
     for(const engine of ordered){
       if(stop.current||id!==active.current)break;
       setCurrent(engine.name);
       const result=await runEngine(engine,file);
       if(id!==active.current)break;
       setResults(prev=>[...prev,result]);
     }
   }catch(e){setError(String(e));}
   finally{
     if(id===active.current){setCurrent('');setBusy(false);}
   }
 };
 const valid=results.filter(r=>r.outcome==='verified').length;
 const provisional=results.filter(r=>r.outcome==='provisional').length;
 const corners=results.filter(r=>r.corners.length===4);
 const resultById=(id:EngineId)=>results.find(x=>x.id===id);
 return <div className="compare-page">
   <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
     <div>
       <span className="minimal-kicker">SFG OMR LAB · v{APP_BUILD_META.version}</span>
       <h1 className="mb-1">Universal comparison lab</h1>
       <p className="text-secondary small mb-0">One photograph · multiple scanner generations and AI detectors · local browser processing</p>
     </div>
     <span className="badge rounded-pill text-bg-light border">Experimental · no automatic grading</span>
   </div>
   <div className="card shadow-sm mb-3">
     <div className="card-body">
       <div className="row g-3 align-items-center">
         <div className="col-md-7">
           <label className="form-label fw-semibold" htmlFor="compare-file">1. Upload one OMR photograph</label>
           <input className="form-control" id="compare-file" type="file"
             accept="image/jpeg,image/png,image/webp" disabled={busy}
             onChange={e=>resetFile(e.currentTarget.files?.[0]||null)}/>
           <div className="form-text">{file?
             file.name+' · '+(file.size/1024/1024).toFixed(2)+' MB · '+(dimensions?dimensions.w+' × '+dimensions.h:'reading dimensions'):
             'All selected engines will receive the exact same original image.'}</div>
           {hash&&<div className="small text-secondary text-break">SHA-256: {hash}</div>}
         </div>
         <div className="col-md-5">
           {imageUrl&&<img src={imageUrl} alt="OMR photograph preview"
             style={{width:'100%',height:154,objectFit:'contain',background:'var(--bs-tertiary-bg)',borderRadius:8}}/>}
         </div>
       </div>
     </div>
   </div>
   <div className="card shadow-sm mb-3">
     <div className="card-body">
       <h2 className="h5">2. Select comparison engines</h2>
       <p className="small text-secondary">Full scanners read bubbles. AI-only detectors report candidate page corners, not grades.</p>
       <div className="row g-2">
         {ENGINES.map(engine=><div className="col-md-6" key={engine.id}>
           <label className="compare-engine-choice d-flex gap-2 align-items-start p-3 border rounded h-100">
             <input className="form-check-input mt-1" type="checkbox"
               checked={selected.includes(engine.id)} disabled={busy}
               onChange={e=>choose(engine.id,e.target.checked)}/>
             <span>
               <strong className="d-block">{engine.name}</strong>
               <small className="text-secondary d-block">{engine.details}</small>
               <small className="text-secondary">{engine.kind==='scanner'?'Full scanner':'AI geometry only'} · {engine.version}</small>
               {engine.sizeNote&&<small className="d-block text-secondary">{engine.sizeNote}</small>}
             </span>
           </label>
         </div>)}
       </div>
       <div className="d-flex flex-wrap gap-2 align-items-center mt-3">
         <button className="btn btn-dark" disabled={!file||busy||!selected.length}
           onClick={()=>void run()}>{busy?'Running…':'Run '+selected.length+' engines'}</button>
         {busy&&<button className="btn btn-outline-secondary" onClick={()=>{stop.current=true;}}>
           Stop after current engine</button>}
         <span className="text-secondary small">{busy?'Running '+current+' · '+results.length+'/'+ordered.length:
           results.length?results.length+' result(s) · '+valid+' verified · '+provisional+' provisional':
           'Runs one engine at a time to conserve device memory'}</span>
       </div>
       {busy&&<div className="progress mt-3" role="progressbar" aria-valuenow={results.length}
         aria-valuemin={0} aria-valuemax={ordered.length} style={{height:6}}>
         <div className="progress-bar" style={{width:(results.length/ordered.length*100)+'%'}}/>
       </div>}
       {error&&<p className="text-danger small mt-3 mb-0" role="alert">{error}</p>}
     </div>
   </div>
   {results.length>0&&<div className="card shadow-sm mb-3">
     <div className="card-body">
       <div className="d-flex flex-wrap gap-2 border-bottom pb-3 mb-3" role="tablist" aria-label="Comparison sections">
         {(['results','overlay','diagnostics'] as const).map(x=><button
           key={x} className={'btn btn-sm '+(tab===x?'btn-dark':'btn-outline-secondary')}
           onClick={()=>setTab(x)} role="tab" aria-selected={tab===x}>
           {x==='results'?'Results':x==='overlay'?'Corner overlay':'Diagnostics'}</button>)}
       </div>
       {tab==='results'&&<>
         <h2 className="h5">Engine comparison</h2>
         <div className="table-responsive"><table className="table table-sm align-middle">
           <thead><tr><th>Engine</th><th>Type</th><th>Status</th><th>Time</th><th>Timing</th><th>Answers</th><th>Confidence</th></tr></thead>
           <tbody>{ordered.map(e=>{
             const r=resultById(e.id);
             return <tr key={e.id}>
               <td><strong>{e.name}</strong></td><td>{e.kind==='scanner'?'Scanner':'AI corners'}</td>
               <td>{r?word(r.outcome):'Not run'}</td><td>{r?(r.elapsedMs/1000).toFixed(2)+'s':'—'}</td>
               <td>{r?.timing===null||!r?'—':r.timing+'/50'}</td>
               <td>{r?(e.kind==='detector'?'—':r.answers.length+'/50'):'—'}</td>
               <td>{r?.confidence!=null?r.confidence.toFixed(4):'—'}</td>
             </tr>})}</tbody>
         </table></div>
         <p className="small text-secondary">A page-corner detection is not a verified OMR registration. Score comparisons are disabled on this page.</p>
         {results.map(r=><details key={r.id} className="border rounded p-2 mb-2">
           <summary><strong>{r.name}</strong> · {word(r.outcome)}</summary>
           <p className="small mb-1 mt-2">{r.reason}</p>
           {r.kind==='scanner'&&<p className="small mb-0">QR: {r.qrValid?'valid':'not verified'} ·
             timing: {r.timing??'—'}/50 · gray reference: {r.calibration??'—'}</p>}
         </details>)}
       </>}
       {tab==='overlay'&&<>
         <h2 className="h5">Page-corner predictions on the same photograph</h2>
         <label className="form-check-label d-flex align-items-center gap-2 mb-3">
           <input type="checkbox" className="form-check-input" checked={showAllCorners}
             onChange={e=>setShowAllCorners(e.target.checked)}/>
           Show AI and recovered scanner geometry
         </label>
         {imageUrl&&dimensions&&<div style={{position:'relative',maxWidth:700,margin:'0 auto'}}>
           <img src={imageUrl} alt="Input with predicted corner geometry"
             style={{display:'block',width:'100%',height:'auto',borderRadius:8}}/>
           <svg viewBox={'0 0 '+dimensions.w+' '+dimensions.h}
             style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none'}}>
             {showAllCorners&&corners.map((r,i)=><g key={r.id}>
               <polygon fill="none" stroke={overlayColors[i%overlayColors.length]} strokeWidth={Math.max(3,dimensions.w/300)}
                 points={r.corners.map(p=>p.x+','+p.y).join(' ')}/>
               {r.corners.map((p,j)=><g key={j}>
                 <circle cx={p.x} cy={p.y} r={Math.max(5,dimensions.w/140)}
                   fill={overlayColors[i%overlayColors.length]} stroke="white" strokeWidth="2"/>
               </g>)}
             </g>)}
           </svg>
         </div>}
         {corners.length?<div className="d-flex flex-wrap gap-3 mt-3">
           {corners.map((r,i)=><span className="small" key={r.id}>
             <span style={{display:'inline-block',width:11,height:11,borderRadius:3,background:overlayColors[i%overlayColors.length]}}/> {r.name}
           </span>)}
         </div>:<p className="small text-secondary">No corner coordinates available from the selected engines.</p>}
         <p className="small text-secondary mt-2">These are proposals, not manually confirmed ground-truth corners.</p>
       </>}
       {tab==='diagnostics'&&<>
         <h2 className="h5">Token-efficient comparison diagnostic</h2>
         <div className="d-flex flex-wrap gap-2 align-items-center mb-2">
           {(['compact','differences','full'] as const).map(x=><button key={x}
             className={'btn btn-sm '+(reportMode===x?'btn-dark':'btn-outline-secondary')}
             onClick={()=>setReportMode(x)}>{x==='compact'?'Compact':x==='differences'?'Differences':'Full'}</button>)}
           <button className="btn btn-outline-secondary btn-sm" onClick={()=>void navigator.clipboard.writeText(report)
             .catch(()=>{const t=document.createElement('textarea');t.value=report;document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();})}>Copy</button>
           <button className="btn btn-outline-secondary btn-sm"
             onClick={()=>downloadText('sfg-omr-v2.4-'+reportMode+'.txt',report)}>Save TXT</button>
           <button className="btn btn-outline-secondary btn-sm"
             onClick={()=>downloadJson('sfg-omr-v2.4-full.json',{
               hash,name:file?.name,bytes:file?.size,generated:new Date().toISOString(),
               engines:ordered.map(e=>({id:e.id,version:e.version}))
             },results)}>Full JSON</button>
         </div>
         <p className="small text-secondary">{reportMode==='compact'?'Minimal cross-engine findings; ideal for sharing':
           reportMode==='differences'?'Only divergences and relevant failure evidence':'Complete available traces and answer measurements'} ·
           approx. {Math.round(report.length/4).toLocaleString()} tokens (rough estimate).</p>
         <textarea className="form-control font-monospace" readOnly value={report} rows={18}
           style={{fontSize:12}} onClick={e=>e.currentTarget.select()}/>
       </>}
     </div>
   </div>}
   <p className="small text-secondary">All engine inference occurs in this browser. AI model weights and versioned code are downloaded from this GitHub Pages site when needed. No image upload API or server is used.</p>
 </div>;
}
