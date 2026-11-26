'use client';
import {useEffect,useRef,useState} from 'react';
import {saveReviewedSubmission,saveDemoSubmission} from '@/app/submit-actions';
import DemoComparison,{type DemoPeer} from '@/components/DemoComparison';
import type {ScanResult,IntermediateImages} from '../scanner-core/types';
import type {Choice} from '@/lib/key';
import {acceptedScan,gradeAnswers,initialResponse,needsManualReview,type Evaluation,type ResponseChoice} from '@/lib/evaluation';
type Props={
 testNumber:number;testTitle:string;answerKey:Choice[];published:boolean;
 correctMarks?:number;wrongMarks?:number;
 onEvaluated?:(evaluation:Evaluation,studentId:string|null)=>void;
 testDbId?:string;
 ignoreTestIdForDemo?:boolean;
 demoPeers?:DemoPeer[];
};
type CVRuntime={Mat?:unknown;onRuntimeInitialized?:(()=>void)|null;then?:((resolve:(value:CVRuntime)=>void,reject:(reason:unknown)=>void)=>void)};
declare global {interface Window { cv?:CVRuntime; }}
let cvLoading:Promise<void>|null=null;
const SCAN_LIMIT_MS=120_000;
const MAX_SOURCE_MB=80;
const OPENCV_LOCAL_URL='/opencv/opencv.js';
function normalizeMime(file:File){return ['image/jpeg','image/png','image/webp'].includes(file.type)||/\.(jpe?g|png|webp)$/i.test(file.name);}

/** The npm-pinned OpenCV 4.8.0 asset is copied into Next public/ during build.
 * OpenCV 4.x returns a Promise on some builds and an initialized module on others.
 * Normalize both before handing control to the scanner's global 'cv' consumers.
 */
