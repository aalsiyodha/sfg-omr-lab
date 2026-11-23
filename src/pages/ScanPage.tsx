import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AppState } from '../App';
import type { AnswerOption } from '../types';
import { generateLLMDiagnosticPrompt, generateBetaFeedbackPrompt } from '../diagnostics/llmPromptGenerator';
import { APP_VERSION, APP_BUILD_META, APP_DEPLOY_LABEL } from '../config/version';
import { copyText } from '../utils/copyText';
import { needsReview, filterReviewAnswers, countRejectedBlankMarks } from '../review/reviewPolicy';

interface Props { appState: AppState; }

type InputMode = 'none' | 'upload' | 'camera';
type ResultViewTab = 'overlay' | 'markers' | 'table' | 'llm';

export default function ScanPage({ appState }: Props) {
  const { scanning, practice, opencv } = appState;
  const { scan, scanResult, intermediateImages, scanning: isScanning, progress, error, updateAnswer, reset } = scanning;
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nativeCameraInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<InputMode>('none');
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [fileSha256, setFileSha256] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setFileSha256(null);
    if (capturedFile && globalThis.crypto?.subtle) {
      void capturedFile.arrayBuffer()
        .then(bytes => crypto.subtle.digest('SHA-256', bytes))
        .then(hash => {
          if (!cancelled) setFileSha256(Array.from(new Uint8Array(hash))
            .map(b => b.toString(16).padStart(2, '0')).join(''));
        })
        .catch(() => { if (!cancelled) setFileSha256('unavailable'); });
    }
    return () => { cancelled = true; };
  }, [capturedFile]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ResultViewTab>('overlay');
  const [reviewFilter, setReviewFilter] = useState<'flagged' | 'all'>('flagged');
  const [llmCopied, setLlmCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [showTechnicalReport, setShowTechnicalReport] = useState(false);

  const stopCamera = useCallback(() => {
    cameraStream?.getTracks().forEach(t => t.stop());
    setCameraStream(null);
    setTorchOn(false);
    setTorchSupported(false);
    setMode('none');
  }, [cameraStream]);

  // Primary mobile camera: opens native phone camera with hardware flash control
  const triggerNativeCamera = () => {
    if (nativeCameraInputRef.current) {
      nativeCameraInputRef.current.click();
    }
  };

  // In-browser live camera stream (active when on HTTPS or localhost)
  const openCamera = async () => {
    // If browser restricts mediaDevices (e.g. plain HTTP on LAN), fallback seamlessly to native camera
    if (!navigator?.mediaDevices?.getUserMedia) {
      triggerNativeCamera();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 2560 },
        },
      });

      setCameraStream(stream);
      setMode('camera');

      // Check for torch / flash capability
      const track = stream.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() as any) || {};
      if ('torch' in caps) {
        setTorchSupported(true);
        // Attempt to turn torch on by default
        try {
          await (track as any).applyConstraints({ advanced: [{ torch: true }] });
          setTorchOn(true);
        } catch { /* torch constraint optional */ }
      }

      setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      }, 100);
    } catch (e: any) {
      console.warn('Live stream unavailable, falling back to native camera:', e);
      // Fallback seamlessly to native mobile camera
      triggerNativeCamera();
    }
  };

  const toggleTorch = async () => {
    const track = cameraStream?.getVideoTracks()[0];
    if (track && torchSupported) {
      try {
        const next = !torchOn;
        await (track as any).applyConstraints({ advanced: [{ torch: next }] });
        setTorchOn(next);
      } catch (err) {
        console.warn('Torch toggle failed:', err);
      }
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const v = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d')!.drawImage(v, 0, 0);
    canvas.toBlob(blob => {
      if (!blob) return;
      const file = new File([blob], 'capture.jpg', { type: 'image/jpeg' });
      setCapturedFile(file);
      setPreviewUrl(canvas.toDataURL('image/jpeg'));
      stopCamera();
    }, 'image/jpeg', 0.95);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCapturedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleScan = async () => {
    if (!capturedFile) return;
    setSubmitError(null);
    await scan(capturedFile);
  };

  const handleReset = () => {
    reset();
    setCapturedFile(null);
    setPreviewUrl(null);
    setSubmitError(null);
    setActiveTab('overlay');
    setReviewFilter('flagged');
    setLlmCopied(false);
    setCopyFailed(false);
  };

  const handleCopyLLMReport = async () => {
    if (!scanResult) return;
    const ok = await copyText(generateLLMDiagnosticPrompt({
      scanResult, file: capturedFile, fileSha256,
      activeTestId: practice.activeTest?.testId,
      answerKey: practice.activeTest?.answerKey,
    }));
    setLlmCopied(ok);
    setCopyFailed(!ok);
  };

  const handleCopyBetaReport = async () => {
    if (!scanResult) return;
    const ok = await copyText(generateBetaFeedbackPrompt({
      scanResult, file: capturedFile, fileSha256, activeTestId: practice.activeTest?.testId,
    }));
    setLlmCopied(ok);
    setCopyFailed(!ok);
  };

  const downloadOverlay = () => {
    if (!intermediateImages.bubbleOverlay) return;
    const link = document.createElement('a');
    link.href = intermediateImages.bubbleOverlay;
    link.download = 'sfg-omr-overlay.png';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleSubmit = () => {
    if (!scanResult || !practice.activeTest) {
      setSubmitError('No active practice test. Please generate a practice test first.');
      return;
    }
    if (scanResult.overallStatus === 'failed' || scanResult.errors.length > 0 || !scanResult.qrValid || scanResult.testId === null) {
      setSubmitError('This scan failed validation and cannot be scored. Check registration, orientation and Test ID, then rescan.');
      return;
    }
    const unresolved = scanResult.answers.filter(q => q.status === 'uncertain' || q.status === 'error');
    if (unresolved.length > 0) {
      setSubmitError(`Review ${unresolved.length} uncertain/error answer(s) before scoring. Use the Answer Table to confirm or clear each one.`);
      return;
    }
    if (scanResult.testId !== null && scanResult.testId !== practice.activeTest.testId) {
      const confirmed = window.confirm(
        `⚠️ Test ID mismatch!\nScanned sheet shows Test ID ${String(scanResult.testId).padStart(2,'0')}, ` +
        `but active test is ID ${String(practice.activeTest.testId).padStart(2,'0')}.\n\n` +
        `Scoring will use the ACTIVE test's answer key. Continue?`
      );
      if (!confirmed) return;
    }
    practice.submitTest(scanResult.answers, scanResult.testId);
    navigate('/results');
  };

  const reviewCount = scanResult?.answers.filter(needsReview).length ?? 0;
  const invalidBlankCount = countRejectedBlankMarks(scanResult?.answers ?? []);
  const visibleAnswers = filterReviewAnswers(scanResult?.answers ?? [], reviewFilter);
  const reportFull = scanResult ? generateLLMDiagnosticPrompt({
    scanResult,file:capturedFile,fileSha256,activeTestId:practice.activeTest?.testId,
    answerKey:practice.activeTest?.answerKey
  }) : '';
  const reportCompact = scanResult ? generateBetaFeedbackPrompt({
    scanResult,file:capturedFile,fileSha256,activeTestId:practice.activeTest?.testId
  }) : '';
  const diagnostic = showTechnicalReport ? reportFull : reportCompact;
  const saveReport = () => {
    if(!scanResult)return;
    const blob=new Blob([diagnostic],{type:'text/plain;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;
    a.download='sfg-omr-'+(capturedFile?.name||'scan').replace(/[^a-zA-Z0-9._-]/g,'_')+
      (showTechnicalReport?'-full':'-compact')+'.txt';
    document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  };
  const saveMarkerOverlay=()=>{
    if(!intermediateImages.markerOverlay)return;
    const a=document.createElement('a');a.href=intermediateImages.markerOverlay;
    a.download='sfg-omr-markers.png';document.body.appendChild(a);a.click();a.remove();
  };
  const counts=scanResult?.answers.reduce((a,q)=>{
    a[q.status]=(a[q.status]||0)+1;return a;
  },{} as Record<string,number>)??{};
  const verified=Boolean(scanResult?.alignmentVerified && scanResult?.qrValid);
  return (
    <div className="minimal-scan">
      <header className="minimal-scan-heading">
        <div>
          <span className="minimal-kicker">SFG OMR LAB · v2.3.45</span>
          <h1>Scan a sheet</h1>
        </div>
        <span className="minimal-build" title={APP_DEPLOY_LABEL+' · '+APP_BUILD_META.sha}>{APP_VERSION}</span>
      </header>

      {opencv !== 'ready' && (
        <div role="status" className="minimal-notice">
          {opencv==='loading'?'Preparing scanner…':'OpenCV unavailable — reload the page.'}
        </div>
      )}

      {!scanResult && (
        <section className="minimal-upload">
          <div className="minimal-upload-buttons">
            <button className="btn btn-dark" type="button"
              onClick={triggerNativeCamera} disabled={isScanning}>
              <i className="bi bi-camera me-2" />Take photo
            </button>
            <button className="btn btn-outline-secondary" type="button"
              onClick={()=>fileInputRef.current?.click()} disabled={isScanning}>
              <i className="bi bi-upload me-2" />Choose image
            </button>
            <button className="btn btn-link text-secondary" type="button"
              onClick={openCamera} disabled={isScanning}>Live camera</button>
          </div>
          <input ref={nativeCameraInputRef} type="file" accept="image/*"
            capture="environment" hidden onChange={handleFileChange}/>
          <input ref={fileInputRef} type="file"
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            hidden onChange={handleFileChange}/>
          {mode==='camera' && (
            <div className="minimal-camera">
              <video ref={videoRef} autoPlay playsInline className="w-100 rounded"/>
              <div className="minimal-actions">
                <button className="btn btn-dark btn-sm" onClick={capturePhoto}>Capture</button>
                {torchSupported && <button className="btn btn-outline-secondary btn-sm"
                  onClick={toggleTorch}>{torchOn?'Flash off':'Flash on'}</button>}
                <button className="btn btn-outline-secondary btn-sm" onClick={stopCamera}>Close</button>
              </div>
            </div>
          )}
          {capturedFile && (
            <div className="minimal-selected">
              {previewUrl && <img src={previewUrl} alt="Selected sheet" />}
              <div className="minimal-selected-details">
                <strong className="minimal-filename">{capturedFile.name}</strong>
                <span className="text-secondary small">{(capturedFile.size/1024/1024).toFixed(2)} MB</span>
                <button className="btn btn-dark" onClick={handleScan}
                  disabled={isScanning||opencv!=='ready'}>
                  {isScanning?'Scanning…':'Scan sheet'} <i className="bi bi-arrow-right ms-1"/>
                </button>
              </div>
            </div>
          )}
          {isScanning && (
            <div role="status" className="minimal-progress">
              <div className="progress" style={{height:4}}>
                <div className="progress-bar bg-dark" style={{width:(progress?.percent||10)+'%'}} />
              </div>
              <span>{progress?.stage||'Scanning…'}</span>
            </div>
          )}
          {error && <p role="alert" className="text-danger small mt-3">{error}</p>}
        </section>
      )}

      {scanResult && (
        <section className="minimal-results">
          <div className="minimal-result-top">
            <div>
              <span className={'minimal-status '+(verified?'is-good':'is-bad')}>
                {verified?(scanResult.overallStatus==='success'?'Verified':'Verified · review needed'):'Unverified'}
              </span>
              <h2>{verified?'Scan result':'Registration failed'}</h2>
              <span className="text-secondary small">{capturedFile?.name||'Photo'}</span>
            </div>
            <button className="btn btn-outline-secondary btn-sm"
              onClick={handleReset}><i className="bi bi-arrow-repeat me-1"/>New scan</button>
          </div>

          <div className="minimal-stat-grid">
            <div><strong>{scanResult.alignmentMatched||0}<small>/50</small></strong><span>Timing</span></div>
            <div><strong>{scanResult.testId===null?'—':String(scanResult.testId).padStart(2,'0')}</strong><span>Test ID</span></div>
            <div><strong>{(scanResult.processingTimeMs/1000).toFixed(2)}<small>s</small></strong><span>Duration</span></div>
            <div><strong>{counts.detected||0}</strong><span>Answers</span></div>
          </div>

          {scanResult.errors.length>0 && <div className="minimal-notice is-error" role="alert">
            {scanResult.errors.join(' · ')}
          </div>}
          {scanResult.warnings.length>0 && <div className="minimal-notice" role="status">
            {scanResult.warnings.join(' · ')}
          </div>}
          {invalidBlankCount>0 && <p className="minimal-footnote">
            {invalidBlankCount} incomplete or non-solid mark(s) treated as blank.
          </p>}

          <div className="minimal-tabs" role="tablist" aria-label="Scan inspection">
            {([
              ['overlay','Overlay'],['table','Answers'],['markers','Markers'],['llm','Diagnostics']
            ] as const).map(([id,label])=>
              <button key={id} role="tab" aria-selected={activeTab===id}
                className={activeTab===id?'is-active':''} onClick={()=>setActiveTab(id)}>
                {label}{id==='table'&&reviewCount>0?' · '+reviewCount:''}
              </button>
            )}
          </div>
          <div className="minimal-tab-panel">
            {activeTab==='overlay'&&(
              <>
                <div className="minimal-tab-tools">
                  <span>Green: filled · Red: multiple · Amber: review</span>
                  <button className="minimal-text-button" onClick={downloadOverlay}
                    disabled={!intermediateImages.bubbleOverlay}>Save overlay</button>
                </div>
                {intermediateImages.bubbleOverlay
                  ? <img className="minimal-inspection-image" src={intermediateImages.bubbleOverlay}
                    alt="Bubble detection overlay"/>
                  : <p className="minimal-empty">No alignment verified. Check Markers and Diagnostics for the failed registration.</p>}
              </>
            )}
            {activeTab==='markers'&&(
              <>
                <div className="minimal-tab-tools">
                  <span>Detected reference points</span>
                  <button className="minimal-text-button" onClick={saveMarkerOverlay}
                    disabled={!intermediateImages.markerOverlay}>Save markers</button>
                </div>
                {intermediateImages.markerOverlay
                  ? <img className="minimal-inspection-image" src={intermediateImages.markerOverlay}
                    alt="Detected reference markers"/>
                  : <p className="minimal-empty">No marker overlay available. Check the diagnostic report.</p>}
              </>
            )}
            {activeTab==='table'&&(
              <>
                <div className="minimal-tab-tools">
                  <span>{counts.detected||0} filled · {counts.blank||0} blank · {counts.multiple||0} multiple · {counts.uncertain||0} uncertain</span>
                  <div className="minimal-actions">
                    <button className={'minimal-text-button '+(reviewFilter==='flagged'?'is-active':'')}
                      onClick={()=>setReviewFilter('flagged')}>Review ({reviewCount})</button>
                    <button className={'minimal-text-button '+(reviewFilter==='all'?'is-active':'')}
                      onClick={()=>setReviewFilter('all')}>All 50</button>
                  </div>
                </div>
                {visibleAnswers.length===0
                  ? <p className="minimal-empty">{verified?'Nothing needs review.':'No answers available.'}</p>
                  : <div className="table-responsive">
                    <table className="table table-sm minimal-answer-table">
                      <thead><tr><th>Q</th><th>Read</th><th>Flag</th><th>Correction</th></tr></thead>
                      <tbody>{visibleAnswers.map(answer=>
                        <tr key={answer.question}>
                          <td>{String(answer.question).padStart(2,'0')}</td>
                          <td><strong>{answer.detectedAnswer||'—'}</strong></td>
                          <td>{answer.isManuallyEdited?'Edited':answer.status}</td>
                          <td><div className="minimal-choice-row">
                            {(['A','B','C','D'] as AnswerOption[]).map(opt=>
                              <button key={opt} className={answer.detectedAnswer===opt?'chosen':''}
                                aria-label={'Set Q'+answer.question+' to '+opt}
                                onClick={()=>updateAnswer(answer.question,opt)}>{opt}</button>
                            )}
                            <button className={!answer.detectedAnswer?'chosen':''}
                              aria-label={'Mark Q'+answer.question+' blank'}
                              onClick={()=>updateAnswer(answer.question,null)}>—</button>
                          </div></td>
                        </tr>
                      )}</tbody>
                    </table>
                  </div>}
              </>
            )}
            {activeTab==='llm'&&(
              <>
                <div className="minimal-tab-tools">
                  <div className="minimal-actions">
                    <button className={'minimal-text-button '+(!showTechnicalReport?'is-active':'')}
                      onClick={()=>setShowTechnicalReport(false)}>Compact</button>
                    <button className={'minimal-text-button '+(showTechnicalReport?'is-active':'')}
                      onClick={()=>setShowTechnicalReport(true)}>Full diagnostic</button>
                  </div>
                  <div className="minimal-actions">
                    <button className="minimal-text-button" onClick={saveReport}>Download .txt</button>
                    <button className="btn btn-dark btn-sm"
                      onClick={showTechnicalReport?handleCopyLLMReport:handleCopyBetaReport}>
                      <i className="bi bi-clipboard me-1"/>Copy report
                    </button>
                  </div>
                </div>
                {copyFailed&&<p role="alert" className="text-danger small">Clipboard unavailable. Select and copy the text below.</p>}
                {llmCopied&&<p className="text-success small">Report copied.</p>}
                <textarea aria-label="Diagnostic report" className="minimal-report"
                  readOnly value={diagnostic} onClick={e=>e.currentTarget.select()} rows={17}/>
                <p className="minimal-footnote">Testing mode: filenames, QR payload and student identifiers are not redacted. Share reports accordingly.</p>
              </>
            )}
          </div>
          {verified && practice.activeTest&&(
            <div className="minimal-submit">
              <button className="btn btn-dark" onClick={handleSubmit}>Submit &amp; score</button>
              {submitError && <span className="text-danger small">{submitError}</span>}
            </div>
          )}
        </section>
      )}
      <footer className="minimal-page-footer">
        On-device processing · {APP_DEPLOY_LABEL} · {APP_BUILD_META.buildId}
      </footer>
    </div>
  );
}
