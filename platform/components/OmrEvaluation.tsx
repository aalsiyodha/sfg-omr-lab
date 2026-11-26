'use client';
import {useRef,useState} from 'react';
import {saveReviewedSubmission} from '@/app/submit-actions';
import type {ScanResult,IntermediateImages} from '../scanner-core/types';
import type {Choice} from '@/lib/key';
import {acceptedScan,gradeAnswers,initialResponse,needsManualReview,type Evaluation,type ResponseChoice} from '@/lib/evaluation';
type Props={
 testNumber:number;testTitle:string;answerKey:Choice[];published:boolean;
 correctMarks?:number;wrongMarks?:number;
 onEvaluated?:(evaluation:Evaluation,studentId:string|null)=>void;
 testDbId?:string;
 ignoreTestIdForDemo?:boolean;
};
const ANSWERS:ResponseChoice[]=['A','B','C','D',null,'MULTIPLE'];
declare global {interface Window{cv?:{Mat?:unknown;onRuntimeInitialized?:()=>void};}}
let cvLoading:Promise<void>|null=null;
function loadOpenCV():Promise<void>{
 if(window.cv?.Mat)return Promise.resolve();
 if(cvLoading)return cvLoading;
 cvLoading=new Promise<void>((resolve,reject)=>{
  let done=false;
  const fail=(msg:string)=>{if(done)return;done=true;reject(new Error(msg));};
  const finish=()=>{if(done)return;done=true;resolve();};
  const started=Date.now();
  const poll=()=>{
   if(window.cv?.Mat){finish();return;}
   if(Date.now()-started>30000){fail('OpenCV initialization timed out. Check the network and reload.');return;}
   window.setTimeout(poll,120);
  };
  const existing=document.getElementById('omrlab-cv-runtime') as HTMLScriptElement|null;
  if(existing){poll();return;}
  const script=document.createElement('script');script.id='omrlab-cv-runtime';
  script.src='https://docs.opencv.org/4.8.0/opencv.js';script.async=true;
  script.onload=()=>poll();
  script.onerror=()=>fail('OpenCV.js could not load. Check internet access.');
  document.head.appendChild(script);
 });
 return cvLoading.catch(e=>{cvLoading=null;throw e;});
}
function formatResponse(v:ResponseChoice):string{return v==='MULTIPLE'?'Multiple':v??'Blank';}
export default function OmrEvaluation({testNumber,testTitle,answerKey,published,
 correctMarks=2,wrongMarks=-0.66,onEvaluated,testDbId,ignoreTestIdForDemo=false}:Props){
 const fileRef=useRef<HTMLInputElement>(null);
 const [busy,setBusy]=useState(false);
 const [stage,setStage]=useState('');
 const [error,setError]=useState('');
 const [scan,setScan]=useState<ScanResult|null>(null);
 const [overlay,setOverlay]=useState<string|null>(null);
 const [edits,setEdits]=useState<Record<number,ResponseChoice>>({});
 const [confirmed,setConfirmed]=useState<Record<number,boolean>>({});
 const [score,setScore]=useState<Evaluation|null>(null);
 const [showAll,setShowAll]=useState(false);
 const [fileName,setFileName]=useState('');
 const [candidateName,setCandidateName]=useState('');
 const [saveBusy,setSaveBusy]=useState(false);
 const [savedMessage,setSavedMessage]=useState('');
 const complete=published&&answerKey.length===50&&answerKey.every(x=>x!==null);
 const blocked=scan?acceptedScan(scan,testNumber,ignoreTestIdForDemo):null;
 const flagged=scan?.answers.filter(needsManualReview)||[];
 const unreviewed=flagged.filter(r=>!confirmed[r.question]).length;
 const scanImage=async(file?:File)=>{
  if(!file)return;
  setError('');setScore(null);setScan(null);setOverlay(null);setSavedMessage('');
  setEdits({});setConfirmed({});setFileName(file.name);
  if(!complete){setError('Publish a complete answer key for this test before evaluating sheets.');return;}
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)){
   setError('Upload a JPG, PNG or WebP photograph. PDF and HEIC are not supported yet.');return;
  }
  if(file.size>12*1024*1024){setError('Image must be smaller than 12 MB.');return;}
  setBusy(true);
  try{
   setStage('Loading optical scanner…');
   await loadOpenCV();
   const {runFullScan}=await import('../scanner-core/scanner/scanOrchestrator');
   const {result,images}:{result:ScanResult;images:IntermediateImages}=
     await runFullScan(file,p=>setStage(p.stage),{
      proofscan:false,proofmodel:false,proofmesh:false,fastQrRoi:true,coarseToFine:true
     });
   setScan(result);
   setOverlay(images.bubbleOverlay||images.perspectiveCorrected||null);
   const issue=acceptedScan(result,testNumber,ignoreTestIdForDemo);
   if(issue)setError(issue);
   else setStage('Scan complete. Review flagged responses before grading.');
  }catch(e){setError(e instanceof Error?e.message:'Unexpected scanner error.');}
  finally{setBusy(false);if(fileRef.current)fileRef.current.value='';}
 };
 const review=(question:number,value:ResponseChoice)=>{
  setEdits(old=>({...old,[question]:value}));
  setConfirmed(old=>({...old,[question]:true}));
  setScore(null);setSavedMessage('');
 };
 const markAsSeen=(question:number)=>{
  setConfirmed(old=>({...old,[question]:true}));setScore(null);setSavedMessage('');
 };
 const calculate=()=>{
  if(!scan||blocked||unreviewed||!complete)return;
  const response=scan.answers.map(r=>
   Object.prototype.hasOwnProperty.call(edits,r.question)?edits[r.question]:initialResponse(r));
  const states=scan.answers.map(r=>Object.prototype.hasOwnProperty.call(edits,r.question)?
    (edits[r.question]==='MULTIPLE'?'multiple':'manual'):r.status);
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
  {ignoreTestIdForDemo&&<div className="notice"><strong>Demo-only Test ID bypass:</strong> a mismatched printed Test ID does not block local score calculation. QR and geometry verification still apply. Results cannot be saved to Neon from this page.</div>}
  {!complete?<div className="notice">Publish the test's complete answer key first. Only published keys can be used for scoring.</div>:<>
   <label className={'omrDrop'+(busy?' busy':'')}>
    <span className="omrDropIcon">▣</span>
    <strong>{busy?'Scanning OMR…':'Choose a student OMR photograph'}</strong>
    <span>JPG, PNG or WebP · maximum 12 MB · processed on your device</span>
    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp"
      disabled={busy} onChange={e=>void scanImage(e.target.files?.[0])}/>
   </label>
   {(busy||stage)&&<p className="omrStage" role="status">{busy?'◌ ':''}{stage}</p>}
   {fileName&&<p className="muted small">Uploaded file: {fileName}</p>}
   {error&&<div className="alert" role="alert">{error}</div>}
   {scan&&<div className="scanSummary">
    <div><span>QR</span><strong>{scan.qrValid?'Verified':'Invalid'}</strong></div>
    <div><span>Timing</span><strong>{scan.alignmentMatched??0}/50</strong></div>
    <div><span>Sheet ID</span><strong>{scan.testId??'—'}</strong></div>
    <div><span>Scan time</span><strong>{(scan.processingTimeMs/1000).toFixed(2)}s</strong></div>
    <div><span>Candidate</span><strong>{scan.studentId||'Unknown'}</strong></div>
   </div>}
   {scan&&!blocked&&<>
    <div className="reviewHeading">
      <div><h3>Review responses</h3>
       <p>{flagged.length} flagged · {unreviewed} awaiting confirmation.
       Incomplete fills, multiple marks and uncertain detections require review.</p></div>
      <button type="button" className="textButton" onClick={()=>setShowAll(v=>!v)}>
        {showAll?'Show flagged only':'Show all 50 answers'}
      </button>
    </div>
    {(showAll?scan.answers:flagged).map(r=>{
      const current=Object.prototype.hasOwnProperty.call(edits,r.question)?
        edits[r.question]:initialResponse(r);
      const needs=needsManualReview(r);
      return <div className="reviewRow" key={r.question}>
        <div className="reviewInfo"><strong>Q{String(r.question).padStart(2,'0')}</strong>
         <span>{needs?'Review required':'Scanned'} · {r.status}
           {r.policyRejectedBlank?' · non-solid ink':''}</span>
         {needs&&confirmed[r.question]&&<span className="reviewDone">Reviewed ✓</span>}
        </div>
        <div className="reviewOptions">
         {ANSWERS.map(v=><button type="button" key={String(v)}
          className={'reviewChoice'+(current===v?' picked':'')}
          onClick={()=>review(r.question,v)} title={formatResponse(v)}>
          {v==='MULTIPLE'?'Multi':v??'Blank'}</button>)}
        </div>
        {needs&&!confirmed[r.question]&&
         <button className="button secondary compact" onClick={()=>markAsSeen(r.question)}>
          Confirm current</button>}
      </div>;
    })}
    {!flagged.length&&<p className="successBox">No flagged marks. You can calculate the score directly.</p>}
    {overlay&&<details className="omrOverlay"><summary>Inspect corrected OMR image and markings</summary>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={overlay} alt="Registered scanned sheet with marked bubble overlay"/></details>}
    <div className="editorBottom">
     <div><strong>Ready to evaluate</strong>
      <p>{unreviewed?unreviewed+' flagged question(s) require confirmation.':
        'Scoring uses the published answer key. No candidate data is uploaded.'}</p></div>
     <button type="button" className="button primary" disabled={unreviewed>0}
      onClick={calculate}>Calculate score ↗</button>
    </div>
   </>}
   {score&&<div className="scoreResult">
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
     </div>:<p className="notice">Demo result stays in this browser and is not stored in Neon.
       Sign in to an institute account to save verified submissions.</p>}
   </div>}
  </>}
 </section>;
}
