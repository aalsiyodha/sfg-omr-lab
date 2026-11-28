import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { AppState } from '../App';
import { APP_BUILD_META } from '../config/version';
import { runFullScan } from '../scanner/scanOrchestrator';
import { comparePhotos, answerQualityScorecard, evaluateLabeledAnswers, type PhotoMetrics, type PhotoScan } from '../diagnostics/multiPhoto';
import { buildForensicReport } from '../diagnostics/forensicReport';
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
  const [truth,setTruth]=useState('');
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
              proofscan:false,proofmodel:false,proofmesh:true,
              answerCentricRings:true,sourceInkProbe:true,
              blockRingAlignment:true,comparativeOptics:true,
              simdProbe:false,ttopProbe:false,compact:true,qrOptionalExperiment:false,disableAiRecovery:false});
          // Preserve forensic evidence rather than discarding 3.7.9 events:
          // previous report filtered out exactly the corner and timing logs
          // needed to explain its six remaining failed registrations.
          // Retain compact structured events for all candidates, both
          // detectors, source QR, AI stages, and per-row timing diagnostics.
          // Exclude noisy image/debug output; do not cap by taking the LAST
          // events as this loses early classical evidence on AI failures.
          result={...scan.result,stageLogs:scan.result.stageLogs.filter(log=>
            log.level==='ERROR'||log.level==='WARNING'||
            /detailed registration candidate|registration performance|registration candidates complete|selected .* registration|scan stage timings|independent original-photo QR|original-photo QR locator|Exp3\.7\.9|Exp3\.7\.10|corner.*candidate coordinates|outer-page boundary recovery|vertex|small-page boundary|alternative paper hypotheses|360-degree boundary orientation|AI trace:|AI document boundary recovery|AI 360-degree candidate|Exp3.7.12|AI first-warp|AI candidate verification|AI-prewarped fiducial|AI-assisted|AI last-resort summary|Exp3.7.12 dual AI rescue summary|Optional AI recovery unavailable|QR processing accounting|failed registration taxonomy|timing-track|grayscale strip geometry diagnostic|Sideways OMR orientation|Lite gentle-curve|timing-assisted refinement/i.test(log.message)
          )};
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
  const quality=answerQualityScorecard(scans);
  const labeled=evaluateLabeledAnswers(scans,truth);
  return <div className="v26-shell" style={{maxWidth:1000,margin:'0 auto'}}>
    <div className="mb-4">
      <div className="text-secondary small mb-2">EXPERIMENT 3.9.0 · v{APP_BUILD_META.version}</div>
      <h1 className="h3 fw-bold mb-2">Experiment 3.9.0 — OMRKit + OMRChecker Complementary Laboratory</h1>
      <p className="small text-secondary">Classical OpenCV runs first. When all classical registration methods fail, the optional on-device Scanic corner model proposes another page outline. AI cannot recognize answers or bypass QR identity and both timing tracks. The report identifies which method succeeded and whether AI ran.</p>
      <p className="text-secondary mb-2">Upload 2–10 different photos of the <strong>same physical sheet</strong>.
        Each photo is analysed separately, then compared by question.
        No answer is silently combined or changed. Per-question printed-ring corrections are accepted only after independent held-out ring agreement. Raw camera-pixel photometry is separately audited when an original-source homography exists; it never silently changes grades.</p>
      <p className="small text-secondary">Photos stay in your browser. The combined text report contains per-photo classical and local-AI outcomes, timing residuals and answer disagreements, but no photo pixels.</p>
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
        <div className="d-flex gap-2 flex-wrap">
          <button type="button" className="btn btn-outline-primary btn-sm" disabled={!completed}
            onClick={()=>saveReport(buildForensicReport(scans,truth))}>Download forensic report .txt</button>
          <button type="button" className="btn btn-outline-primary btn-sm" disabled={!completed}
            onClick={()=>void navigator.clipboard.writeText(buildForensicReport(scans,truth))
              .then(()=>window.alert('Diagnostic report copied'))
              .catch(()=>window.alert('Clipboard permission denied — use Download'))}>Copy report</button>
        </div>
      </div>
      <div className="small text-secondary mb-3">
        {comparison.same.length} matching verified scans · {comparison.excluded.length} excluded ·
        {' '}{comparison.differences.length} question disagreements
      </div>
      <div className="row g-2 mb-3">
        <div className="col-6 col-md-3"><div className="border rounded p-2"><div className="text-secondary small">Same-ID unanimous</div><strong>{quality.conditionalUnanimousQuestions??'–'}/50</strong></div></div>
        <div className="col-6 col-md-3"><div className="border rounded p-2"><div className="text-secondary small">Full-cohort unanimous</div><strong>{quality.fullCohortUnanimousQuestions??'–'}/50</strong></div></div>
        <div className="col-6 col-md-3"><div className="border rounded p-2"><div className="text-secondary small">Abstentions</div><strong>{quality.abstentionRatePercent??'–'}%</strong></div></div>
        <div className="col-6 col-md-3"><div className="border rounded p-2"><div className="text-secondary small">p50 / p95</div><strong>{quality.p50Seconds??'–'}s / {quality.p95Seconds??'–'}s</strong></div></div>
      </div>
      <p className="small text-secondary">Cross-photo agreement is label-free, not correctness. Accuracy and incomplete-mark false-accept rate require labelled sheets. Failed and mismatched photographs count against full-cohort unanimity.</p>
      <details className="mb-3">
        <summary className="small fw-semibold">Optional: measure actual answer accuracy using 50 known labels</summary>
        <p className="small text-secondary mt-2 mb-2">Enter exactly 50 labels separated by spaces or commas: A, B, C, D, blank (-), X for an incomplete mark that must not be accepted, or M for multiple marks. Cross-photo agreement alone is not proof of correctness.</p>
        <textarea className="form-control form-control-sm" rows={3}
          value={truth} onChange={e=>setTruth(e.target.value)}
          placeholder="A B C D - X M ... (50 labels)" aria-label="Optional 50-question ground-truth labels"/>
        {labeled&&('valid' in labeled&&!labeled.valid
          ?<div className="small text-danger mt-2">{labeled.error}</div>
          :('accuracyPercent' in labeled
            ?<div className="small mt-2"><strong>Labelled accuracy: {labeled.accuracyPercent??'–'}%</strong>
               {' · '}Correct: {labeled.correct}/{labeled.total}
               {' · '}Incomplete-mark false accepts: {labeled.falseAccept}/{labeled.invalidTotal}
               {' · '}False-accept rate: {labeled.incompleteMarkFalseAcceptRatePercent??'–'}%</div>
            :null))}
      </details>
      <div className="table-responsive">
        <table className="table table-sm align-middle small">
          <thead><tr><th>Photo</th><th>Scan / identity</th><th>Accepted via</th><th>AI model</th><th>Timing</th><th>Detected</th><th>Light (0–255)</th><th>Contrast</th><th>Orientation</th></tr></thead>
          <tbody>{scans.map((s,i)=><tr key={i}>
            <td title={s.filename}>{i+1}. {s.filename}</td>
            <td>{s.result?.overallStatus??'failed'} / {s.result?.qrValid?'QR ✓':'QR unverified'}</td>
            <td>{s.result?.registrationMethod?.startsWith('ai-')?'Local AI':s.result?.registrationMethod?'Classical':'Unverified'}</td>
            <td>{(s.result?.stageLogs??[]).some(log=>/AI last-resort summary|ai-lcnet|dual AI rescue/i.test(log.message))?'Invoked':'Not needed'}</td>
            <td>{s.result?.alignmentVerified?s.result.alignmentMatched+'/50':'Not verified'}</td>
            <td>{s.result?.answers.filter(a=>a.status==='detected').length??'–'}/50</td>
            <td>{s.metrics.mean}</td><td>{s.metrics.contrast}</td>
            <td>{s.metrics.landscape?'Landscape':'Portrait'}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="text-secondary small mb-0">Brightness/contrast are approximate. Download the report for classical-versus-AI attribution, rejected registration candidates, per-side timing offsets and answer disagreements.</p>
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
