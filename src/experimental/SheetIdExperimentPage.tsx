import { useState } from 'react';
import { APP_VERSION, APP_BUILD_META } from '../config/version';
import { downloadSheetIdPrototype } from './sheetIdPdf';
import { scanSheetId50, type SheetIdScanReport } from './sheetIdScanner';

export default function SheetIdExperimentPage(){
 const [report,setReport]=useState<SheetIdScanReport|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [imageName,setImageName]=useState('');
 const scan=async(file:File)=>{
  setBusy(true);setReport(null);setError('');setImageName(file.name);
  try{setReport(await scanSheetId50(file));}
  catch(e){setError(String(e));}
  finally{setBusy(false);}
 };
 const diagnostic=report?[
  'SFG OMR LAB — QR-FREE SHEET ID / TIMING PROTOTYPE',
  'Image='+imageName,
  'Version='+APP_VERSION+' | build='+APP_BUILD_META.buildId+' | source='+APP_BUILD_META.source,
  'Status='+report.status+' | '+report.reason,
  'Elapsed='+report.elapsedMs+' ms',
  'Footer='+JSON.stringify(report.sheet),
  'Registration='+report.registration+' | rotated180='+report.rotated180,
  'Timing='+JSON.stringify(report.timing),
  'Test ID='+report.testId,
  'Answer counts='+JSON.stringify({
    detected:report.detected,blank:report.blank,
    multiple:report.multiple,uncertain:report.uncertain
  }),
  'Stages='+JSON.stringify(report.stages),
  'Answers='+JSON.stringify(report.answers.map(a=>({
    q:a.question,status:a.status,answer:a.detectedAnswer,
    top:a.measurements.map(m=>({option:m.option,fill:m.fillPercent,
      reject:m.rejectReason}))
  }))),
  'WARNING: Prototype only. No official scoring; verify marked answers on real paper.'
 ].join('\n'):null;
 const copy=()=>{if(diagnostic)void navigator.clipboard.writeText(diagnostic);};
 const download=()=>{
  if(!diagnostic)return;
  const url=URL.createObjectURL(new Blob([diagnostic],{type:'text/plain'}));
  const link=document.createElement('a');link.href=url;link.download='sheetid-prototype-diagnostic.txt';
  link.click();URL.revokeObjectURL(url);
 };
 return <div className="container py-2" style={{maxWidth:860}}>
  <div className="mb-4">
   <div className="badge text-bg-warning mb-2">Independent experiment · NOT production scanner</div>
   <h2>Sheet ID + 50 Timing Boxes</h2>
   <div role="status" className="alert alert-info py-2 small"><strong>{APP_VERSION}</strong><span className="ms-2">Build {APP_BUILD_META.buildId} · {APP_BUILD_META.builtAt} · {APP_BUILD_META.source}</span></div>
   <p className="text-secondary">Four solid corners · 25 left + 25 right timing squares ·
    compact binary footer with two hollow end boxes · grayscale · existing Test ID.
    No QR, ArUco or midpoint markers on the new sheet.</p>
   <p className="small text-secondary">The first prototype supports 50 questions only.
    Codewords for 100/120/200 are reserved but their print layouts and reader are not yet implemented.</p>
  </div>
  <div className="card p-3 mb-3">
   <h5>1. Generate the matched experimental sheet</h5>
   <p className="small text-secondary">Print on A4 at actual size (100%). Do not use Fit to page.
    This PDF must be used with this experimental scanner, not the existing QR-based scanner.</p>
   <div><button className="btn btn-primary" onClick={()=>downloadSheetIdPrototype(50)}>
    Download 50-question Sheet ID PDF</button></div>
  </div>
  <div className="card p-3 mb-3">
   <h5>2. Photograph and scan</h5>
   <p className="small text-secondary">Mark both Test ID rows and some answer bubbles. Photograph the
    entire sheet including all corners and the bottom footer. Scan is local in your browser.</p>
   <input aria-label="Experimental sheet photograph" className="form-control" type="file"
    accept="image/jpeg,image/png,image/webp" disabled={busy}
    onChange={e=>{const file=e.target.files?.[0];if(file)void scan(file);}}/>
   {busy&&<p className="mt-3">Analyzing footer, registration, timing and answers…</p>}
   {error&&<div role="alert" className="alert alert-danger mt-3">{error}</div>}
  </div>
  {report&&<div className="card p-3 mb-3">
   <h5>3. Experiment result</h5>
   <div className={'alert '+(report.status==='verified'?'alert-success':'alert-warning')}>
    {report.status.toUpperCase()}: {report.reason}
   </div>
   <p>Elapsed: <strong>{report.elapsedMs} ms</strong> · Test ID: <strong>{report.testId??'unreadable'}</strong>
    · Timing: <strong>{report.timing?.matched??0}/50</strong></p>
   <p>Footer: <code>{report.sheet?.bits??'unreadable'}</code> · Layout: {report.sheet?.count??'unverified'}</p>
   <p>Detected {report.detected}, blank {report.blank},
    multiple {report.multiple}, uncertain {report.uncertain}</p>
   {report.overlayUrl&&<img className="img-fluid border mb-3" alt="Perspective-corrected experimental sheet"
    src={report.overlayUrl}/>}
   <div className="d-flex flex-wrap gap-2 mb-2">
    <button className="btn btn-outline-secondary" onClick={copy}>Copy full diagnostic</button>
    <button className="btn btn-outline-secondary" onClick={download}>Download diagnostic .txt</button>
   </div>
   <textarea className="form-control font-monospace" rows={9} value={diagnostic??''} readOnly
    aria-label="Full experimental diagnostic"/>
  </div>}
 </div>;
}
