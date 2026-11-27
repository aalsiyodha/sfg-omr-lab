import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { AppState } from '../App';
import { APP_BUILD_META } from '../config/version';
import { runFullScan } from '../scanner/scanOrchestrator';
import { buildCombinedReport, comparePhotos, type PhotoMetrics, type PhotoScan } from '../diagnostics/multiPhoto';
import './v26.css';

type Props={appState:AppState};
type Entry={file:File; scan:PhotoScan|null};
const round=(n:number)=>Math.round(n*10)/10;

async function imageMetrics(file:File):Promise<PhotoMetrics>{
  // Request a small decode so photo statistics don't allocate another 12MP bitmap.
  const bitmap=await Promise.race([
    createImageBitmap(file,{resizeWidth:256,resizeQuality:'medium'}),
    new Promise<never>((_,reject)=>setTimeout(
      ()=>reject(new Error('Preview statistics decoder timeout')),8000))
  ]);
  try {
    const width=bitmap.width,height=bitmap.height;
    const scale=256/Math.max(width,height);
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(width*scale));
    canvas.height=Math.max(1,Math.round(height*scale));
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    if(!ctx)throw new Error('Canvas pixel sampling unavailable');
    ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    const values=new Float32Array(canvas.width*canvas.height);
    let sum=0,sumsq=0,dark=0,light=0,edge=0,edgeCount=0;
    for(let i=0;i<values.length;i++){
      const k=i*4;
      const v=.2126*pixels[k]+.7152*pixels[k+1]+.0722*pixels[k+2];
      values[i]=v;sum+=v;sumsq+=v*v;
      if(v<55)dark++;
      if(v>248)light++;
    }
    for(let y=1;y<canvas.height;y++)for(let x=1;x<canvas.width;x++){
      const i=y*canvas.width+x;
      edge+=Math.abs(values[i]-values[i-1])+Math.abs(values[i]-values[i-canvas.width]);
      edgeCount+=2;
    }
    const mean=sum/values.length;
    return {width,height,mean:round(mean),contrast:round(Math.sqrt(Math.max(0,sumsq/values.length-mean*mean))),
      shadows:round(100*dark/values.length),highlights:round(100*light/values.length),
      edge:round(edge/Math.max(1,edgeCount)),landscape:width>height};
  }finally{bitmap.close();}
}
const saveReport=(report:string)=>{
  const url=URL.createObjectURL(new Blob([report],{type:'text/plain;charset=utf-8'}));
  const a=document.createElement('a');
  a.href=url;a.download='omrlab-multi-photo-diagnostic.txt';a.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),1500);
};
export default function MultiPhotoDiagnosticsPage({appState}:Props){
  const {opencv}=appState;
  const [entries,setEntries]=useState<Entry[]>([]);
  const [busy,setBusy]=useState(false);
  const [step,setStep]=useState('');
  const [error,setError]=useState('');
  const input=useRef<HTMLInputElement>(null);
  const inProgress=useRef(false);
  const cancelRequested=useRef(false);
  const addFiles=(event:ChangeEvent<HTMLInputElement>)=>{
    const incoming=Array.from(event.target.files??[]);
    event.target.value='';
    if(!incoming.length||busy)return;
    const acceptable=incoming.filter(f=>
      ['image/jpeg','image/png','image/webp'].includes(f.type)&&f.size<=25*1024*1024);
    if(acceptable.length!==incoming.length){
      setError('Use JPG, PNG or WebP photos under 25 MB each. Unsupported files were skipped.');
    }else setError('');
    setEntries(previous=>{
      const remaining=Math.max(0,10-previous.length);
      if(acceptable.length>remaining)setError('Maximum ten photos per comparison. Extra files were skipped.');
      return [...previous,...acceptable.slice(0,remaining).map(file=>({
        file,scan:null
      }))];
    });
  };
  const clear=()=>{
    if(busy)return;
    setEntries([]);setError('');setStep('');
  };
  const run=async()=>{
    if(inProgress.current||entries.length<2||opencv!=='ready')return;
    inProgress.current=true;cancelRequested.current=false;setBusy(true);setError('');
    const files=[...entries];
    try{
      for(let i=0;i<files.length;i++){
        if(cancelRequested.current)break;
        // Yield between scans so mobile can paint progress and reclaim memory.
        await new Promise<void>(resolve=>window.setTimeout(resolve,120));
        const entry=files[i];
        setStep('Photo '+(i+1)+'/'+files.length+': measuring light and scanning');
        let metrics:PhotoMetrics={width:0,height:0,mean:0,contrast:0,shadows:0,highlights:0,edge:0,landscape:false};
        let result:PhotoScan['result']=null, problem:string|null=null;
        try{
          // Statistics are informative, not a prerequisite to scanning.
          // If a mobile browser cannot decode the thumbnail, still try OMR.
          try{metrics=await imageMetrics(entry.file);}
          catch(e){setStep('Photo '+(i+1)+'/'+files.length+': lighting sample unavailable, scanning');}
          const scan=await runFullScan(entry.file,p=>
            setStep('Photo '+(i+1)+'/'+files.length+': '+p.stage),
            {fastQrRoi:true,coarseToFine:true,robustFusion:true,
              proofscan:false,proofmodel:false,proofmesh:false,
              simdProbe:false,ttopProbe:false,compact:true,qrOptionalExperiment:false,disableAiRecovery:true});
          // Drop large image overlays; only the compact decision and optical
          // data are retained for the multi-photo comparison.
          result={...scan.result,stageLogs:scan.result.stageLogs.filter(log=>
            log.level==='ERROR'||log.level==='WARNING'||
            /registration performance|selected .* registration|timing-track|scan stage timings|calibration|original-photo QR locator|Sideways OMR orientation|recovery conclusion|registration candidates complete|outer-page boundary recovery|Exp3.7 alternative paper hypotheses|Exp3.6 360-degree boundary orientation|Exp3.6 verified all-angle|AI last-resort summary|AI document boundary recovery|AI first-warp independent landmark verification|AI orientation probe error|Exp3.7.6|Exp3.7.4|Exp3.7.3|QR processing accounting/i.test(log.message)
          ).slice(-75)};
          if(result.overallStatus==='failed')problem=result.errors.join('; ')||'Registration failed';
        }catch(e){
          problem=e instanceof Error?e.message:String(e);
        }
        const record:PhotoScan={filename:entry.file.name,size:entry.file.size,
          mime:entry.file.type,metrics,result,error:problem};
        setEntries(prev=>prev.map(x=>x.file===entry.file?{...x,scan:record}:x));
        files[i]={...entry,scan:record};
      }
      const checked=comparePhotos(files.flatMap(e=>e.scan?[e.scan]:[]));
      if(cancelRequested.current)setError('Analysis stopped. Completed photo reports are retained.');
      else if(checked.same.length<2)setError('Comparison needs at least two verified scans of the same student and test. You can still export the report.');
    }finally{
      inProgress.current=false;setBusy(false);setStep('');
    }
  };
  const scans=entries.flatMap(e=>e.scan?[e.scan]:[]);
  const completed=scans.length>=2&&!busy;
  const comparison=comparePhotos(scans);
  return <div className="v26-shell" style={{maxWidth:1000,margin:'0 auto'}}>
    <div className="mb-4">
      <div className="text-secondary small mb-2">EXPERIMENT 3.7.6 · v{APP_BUILD_META.version}</div>
      <h1 className="h3 fw-bold mb-2">Experiment 3.7.6 — Classical Color + Marker Fusion — No AI</h1>
      <p className="small text-secondary">Experimental low-saturation paper detection complements marker-based fusion without invoking neural AI. No neural document detector is executed in this experiment. Only conventional OpenCV, QR, ArUco, corner, midpoint, boundary and timing geometry operate. Full QR and dual-side timing validation remain required.</p>
      <p className="text-secondary mb-2">Upload 2–10 different photos of the <strong>same physical sheet</strong>.
        Each photo is analysed separately, then compared by question.
        No answer is silently combined or changed.</p>
      <p className="small text-secondary">Photos stay in your browser. The combined text report contains optical measurements,
        verification and disagreements—not the photo pixels.</p>
    </div>
    <section className="card p-3 p-md-4 mb-3">
      <div className="d-flex flex-wrap gap-2 align-items-center justify-content-between">
        <div>
          <h2 className="h6 fw-semibold mb-1">Add OMR photos</h2>
          <div className="text-secondary small">Different angles, rotations and lighting. Up to 10 originals of 25 MB each; no heavy photo previews.</div>
        </div>
        <div className="d-flex gap-2">
          <input ref={input} className="d-none" type="file" multiple accept="image/jpeg,image/png,image/webp"
            onChange={addFiles}/>
          <button type="button" className="btn btn-primary" disabled={busy||entries.length>=10}
            onClick={()=>input.current?.click()}>Choose photos</button>
          <button type="button" className="btn btn-outline-secondary" disabled={busy||!entries.length}
            onClick={clear}>Clear</button>
        </div>
      </div>
      {entries.length>0&&<div className="mt-3 row g-2">
        {entries.map((entry,i)=><div className="col-6 col-md-3" key={i}>
          <div className="border rounded p-2 h-100">
            <div className="small text-truncate fw-semibold" title={entry.file.name}>{i+1}. {entry.file.name}</div>
            <div className="small text-secondary">{round(entry.file.size/1024)} KB
              {entry.scan?' · '+(entry.scan.result?.overallStatus??'failed'):''}</div>
          </div>
        </div>)}
      </div>}
      <div className="d-flex flex-wrap align-items-center gap-2 mt-3">
        <button type="button" className="btn btn-primary" onClick={()=>void run()}
          disabled={busy||entries.length<2||opencv!=='ready'}>
          {busy?'Analysing…':'Analyse '+entries.length+' photos'}</button>
        {busy&&<button type="button" className="btn btn-outline-secondary" onClick={()=>{cancelRequested.current=true;setStep('Stopping after current photo…');}}>Stop after this photo</button>}
        <span className="small text-secondary" role="status">
          {step||(opencv!=='ready'?'OpenCV '+opencv+' — analysis unavailable':
            entries.length<2?'Choose at least two photos':'Ready for local analysis')}</span>
      </div>
      {error&&<div className="alert alert-warning mt-3 mb-0" role="alert">{error}</div>}
    </section>
    {scans.length>0&&<section className="card p-3 p-md-4 mb-3">
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <h2 className="h6 fw-bold mb-0">Diagnostic overview</h2>
        <button type="button" className="btn btn-outline-primary btn-sm" disabled={!completed}
          onClick={()=>saveReport(buildCombinedReport(scans))}>Download combined diagnostic .txt</button>
      </div>
      <div className="small text-secondary mb-3">
        {comparison.same.length} matching verified scans · {comparison.excluded.length} excluded ·
        {' '}{comparison.differences.length} question disagreements
      </div>
      <div className="table-responsive">
        <table className="table table-sm align-middle small">
          <thead><tr><th>Photo</th><th>Scan / identity</th><th>Detected</th><th>Light (0–255)</th><th>Contrast</th><th>Orientation</th></tr></thead>
          <tbody>{scans.map((s,i)=><tr key={i}>
            <td title={s.filename}>{i+1}. {s.filename}</td>
            <td>{s.result?.overallStatus??'failed'} / {s.result?.qrValid?'QR ✓':'QR unverified'}</td>
            <td>{s.result?.answers.filter(a=>a.status==='detected').length??'–'}/50</td>
            <td>{s.metrics.mean}</td><td>{s.metrics.contrast}</td>
            <td>{s.metrics.landscape?'Landscape':'Portrait'}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="text-secondary small mb-0">Brightness/contrast describe sampled pixel data, not calibrated lux.
        Full grayscale reference, timing marks, registration method, and rejected-ink reasons are included in the report.</p>
    </section>}
    {completed&&<section className="card p-3 p-md-4 mb-3">
      <h2 className="h6 fw-bold">Answer disagreements</h2>
      {comparison.same.length<2
        ?<p className="small text-secondary mb-0">At least two images must pass QR and timing verification and have the same student ID and test ID.</p>
        :comparison.differences.length===0
        ?<p className="small mb-0">All 50 answers match across the verified images. This does not independently prove each mark is correct.</p>
        :<div className="table-responsive"><table className="table table-sm small">
          <thead><tr><th>Question</th>{comparison.same.map((s,i)=><th key={i} title={s.filename}>Photo {i+1}</th>)}</tr></thead>
          <tbody>{comparison.differences.map(d=><tr key={d.question}>
            <th>Q{d.question}</th>{d.answers.map((answer,i)=><td key={i}>
              <strong>{answer}</strong><div className="text-secondary">{d.fills[i]}</div>
            </td>)}
          </tr>)}</tbody>
        </table></div>}
      {comparison.excluded.length>0&&<p className="small text-secondary mb-0">
        {comparison.excluded.length} photo(s) excluded because QR/test identity was not verified or did not match.
      </p>}
    </section>}
  </div>;
}
