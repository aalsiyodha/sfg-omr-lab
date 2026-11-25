import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AppState } from '../App';
import type { AnswerOption } from '../types';
import { APP_BUILD_META } from '../config/version';
import { needsReview, filterReviewAnswers, countRejectedBlankMarks } from '../review/reviewPolicy';
import { generateLLMDiagnosticPrompt, generateBetaFeedbackPrompt } from '../diagnostics/llmPromptGenerator';
import './v26.css';

type Props = { appState: AppState };
type Tab = 'answers' | 'overlay' | 'markers' | 'diagnostics';
const choices: AnswerOption[] = ['A','B','C','D'];
const download = (name: string, content: string, mime = 'text/plain;charset=utf-8') => {
  const url = URL.createObjectURL(new Blob([content], {type: mime}));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export default function V26ScanPage({ appState }: Props) {
  const {opencv, scanning: engine, practice} = appState;
  const {scan, scanResult, intermediateImages, scanning, progress, error, updateAnswer, reset} = engine;
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const started = useRef<File | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const [tab, setTab] = useState<Tab>('answers');
  const [filter, setFilter] = useState<'flagged' | 'all'>('flagged');
  const [fullReport, setFullReport] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  useEffect(() => {
    if (!file || opencv !== 'ready' || started.current === file || scanning) return;
    started.current = file;
    // Yield one paint for preview/button before the CPU-intensive scanner runs.
    const task = window.setTimeout(() => { void scan(file, {
      fastQrRoi:true, coarseToFine:true, robustFusion:true,
      proofscan:false, proofmodel:false, proofmesh:false,
      simdProbe:false, ttopProbe:false
    },false); }, 0);
    return () => window.clearTimeout(task);
  }, [file, opencv, scanning, scan]);
  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview); };
  }, [preview]);
  const chooseFile = (next?: File) => {
    if (!next) return;
    if (!next.type.startsWith('image/') && !/\.(png|jpe?g|webp)$/i.test(next.name)) {
      setSubmissionError('Choose a JPG, PNG or WebP image.'); return;
    }
    if (next.size > 25 * 1024 * 1024) {
      setSubmissionError('Image exceeds 25 MB. Use a smaller photo.'); return;
    }
    reset(); started.current = null; setReveal(false); setTab('answers');
    setFilter('flagged'); setFullReport(false); setSubmissionError(null);
    setPreview(URL.createObjectURL(next)); setFile(next);
  };
  const newScan = () => {
    reset(); started.current = null; setFile(null); setPreview(null);
    setReveal(false); setSubmissionError(null);
    if(fileInput.current) fileInput.current.value = '';
    if(cameraInput.current) cameraInput.current.value = '';
  };
  const showResult = () => {
    setReveal(true);
    if (file && opencv === 'ready' && !scanning && !scanResult && started.current !== file) {
      started.current = file;
      void scan(file, {fastQrRoi:true,coarseToFine:true,robustFusion:true,
        proofscan:false,proofmodel:false,proofmesh:false,simdProbe:false,ttopProbe:false},false);
    }
  };
  const verified = Boolean(scanResult?.alignmentVerified && scanResult.qrValid &&
    !scanResult.provisional && scanResult.overallStatus !== 'failed' && scanResult.errors.length===0);
  const flagged = scanResult?.answers.filter(needsReview).length ?? 0;
  const answers = filterReviewAnswers(scanResult?.answers ?? [],filter);
  const counts = scanResult?.answers.reduce((acc,a) => {acc[a.status]=(acc[a.status]||0)+1;return acc;},
    {} as Record<string,number>) ?? {};
  const report = scanResult ? (fullReport
    ? generateLLMDiagnosticPrompt({scanResult,file,activeTestId:practice.activeTest?.testId,
        answerKey:practice.activeTest?.answerKey})
    : generateBetaFeedbackPrompt({scanResult,file,activeTestId:practice.activeTest?.testId})) : '';
  const submit = () => {
    if (!scanResult || !practice.activeTest) return;
    if (!verified || scanResult.testId===null) {
      setSubmissionError('This image has not passed QR and geometry verification. It cannot be scored.'); return;
    }
    const unresolved=scanResult.answers.filter(a=>a.status==='uncertain'||a.status==='error');
    if (unresolved.length) {
      setSubmissionError('Resolve '+unresolved.length+' uncertain/error response(s) before scoring.'); setTab('answers'); setFilter('flagged'); return;
    }
    if (scanResult.testId!==practice.activeTest.testId &&
      !window.confirm('Scanned Test ID '+scanResult.testId+' differs from active Test ID '+
        practice.activeTest.testId+'. Use the active test answer key anyway?')) return;
    practice.submitTest(scanResult.answers, scanResult.testId);
    navigate('/results');
  };
  const status = scanning ? 'Scanning in progress' : scanResult
    ? verified ? flagged ? 'Verified · review required' : 'Verified scan' : 'Registration not verified'
    : opencv==='error' ? 'Scanner could not load' : 'Preparing scanner';
  return <div className="v26-page">
    <header className="v26-intro">
      <div className="v26-eyebrow"><span className="v26-indicator"/> SFG OMR LAB <span className="v26-version">V2.6</span></div>
      <h1>OMR scanning,<br/><span>made simple.</span></h1>
      <p>Upload or photograph an answer sheet. We'll verify its QR identity and alignment,
        read the responses and highlight anything needing review.</p>
      <div className="v26-hero-trust">
        <span><i className="bi bi-shield-check"/> QR-verified</span>
        <span><i className="bi bi-laptop"/> Runs in your browser</span>
        <span><i className="bi bi-hand-index-thumb"/> Review uncertain marks</span>
      </div>
    </header>
    <section className="v26-panel" aria-label="Image scanner">
      <div className="v26-section-head">
        <div><span className="v26-step">GET STARTED</span><h2>Upload an answer sheet</h2></div>
        {file && <button className="v26-minor" type="button" disabled={scanning} onClick={newScan}>Start over</button>}
      </div>
      <input ref={fileInput} type="file" hidden accept="image/png,image/jpeg,image/webp,.jpg,.jpeg,.png,.webp"
        onChange={e=>chooseFile(e.target.files?.[0])}/>
      <input ref={cameraInput} type="file" hidden accept="image/*" capture="environment"
        onChange={e=>chooseFile(e.target.files?.[0])}/>
      {!file ? <div className="v26-drop"
        onDragOver={e=>e.preventDefault()}
        onDrop={e=>{e.preventDefault();chooseFile(e.dataTransfer.files[0]);}}>
        <div className="v26-drop-icon"><i className="bi bi-file-earmark-image"/></div>
        <h3>Drop an image here, or select a file</h3>
        <p>JPG, PNG, WebP · Up to 25 MB · All corners and QR code visible</p>
        <div className="v26-actions">
          <button type="button" className="v26-primary" onClick={()=>fileInput.current?.click()}>
            <i className="bi bi-upload"/> Choose image</button>
          <button type="button" className="v26-secondary" onClick={()=>cameraInput.current?.click()}>
            <i className="bi bi-camera"/> Take photo</button>
        </div>
      </div> : <div className="v26-selected">
        <div className="v26-photo">{preview && <img src={preview} alt="Selected OMR sheet preview"/>}</div>
        <div className="v26-selected-info">
          <span className="v26-step">SELECTED IMAGE</span>
          <h3 title={file.name}>{file.name}</h3>
          <p>{(file.size/1024/1024).toFixed(2)} MB · Local processing</p>
          <div className="v26-status" role="status" aria-live="polite">
            <span className={scanning?'v26-status-dot is-active':'v26-status-dot'}/>
            {status}
          </div>
          {scanning && <div className="v26-progress" role="progressbar" aria-label="Scanning progress"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress?.percent ?? 0}>
            <span style={{width:Math.max(4,progress?.percent??4)+'%'}}/>
          </div>}
          {scanning && <p className="v26-progress-label">{progress?.stage ?? 'Reading sheet…'}</p>}
          <button type="button" className="v26-primary v26-start" onClick={showResult} disabled={opencv==='error'}>
            <i className="bi bi-upc-scan"/> {scanResult?'View scan results':'Scan this image'}
            <i className="bi bi-arrow-right"/>
          </button>
          <p className="v26-hint">{scanResult?'Analysis complete — open your results':
            'Analysis runs automatically after upload. You can open the result with this button.'}</p>
        </div>
      </div>}
      {(error||submissionError||opencv==='error') &&
        <div className="v26-error" role="alert">{error||submissionError||
          'OpenCV failed to initialize. Reload the page and try again.'}</div>}
    </section>
    {reveal && file && <section className="v26-panel v26-results" aria-label="Scan results">
      <div className="v26-section-head">
        <div><span className="v26-step">REVIEW</span><h2>Your scan results</h2></div>
        <span className={'v26-pill '+(verified?'is-good':'')}>{scanResult?status:'Processing'}</span>
      </div>
      {!scanResult ? <div className="v26-wait"><div className="v26-spinner"/> {error||progress?.stage||'Reading image and checking registration…'}</div> : <>
        <div className="v26-metrics">
          <div><span>Test ID</span><strong>{scanResult.testId==null?'—':String(scanResult.testId).padStart(2,'0')}</strong></div>
          <div><span>Timing</span><strong>{scanResult.alignmentMatched??0}<small>/50</small></strong></div>
          <div><span>Detected</span><strong>{counts.detected??0}</strong></div>
          <div><span>Review</span><strong>{flagged}</strong></div>
          <div><span>Time</span><strong>{(scanResult.processingTimeMs/1000).toFixed(1)}<small>s</small></strong></div>
        </div>
        {!verified && <div className="v26-notice" role="alert">
          QR or alignment validation failed. No unverified answers will be scored.</div>}
        {scanResult.warnings.length>0 && <div className="v26-notice">{scanResult.warnings.join(' · ')}</div>}
        {countRejectedBlankMarks(scanResult.answers)>0 &&
          <p className="v26-muted">{countRejectedBlankMarks(scanResult.answers)} non-solid marks treated as blank under strict policy.</p>}
        <div className="v26-tabs" role="tablist" aria-label="Result details">
          {([['answers','Answers'],['overlay','Overlay'],['markers','Markers'],['diagnostics','Diagnostics']] as const)
            .map(([key,label])=><button type="button" role="tab" key={key}
              aria-selected={tab===key} className={tab===key?'is-active':''}
              onClick={()=>setTab(key)}>{label}</button>)}
        </div>
        {tab==='answers' && <div className="v26-table-block">
          <div className="v26-toolbar"><span>{counts.blank??0} blank · {counts.multiple??0} multiple · {counts.uncertain??0} uncertain</span>
            <div><button type="button" className={filter==='flagged'?'is-active':''} onClick={()=>setFilter('flagged')}>Review ({flagged})</button>
              <button type="button" className={filter==='all'?'is-active':''} onClick={()=>setFilter('all')}>All 50</button></div></div>
          {answers.length===0 ? <p className="v26-muted">No flagged responses. Switch to All 50 to inspect every answer.</p>
            : <div className="v26-table-scroll"><table className="v26-table"><thead><tr><th>Q</th><th>Reading</th><th>Status</th><th>Confirm answer</th></tr></thead>
              <tbody>{answers.map(a=><tr key={a.question}>
                <td>{String(a.question).padStart(2,'0')}</td>
                <td><strong>{a.detectedAnswer??'—'}</strong></td><td>{a.isManuallyEdited?'Edited':a.status}</td>
                <td><div className="v26-choices">{choices.map(choice=><button type="button" key={choice}
                  aria-label={'Set question '+a.question+' to '+choice} className={a.detectedAnswer===choice?'chosen':''}
                  onClick={()=>updateAnswer(a.question,choice)}>{choice}</button>)}
                  <button type="button" className={!a.detectedAnswer?'chosen':''}
                    aria-label={'Set question '+a.question+' to blank'} onClick={()=>updateAnswer(a.question,null)}>—</button>
                </div></td>
              </tr>)}</tbody></table></div>}
        </div>}
        {tab==='overlay' && (intermediateImages.bubbleOverlay
          ? <img className="v26-result-image" src={intermediateImages.bubbleOverlay} alt="Bubble detection results"/>
          : <p className="v26-muted">No verified bubble overlay for this image.</p>)}
        {tab==='markers' && (intermediateImages.markerOverlay
          ? <img className="v26-result-image" src={intermediateImages.markerOverlay} alt="Marker registration evidence"/>
          : <p className="v26-muted">Marker overlay unavailable. See diagnostics.</p>)}
        {tab==='diagnostics' && <div className="v26-diagnostics">
          <div className="v26-toolbar">
            <label><input type="checkbox" checked={fullReport} onChange={e=>setFullReport(e.target.checked)}/> Full technical diagnostic</label>
            <button type="button" onClick={()=>download('sfg-omr-diagnostic.txt',report)}>Download report</button>
          </div>
          <textarea readOnly value={report} aria-label="Scanner diagnostic" rows={15} onClick={e=>e.currentTarget.select()}/>
          <p className="v26-muted">Reports may contain student identifiers and original filenames. Share responsibly.</p>
        </div>}
        {verified && practice.activeTest && <div className="v26-score">
          <div><strong>Ready to score?</strong><p>Answers use your active practice test key. Review flagged rows first.</p></div>
          <button type="button" className="v26-primary" onClick={submit}>Submit & score</button>
        </div>}
      </>}
    </section>}
    <section className="v26-guide" id="how-it-works" aria-label="How scanning works">
      <div className="v26-guide-head"><span className="v26-step">HOW IT WORKS</span>
        <h2>Three steps to reviewed answers.</h2></div>
      <div className="v26-guide-grid">
        <div className="v26-guide-item"><span className="v26-guide-number">01</span><i className="bi bi-camera v26-guide-icon"/>
          <h3>Capture a clear image</h3><p>Place your sheet flat in even light. Keep the QR and all four corners in view.</p></div>
        <div className="v26-guide-item"><span className="v26-guide-number">02</span><i className="bi bi-cpu v26-guide-icon"/>
          <h3>Let the scanner work</h3><p>Analysis begins on upload. The browser verifies sheet geometry before reading responses.</p></div>
        <div className="v26-guide-item"><span className="v26-guide-number">03</span><i className="bi bi-check2-square v26-guide-icon"/>
          <h3>Review flagged marks</h3><p>Confirm unclear answers before scoring. Unverified sheets are never graded automatically.</p></div>
      </div>
    </section>
    <section className="v26-help"><i className="bi bi-lightbulb"/><div><strong>Tips for a successful scan</strong>
      <p>Use a sharp, well-lit photograph. Avoid glare, deep shadows and cropped edges. Review incomplete or multiple marks.</p>
    </div></section>
    <footer className="v26-footer"><span>OMR Lab · v{APP_BUILD_META.version}</span>
      <span>Local image processing · Strict verification before scoring</span></footer>
  </div>;
}