function loadOpenCV():Promise<void>{
 if(window.cv?.Mat)return Promise.resolve();
 if(cvLoading)return cvLoading;
 cvLoading=new Promise<void>((resolve,reject)=>{
  let settled=false,attached=false;
  let timer:number|undefined;
  const finish=()=>{if(settled)return;settled=true;window.clearTimeout(timer);resolve();};
  const fail=(message:string)=>{if(settled)return;settled=true;window.clearTimeout(timer);reject(new Error(message));};
  const attach=()=>{
   const module=window.cv;
   if(module?.Mat){finish();return;}
   if(!module||attached)return;
   if(typeof module.then==='function'){
    attached=true;
    // CRITICAL: Do not use Promise.resolve(module) or await module here.
    // Older OpenCV's thenable returns itself, triggering recursive promise
    // resolution and a completely blocked browser main thread.
    try{
     module.then((ready:CVRuntime)=>{
      if(ready?.Mat){window.cv=ready;finish();}
      else fail('OpenCV initialized without cv.Mat. Please report this compatibility issue.');
     },(reason:unknown)=>fail('OpenCV initialization failed: '+String(reason)));
    }catch(e){fail('OpenCV could not initialize: '+String(e));}
    return;
   }
   if(typeof module.onRuntimeInitialized!=='function'){
    module.onRuntimeInitialized=()=>{if(module.Mat)finish();};
    attached=true;
   }
  };
  timer=window.setTimeout(()=>fail('OpenCV did not become ready within 35 seconds. Please reload the page.'),35000);
  const existing=document.getElementById('omrlab-cv-runtime') as HTMLScriptElement|null;
  if(existing){attach();return;}
  const script=document.createElement('script');
  script.id='omrlab-cv-runtime';script.src=OPENCV_LOCAL_URL;script.async=true;
  script.onload=attach;
  script.onerror=()=>fail('Could not load local OpenCV asset /opencv/opencv.js.');
  document.head.appendChild(script);
 });
 return cvLoading.catch(err=>{cvLoading=null;throw err;});
}
function formatResponse(v:ResponseChoice):string{return v==='MULTIPLE'?'Multiple':v??'Blank';}
export default function OmrEvaluation({testNumber,testTitle,answerKey,published,
 correctMarks=2,wrongMarks=-0.66,onEvaluated,testDbId,ignoreTestIdForDemo=false,demoPeers=[]}:Props){
 const fileRef=useRef<HTMLInputElement>(null);
 const cameraRef=useRef<HTMLInputElement>(null);
 const startRef=useRef<number>(0);
 const timeoutRef=useRef<ReturnType<typeof setTimeout>|null>(null);
 const reportRef=useRef<HTMLDivElement|null>(null);
 const [elapsed,setElapsed]=useState(0);
 const [showDiagnostics,setShowDiagnostics]=useState(false);
 const [diagnostics,setDiagnostics]=useState<string[]>([]);

 const [busy,setBusy]=useState(false);
 useEffect(()=>{if(!busy)return;const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-startRef.current)/1000)),500);return()=>clearInterval(timer);},[busy]);
 const [stage,setStage]=useState('');
 const [error,setError]=useState('');
 const [scan,setScan]=useState<ScanResult|null>(null);
 const [overlay,setOverlay]=useState<string|null>(null);
 const [confirmed,setConfirmed]=useState<Record<number,boolean>>({});
 const [score,setScore]=useState<Evaluation|null>(null);
 const [showAll,setShowAll]=useState(false);
 const [fileName,setFileName]=useState('');
 const [candidateName,setCandidateName]=useState('');
 const [saveBusy,setSaveBusy]=useState(false);
 const [savedMessage,setSavedMessage]=useState('');
 const [livePeers,setLivePeers]=useState<DemoPeer[]>(demoPeers);
 const [demoSaveState,setDemoSaveState]=useState<'idle'|'saving'|'saved'|'failed'>('idle');
 const savedScanRef=useRef<ScanResult|null>(null);
 const complete=published&&answerKey.length===50&&answerKey.every(x=>x!==null);
 useEffect(()=>{
  if(!ignoreTestIdForDemo||!scan||!score||savedScanRef.current===scan)return;
  savedScanRef.current=scan;
  let active=true;
  setDemoSaveState('saving');
  void saveDemoSubmission({
   responses:score.rows.map(r=>r.response),statuses:score.rows.map(r=>r.status),
   confirmed:score.rows.map(r=>r.reviewed),qrVerified:scan.qrValid,
   alignmentVerified:scan.alignmentVerified===true,timingMatched:scan.alignmentMatched||0
  }).then(result=>{
   if(!active)return;
   setSavedMessage(result.message);setDemoSaveState(result.ok?'saved':'failed');
   if(result.ok&&result.peers)setLivePeers(result.peers);
  }).catch(()=>{if(active){setDemoSaveState('failed');setSavedMessage('Unable to reach Neon. Your score remains available locally.');}});
  return()=>{active=false;};
 },[score,scan,ignoreTestIdForDemo]);
 useEffect(()=>{if(score&&ignoreTestIdForDemo&&reportRef.current){reportRef.current.scrollIntoView({behavior:'smooth',block:'start'});}},[score,ignoreTestIdForDemo]);
 const blocked=scan?acceptedScan(scan,testNumber,ignoreTestIdForDemo):null;
 const flagged=scan?.answers.filter(needsManualReview)||[];
 const unreviewed=flagged.filter(r=>!confirmed[r.question]).length;
 const scanImage=async(file?:File)=>{
  if(!file)return;
  setError('');setScore(null);setScan(null);setOverlay(null);setSavedMessage('');setDemoSaveState('idle');
  setConfirmed({});setFileName(file.name);
  setDiagnostics([]);setElapsed(0);
  if(!complete){setError('Publish a complete answer key for this test before evaluating sheets.');return;}
  if(!normalizeMime(file)){
   setError('Upload a JPG, PNG or WebP photograph. PDF and HEIC are not supported yet.');return;
  }
  if(file.size>MAX_SOURCE_MB*1024*1024){setError('This image is larger than 80 MB. Please use your camera’s normal photo mode or resize the image before scanning.');return;}
  setBusy(true);startRef.current=Date.now();
  try{
   setDiagnostics(old=>[...old,`Source: ${file.name}, ${(file.size/1024/1024).toFixed(2)} MB, ${file.type||'unknown type'}`]);
   setStage('Loading local OpenCV 4.8 engine from OMRLabs…');
   await loadOpenCV();
   setStage('Preparing image and scanner modules…');
   setDiagnostics(old=>[...old,'OpenCV.js loaded successfully']);
   const {runFullScan}=await import('../scanner-core/scanner/scanOrchestrator');
   const {result,images}:{result:ScanResult;images:IntermediateImages}=
     await Promise.race([runFullScan(file,p=>{setStage(p.stage);setDiagnostics(old=>old[old.length-1]===p.stage?old:[...old,p.stage]);},{
      proofscan:false,proofmodel:false,proofmesh:false,fastQrRoi:true,coarseToFine:true
     }),new Promise<never>((_,reject)=>{timeoutRef.current=setTimeout(()=>reject(new Error('Scanning exceeded 120 seconds. Refresh the page and try a brighter, less tilted photograph.')),SCAN_LIMIT_MS);})]);
   setScan(result);
   setOverlay(images.bubbleOverlay||images.perspectiveCorrected||null);
   const issue=acceptedScan(result,testNumber,ignoreTestIdForDemo);
   if(issue)setError(issue);
   else {
    const exceptions=result.answers.filter(needsManualReview);
    if(exceptions.length===0&&complete){
     try{
      const graded=gradeAnswers(answerKey,result.answers.map(initialResponse),
       result.answers.map(row=>row.status),{correct:correctMarks,wrong:wrongMarks},
       result.answers.map(()=>true));
      setScore(graded);onEvaluated?.(graded,result.studentId);
      setStage('Scan complete. Score and question comparison ready.');
     }catch(e){setError(e instanceof Error?e.message:'Unable to calculate score.');}
    }else setStage('Scan complete. Exceptional unreadable detections need confirmation.');
   }
  }catch(e){setError(e instanceof Error?e.message:'Unexpected scanner error.');}
  finally{setBusy(false);if(timeoutRef.current)clearTimeout(timeoutRef.current);timeoutRef.current=null;if(fileRef.current)fileRef.current.value='';if(cameraRef.current)cameraRef.current.value='';}
 };
 // Exception handling is limited to actual scanner uncertainty/errors.
 // Ordinary blanks, strict-policy rejects, detected marks and multiple marks
 // are final automatic decisions; users cannot overwrite those answers.
 const acceptUnreadableBlank=(question:number)=>{
  setConfirmed(old=>({...old,[question]:true}));
  setScore(null);setSavedMessage('');
 };
 const calculate=()=>{
  if(!scan||blocked||unreviewed||!complete)return;
  const response=scan.answers.map(initialResponse);
  const states=scan.answers.map(r=>r.status);
  const approvals=scan.answers.map(r=>!needsManualReview(r)||Boolean(confirmed[r.question]));
  try{
   const graded=gradeAnswers(answerKey,response,states,
     {correct:correctMarks,wrong:wrongMarks},approvals);
   setScore(graded);
   onEvaluated?.(graded,scan.studentId);
  }catch(e){setError(e instanceof Error?e.message:'Cannot calculate score.');}
 };
 const saveToNeon=async()=>{
  if(!testDbId||!scan||!score||!scan.studentId||!candidateName.trim()||saveBusy)return;
  setSaveBusy(true);setSavedMessage('');
  try{
   const response=await saveReviewedSubmission({
    testId:testDbId,printedTestId:scan.testId||0,candidateCode:scan.studentId,
    candidateName:candidateName.trim(),qrVerified:scan.qrValid,
    alignmentVerified:scan.alignmentVerified===true,
    timingMatched:scan.alignmentMatched||0,scannerVersion:'v2.7.1',
    responses:score.rows.map(row=>row.response),statuses:score.rows.map(row=>row.status),
    confirmed:score.rows.map(row=>row.reviewed)
   });
   setSavedMessage(response.message);
  }catch(e){setSavedMessage(e instanceof Error?e.message:'Saving failed.');}
  finally{setSaveBusy(false);}
 };
 return <section className="surface evaluateSection">
  <div className="sectionHeading">
   <div><span className="miniEyebrow">OPTICAL SCORING · REVIEWED SUBMISSIONS</span>
    <h2>Upload an OMR sheet to evaluate</h2>
    <p>Test {testNumber} · {testTitle}. The scanner checks QR, geometry and 50 timing marks before any score is calculated.</p>
   </div><span className="pill">Scanner v2.7.1</span>
  </div>
  {ignoreTestIdForDemo&&<div className="notice"><strong>Demo-only Test ID bypass:</strong> a mismatched printed Test ID does not block local score calculation. QR and geometry verification still apply. Verified scanned answers are automatically saved in the Neon development database.</div>}
  {!complete?<div className="notice">Publish the test's complete answer key first. Only published keys can be used for scoring.</div>:<>
   <div className="omrInputPanel">
    <div className="omrInputHeader"><span className="omrDropIcon">▣</span><div><strong>Scan an OMR answer sheet</strong>
      <p>Choose a photo or use your phone camera. Image processing stays on this device, and the scanner normalizes photos to 1600px.</p></div></div>
    <div className="omrInputActions">
      <button type="button" className="button primary" disabled={busy} onClick={()=>cameraRef.current?.click()}>◉ Take photo</button>
      <button type="button" className="button secondary" disabled={busy} onClick={()=>fileRef.current?.click()}>↑ Upload image</button>
    </div>
    <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="omrHiddenInput"
      disabled={busy} onChange={e=>void scanImage(e.currentTarget.files?.[0])}/>
    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="omrHiddenInput"
      disabled={busy} onChange={e=>void scanImage(e.currentTarget.files?.[0])}/>
    <span className="muted small">JPG / PNG / WebP · up to 80 MB source image · browser-local processing. Camera support depends on your device.</span>
   </div>
   {(busy||stage)&&<div className="omrStage" role="status"><strong>{busy?'◌ Processing…':'Scanner status'}</strong><span>{stage||'Preparing…'}</span>{busy&&<small>{elapsed}s elapsed · scanning can take longer for difficult pages</small>}</div>}
   {(stage||error)&&<details className="omrDiagnostics" open={showDiagnostics} onToggle={e=>setShowDiagnostics((e.currentTarget as HTMLDetailsElement).open)}><summary>Scanner details and troubleshooting</summary><p>If the scan appears stuck, reload this page and try a sharp, well-lit photo showing all four corners. OpenCV runs in your browser; a heavy scan can temporarily slow the UI.</p><ol>{diagnostics.slice(-15).map((v,i)=><li key={i}>{v}</li>)}</ol></details>}
   {fileName&&<p className="muted small">Uploaded file: {fileName}</p>}
   {error&&<div className="alert" role="alert">{error} <button className="textButton" type="button" onClick={()=>{setError('');setStage('');setDiagnostics([]);}}>Dismiss</button></div>}
   {scan&&<div className="scanSummary">
    <div><span>QR</span><strong>{scan.qrValid?'Verified':'Invalid'}</strong></div>
    <div><span>Timing</span><strong>{scan.alignmentMatched??0}/50</strong></div>
    <div><span>Sheet ID</span><strong>{scan.testId??'—'}</strong></div>
    <div><span>Scan time</span><strong>{(scan.processingTimeMs/1000).toFixed(2)}s</strong></div>
    <div><span>Candidate</span><strong>{scan.studentId||'Unknown'}</strong></div>
   </div>}
   {scan&&!blocked&&<>
    <div className="reviewHeading">
     <div><h3>{flagged.length?'Exceptional scan decisions':'Automatic evaluation ready'}</h3>
      <p>{flagged.length?
       flagged.length+' unresolved detection(s). Routine blanks, multiple marks and partial fills are handled automatically.':
       'All 50 responses have automatic final decisions. No manual marking is required.'}</p></div>
     <button type="button" className="textButton" onClick={()=>setShowAll(v=>!v)}>
      {showAll?'Hide detected answers':'View all 50 read-only decisions'}
     </button>
    </div>
    {(showAll?scan.answers:flagged).map(r=>{
     const needs=needsManualReview(r);
     const current=initialResponse(r);
     return <div className="reviewRow" key={r.question}>
      <div className="reviewInfo"><strong>Q{String(r.question).padStart(2,'0')}</strong>
       <span>{needs?'Exceptional detection':'Automatic decision'} · {r.status}
        {r.policyRejectedBlank?' · incomplete mark rejected as blank':''}</span>
       {needs&&confirmed[r.question]&&<span className="reviewDone">Exception recorded as blank ✓</span>}
      </div>
      <div className="omrReadOnlyAnswer"><strong>{formatResponse(current)}</strong><small>Read-only</small></div>
      {needs&&!confirmed[r.question]&&<div className="omrExceptionActions">
       <button type="button" className="button secondary compact" onClick={()=>cameraRef.current?.click()}>Retake photo</button>
       <button type="button" className="button secondary compact"
        onClick={()=>{if(window.confirm('Treat this unreadable response as blank? No answer option will be selected.'))acceptUnreadableBlank(r.question);}}>
        Confirm unreadable → blank
       </button>
      </div>}
     </div>;
    })}
    {!flagged.length&&<p className="successBox">All scanner decisions accepted automatically. Blanks remain blank; multiple marks retain the strict penalty.</p>}
    {overlay&&<details className="omrOverlay"><summary>Inspect corrected OMR image and markings</summary>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={overlay} alt="Registered scanned sheet with marked bubble overlay"/></details>}
    <div className="editorBottom">
     <div><strong>Ready to evaluate</strong>
      <p>{unreviewed?unreviewed+' exceptional detection(s) need a new photo or conservative blank confirmation.':
        'All automatic decisions are final. Verified answers are saved to Neon for comparison.'}</p></div>
     <button type="button" className="button primary" disabled={unreviewed>0}
      onClick={calculate}>{ignoreTestIdForDemo?'View score and compare all questions ↗':'Calculate score ↗'}</button>
    </div>
   </>}
   {score&&<div className="scoreResult" ref={reportRef}>
     {ignoreTestIdForDemo?<><div className="notice" role="status"><strong>{demoSaveState==='saving'?'Saving to Neon…':demoSaveState==='saved'?'Saved to Neon ✓':demoSaveState==='failed'?'Neon save unavailable':'Scan completed'}</strong><p>{savedMessage||'Verified answers are stored anonymously in the development database.'}</p></div><DemoComparison score={score} peers={livePeers}/></>:<>
     <div className="scoreHero"><span>FINAL REVIEWED SCORE</span>
      <strong>{score.total.toFixed(2)} <small>/ {score.max.toFixed(2)}</small></strong>
      <p>Correct +{correctMarks} · Wrong {wrongMarks} · Blank 0 · Cancelled 0</p>
     </div>
     <div className="scoreStats">
      <div><span>Correct</span><strong>{score.correct}</strong></div>
      <div><span>Incorrect</span><strong>{score.incorrect}</strong></div>
      <div><span>Blank</span><strong>{score.blank}</strong></div>
      <div><span>Multiple</span><strong>{score.multiple}</strong></div>
      <div><span>Cancelled</span><strong>{score.cancelled}</strong></div>
     </div>
     {false&&demoPeers.length>0&&<div className="pilotCompare" aria-label="Compare your scanned score with the fictional demo students">
      <div className="pilotCompareTop"><div><span className="miniEyebrow">YOUR RESULT VS THE DEMO CLASS</span>
       <h3>How did this sheet perform?</h3>
       <p>The comparison uses the same synthetic answer key and the four fictional student records in Neon.</p></div>
       <span className="pilotRank">#{1+demoPeers.filter(p=>p.score>score.total).length} of {demoPeers.length+1}</span>
      </div>
      <div className="pilotCompareBars">
       {[...demoPeers.map(p=>({name:p.name,score:p.score,isYou:false})),{name:'Your uploaded OMR',score:score.total,isYou:true}]
        .sort((a,b)=>b.score-a.score).map(p=><div className={'pilotCompareRow'+(p.isYou?' current':'')} key={p.name}>
        <span>{p.name}</span><div className="sampleTrack"><span style={{width:Math.max(0,Math.min(100,p.score))+'%'}}/></div>
        <strong>{p.score.toFixed(2)}</strong></div>)}
      </div>
      <p className="pilotFootnote">Practice comparison only. Your scanned result stays in this browser and is not saved to Neon or added to the institute leaderboard.</p>
     </div>}
     <details className="omrResults"><summary>View question-by-question evaluation</summary>
      <div className="tableScroll"><table className="scoreTable"><thead><tr>
       <th>Q</th><th>Key</th><th>Student</th><th>Decision</th><th>Marks</th>
      </tr></thead><tbody>{score.rows.map(row=><tr key={row.question}>
       <td>{row.question}</td><td>{row.key}</td><td>{formatResponse(row.response)}</td>
       <td>{row.key==='X'?'Cancelled':row.correct?'Correct':
         row.response===null?'Blank':row.response==='MULTIPLE'?'Multiple':'Incorrect'}</td>
       <td>{row.marks>0?'+':''}{row.marks.toFixed(2)}</td>
      </tr>)}</tbody></table></div>
     </details>
     </>}
     {testDbId?<div className="notice">
       <strong>Submit verified result to Neon</strong>
       <p>Signed-in reviewer approval is required. The server recalculates all marks from the published key;
         it does not trust the score displayed by the browser. Candidate's QR ID: <strong>{scan?.studentId||'Unknown'}</strong>.</p>
       {scan?.studentId?<div className="toolActions">
        <input maxLength={120} value={candidateName} onChange={e=>setCandidateName(e.target.value)}
          placeholder="Candidate full name" aria-label="Candidate full name"/>
        <button type="button" className="button primary" disabled={saveBusy||!candidateName.trim()}
         onClick={()=>void saveToNeon()}>{saveBusy?'Saving…':'Approve & save result to Neon'}</button>
       </div>:<p className="alert">QR identity missing: result cannot be persisted.</p>}
       {savedMessage&&<p role="status">{savedMessage}</p>}
     </div>:!ignoreTestIdForDemo?<p className="notice">Demo result stays in this browser and is not stored in Neon.
       Sign in to an institute account to save verified submissions.</p>:null}
   </div>}
  </>}
 </section>;
}
