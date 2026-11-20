import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AppState } from '../App';
import type { AnswerOption } from '../types';
import { ErrorLogBox } from '../components/ErrorLogBox';
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ResultViewTab>('table');
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
    setActiveTab('table');
    setReviewFilter('flagged');
    setLlmCopied(false);
    setCopyFailed(false);
  };

  const handleCopyLLMReport = async () => {
    if (!scanResult) return;
    const ok = await copyText(generateLLMDiagnosticPrompt({
      scanResult, file: capturedFile,
      activeTestId: practice.activeTest?.testId,
      answerKey: practice.activeTest?.answerKey,
    }));
    setLlmCopied(ok);
    setCopyFailed(!ok);
  };

  const handleCopyBetaReport = async () => {
    if (!scanResult) return;
    const ok = await copyText(generateBetaFeedbackPrompt({
      scanResult, file: capturedFile, activeTestId: practice.activeTest?.testId,
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

  const StatusBadge = ({ status }: { status: string }) => {
    const map: Record<string, string> = {
      success: 'bg-success', partial: 'bg-warning text-dark', failed: 'bg-danger'
    };
    return <span className={`badge ${map[status] || 'bg-secondary'}`}>{status.toUpperCase()}</span>;
  };

  const hasAnswers = scanResult?.answers && scanResult.answers.length > 0;
  const hasErrorsOrWarnings = (scanResult?.errors && scanResult.errors.length > 0) || !hasAnswers;

  const betaReportPreview = scanResult ? generateBetaFeedbackPrompt({scanResult, file: capturedFile, activeTestId: practice.activeTest?.testId}) : '';
  // Strict-invalid marks (ticks, crescents, dots and partials) are blanks,
  // not review cases. A manual edit resolves a previously flagged question.
  const reviewCount = scanResult?.answers.filter(needsReview).length ?? 0;
  const resolvedCount = (scanResult?.answers.length ?? 0) - reviewCount;
  const invalidBlankCount = countRejectedBlankMarks(scanResult?.answers ?? []);
  const visibleAnswers = filterReviewAnswers(scanResult?.answers ?? [], reviewFilter);
  const llmReportPreview = scanResult
    ? generateLLMDiagnosticPrompt({
        scanResult,
        file: capturedFile,
        activeTestId: practice.activeTest?.testId,
        answerKey: practice.activeTest?.answerKey,
      })
    : '';

  return (
    <div>
      <div className="product-scan-header">
        <div><span className="product-kicker">YOUR SCANNING WORKSPACE</span><h1>Scan a sheet</h1><p>Upload your SFG answer sheet and inspect every detected mark.</p></div>
        <div className="d-flex flex-column align-items-start align-items-md-end gap-1">
          <span className="product-scan-version">{APP_VERSION}</span>
          <span className="product-deployment-label" title={`Full commit: ${APP_BUILD_META.sha} · built ${APP_BUILD_META.builtAt}`}>
            <i className="bi bi-hdd-network me-1" />{APP_DEPLOY_LABEL} · {APP_BUILD_META.buildId}{APP_BUILD_META.dirty ? ' · modified' : ''}
          </span>
        </div>
      </div>

      {opencv !== 'ready' && (
        <div className={`alert alert-${opencv === 'loading' ? 'warning' : 'danger'} mb-3`}>
          <i className="bi bi-exclamation-triangle me-2" />
          OpenCV is {opencv === 'loading' ? 'still loading — please wait a moment…' : 'not available. Please refresh the page.'}
        </div>
      )}

      {!scanResult && <div className="product-scan-instructions">
        <span><b>01</b> Add a photo</span><i className="bi bi-chevron-right" />
        <span><b>02</b> Verify geometry</span><i className="bi bi-chevron-right" />
        <span><b>03</b> Review answers</span>
      </div>}
      {/* Input section (hidden once scan result exists) */}
      {!scanResult && (
        <div className="row g-3">
          <div className="col-12">
            <div className="d-flex flex-wrap gap-2 mb-2 product-upload-actions">
              <button className="btn btn-primary" onClick={triggerNativeCamera} disabled={isScanning}>
                <i className="bi bi-camera-fill me-2" />Take a photo
              </button>
              <button className="btn btn-outline-primary" onClick={() => fileInputRef.current?.click()} disabled={isScanning}>
                <i className="bi bi-upload me-2" />Upload a photo
              </button>
              <button className="btn btn-outline-secondary" onClick={openCamera} disabled={isScanning}>
                <i className="bi bi-webcam me-2" />Live Camera
              </button>

              {/* Native mobile camera capture input (activates phone's native camera app with flash) */}
              <input
                ref={nativeCameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={handleFileChange}
              />

              {/* Standard file input for gallery/desktop */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                hidden
                onChange={handleFileChange}
              />
            </div>
            <small className="text-muted d-block mb-3">
              <i className="bi bi-lightning-charge me-1 text-warning" />
              <strong>Photo tip:</strong> Lay the page flat, include all edges, and avoid glare or blur. Flash is optional.
            </small>
          </div>

          {mode === 'camera' && (
            <div className="col-12 col-md-8">
              <div className="position-relative">
                <video ref={videoRef} autoPlay playsInline className="w-100 border rounded" />
                {torchSupported && (
                  <button
                    className={`btn btn-sm btn-${torchOn ? 'warning' : 'secondary'} position-absolute top-0 end-0 m-2 shadow`}
                    onClick={toggleTorch}
                  >
                    <i className="bi bi-lightning-fill me-1" />
                    {torchOn ? 'Torch ON' : 'Torch OFF'}
                  </button>
                )}
              </div>
              <div className="mt-2 d-flex gap-2">
                <button className="btn btn-primary" onClick={capturePhoto}>
                  <i className="bi bi-camera-fill me-2" />Capture Photo
                </button>
                {torchSupported && (
                  <button className={`btn btn-outline-${torchOn ? 'warning' : 'secondary'}`} onClick={toggleTorch}>
                    <i className="bi bi-lightning-fill me-1" />
                    {torchOn ? 'Disable Flash' : 'Enable Flash'}
                  </button>
                )}
                <button className="btn btn-outline-secondary" onClick={stopCamera}>Close Live Camera</button>
              </div>
            </div>
          )}

          {isScanning && (
            <div className="col-12 col-md-10 col-lg-8 mx-auto my-3">
              <div className="scanner-animation-container">
                <div className="scanner-viewport product-scanning-sheet" role="img" aria-label="Illustration of a sheet being scanned">
                  <div className="product-scan-paper-header"><span>SFG</span><span>OMR</span><span className="product-scan-qr" /></div>
                  <div className="viewport-grid">
                    {Array.from({length:12},(_,r)=>(
                      <div className="grid-row-mock" key={r}>
                        <span className="product-scan-row-number">{String(r+1).padStart(2,'0')}</span>
                        {Array.from({length:4},(_,i)=><span key={i} className={`grid-dot-mock ${(r*3+i)%7===0?'filled':''}`}/>)}
                      </div>
                    ))}
                  </div>
                  <div className="scanner-laser-line" />
                  <div className="product-scan-corner tl"/><div className="product-scan-corner tr"/><div className="product-scan-corner bl"/><div className="product-scan-corner br"/>
                </div>

                <div className="product-scan-live-label"><span className="product-live-dot" /> SCAN IN PROGRESS</div>\n                <h5 className="fw-bold mb-1" style={{ color: 'var(--text-main)' }}>
                  Reading your answer sheet
                </h5>
                <p className="text-muted small mb-3">
                  {progress?.stage || 'Finding reference markers and checking bubble shapes…'}
                </p>

                <div className="progress mb-3" style={{ height: 6, maxWidth: 440, margin: '0 auto' }}>
                  <div
                    className="progress-bar product-scanning-progress"
                    style={{ width: `${progress?.percent || 20}%`, backgroundColor: 'var(--primary)' }}
                  />
                </div>

                <div className="scan-stages-checklist">
                  <div className={`scan-stage-item ${(progress?.percent || 0) >= 30 ? 'completed' : (progress?.percent || 0) >= 10 ? 'active' : ''}`}>
                    <span className="scan-stage-icon">
                      {(progress?.percent || 0) >= 30 ? <i className="bi bi-check-circle-fill text-success" /> : <span className="spinner-border spinner-border-sm" />}
                    </span>
                    <span>1. Align printed sheet</span>
                  </div>
                  <div className={`scan-stage-item ${(progress?.percent || 0) >= 60 ? 'completed' : (progress?.percent || 0) >= 30 ? 'active' : ''}`}>
                    <span className="scan-stage-icon">
                      {(progress?.percent || 0) >= 60 ? <i className="bi bi-check-circle-fill text-success" /> : (progress?.percent || 0) >= 30 ? <span className="spinner-border spinner-border-sm" /> : <i className="bi bi-circle text-muted" />}
                    </span>
                    <span>2. Verify QR orientation and Test ID</span>
                  </div>
                  <div className={`scan-stage-item ${(progress?.percent || 0) >= 80 ? 'completed' : (progress?.percent || 0) >= 60 ? 'active' : ''}`}>
                    <span className="scan-stage-icon">
                      {(progress?.percent || 0) >= 80 ? <i className="bi bi-check-circle-fill text-success" /> : (progress?.percent || 0) >= 60 ? <span className="spinner-border spinner-border-sm" /> : <i className="bi bi-circle text-muted" />}
                    </span>
                    <span>3. Read all 50 questions</span>
                  </div>
                  <div className={`scan-stage-item ${(progress?.percent || 0) >= 100 ? 'completed' : (progress?.percent || 0) >= 80 ? 'active' : ''}`}>
                    <span className="scan-stage-icon">
                      {(progress?.percent || 0) >= 100 ? <i className="bi bi-check-circle-fill text-success" /> : (progress?.percent || 0) >= 80 ? <span className="spinner-border spinner-border-sm text-primary" /> : <i className="bi bi-circle text-muted" />}
                    </span>
                    <span>4. Flag unclear marks</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {!isScanning && previewUrl && (
            <div className="col-12 col-md-8 col-lg-6">
              <p className="fw-semibold mb-1">Photo preview:</p>
              <img src={previewUrl} alt="Preview" className="img-fluid border rounded mb-2" style={{ maxHeight: 420 }} />
              <div className="d-flex gap-2">
                <button className="btn btn-primary" onClick={handleScan} disabled={isScanning || opencv !== 'ready'}>
                  <i className="bi bi-upc-scan me-2" />Scan this photo
                </button>
                <button className="btn btn-outline-secondary" onClick={() => { setCapturedFile(null); setPreviewUrl(null); }} disabled={isScanning}>
                  Retake / Choose Another
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="col-12">
              <ErrorLogBox
                title="Scan Execution Failed"
                errorMessage={error}
                file={capturedFile}
              />
            </div>
          )}
        </div>
      )}

      {/* Results section */}
      {scanResult && (
        <div>
          <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
            <h4 className="mb-0">Scan Result ({APP_VERSION})</h4>
            <StatusBadge status={scanResult.overallStatus} />
            <span className="text-muted small">({scanResult.processingTimeMs} ms)</span>

            <div className="ms-auto d-flex gap-2 flex-wrap">
              <button className={`btn btn-sm ${llmCopied ? 'btn-success' : 'btn-primary'}`} onClick={handleCopyBetaReport}>
                <i className="bi bi-clipboard-check me-1"/>{llmCopied ? 'Copied!' : 'Copy compact LLM report'}
              </button>
              <button className="btn btn-sm btn-outline-secondary" onClick={handleCopyLLMReport}>
                <i className="bi bi-clipboard me-1"/>Copy full diagnostic
              </button>
            </div>
            <button className="btn btn-sm btn-outline-primary" onClick={downloadOverlay} disabled={!intermediateImages.bubbleOverlay}>
              <i className="bi bi-download me-1"/>Save overlay
            </button>

            <button className="btn btn-sm btn-outline-secondary" onClick={handleReset}>
              <i className="bi bi-arrow-repeat me-1" />Scan Another
            </button>
          </div>

          {copyFailed && <div role="alert" className="alert alert-warning py-2 small mb-3">Clipboard was blocked. Open Share feedback, tap the text area and copy manually.</div>}
          {llmCopied && (
            <div className="alert alert-success py-2 small mb-3">
              <i className="bi bi-check2-circle me-1" />
              <strong>Report copied!</strong> Send it with your original photo and saved overlay. Blur names or identifying QR codes before sharing images.
            </div>
          )}

          <div className={`beta-review-banner mb-3 ${scanResult.overallStatus === 'failed' ? 'beta-review-failed' : reviewCount ? 'beta-review-attention' : 'beta-review-clear'}`}>
            <div>
              <strong>{scanResult.overallStatus === 'failed' ? 'This photo could not be verified' : reviewCount ? `${reviewCount} question(s) need review` : 'Scan complete — please check the answers'}</strong>
              <p className="mb-0 small">{scanResult.overallStatus === 'failed'
                ? 'Try another full-page photo; this result cannot be scored.'
                : 'Green = detected · Red = multiple · Yellow = unclear · Grey = blank. Confirm against the photograph.'}</p>
            </div>
            {scanResult.overallStatus !== 'failed' && <button className="btn btn-sm btn-outline-primary" onClick={() => setActiveTab('table')}>Review answers</button>}
          </div>

          {invalidBlankCount > 0 && (
            <div className="alert alert-info py-2 small d-flex flex-wrap align-items-center gap-2" role="status">
              <i className="bi bi-info-circle" aria-hidden="true" />
              <span><strong>{invalidBlankCount} question(s)</strong> contained incomplete or non-solid markings and were treated as blank under strict SFG rules.</span>
              <button type="button" className="btn btn-sm btn-outline-secondary ms-auto"
                onClick={() => {setActiveTab('table');setReviewFilter('all');}}>
                View all answers
              </button>
            </div>
          )}

          {/* Warnings & errors */}
          {scanResult.warnings.map((w, i) => (
            <div key={i} className="alert alert-warning alert-sm py-2 small mb-2">
              <i className="bi bi-exclamation-circle me-1" />{w}
            </div>
          ))}
          {scanResult.errors.map((e, i) => (
            <div key={i} className="alert alert-danger alert-sm py-2 small mb-2">
              <i className="bi bi-x-circle me-1" />{e}
            </div>
          ))}

          {/* Metadata badges */}
          <div className="row g-2 mb-3">
            <div className="col-auto">
              <span className="badge bg-secondary">Student ID: {scanResult.studentId || 'Not found'}</span>
            </div>
            <div className="col-auto">
              <span className="badge bg-primary">Test ID: {scanResult.testId ? String(scanResult.testId).padStart(2,'0') : 'Not detected'}</span>
            </div>
            <div className="col-auto">
              <span className={`badge ${scanResult.markerCount >= 4 ? 'bg-success' : 'bg-warning text-dark'}`}>
                Alignment: {scanResult.registrationMethod || 'unverified'}
              </span>
            </div>
            <div className="col-auto">
              <span className={`badge ${scanResult.qrValid ? 'bg-success' : 'bg-warning text-dark'}`}>
                QR Code: {scanResult.qrValid ? 'Valid' : 'Not verified'}
              </span>
            </div>
          </div>

          {/* Inspection View Tabs */}
          <div className="card mb-3 shadow-sm">
            <div className="card-header bg-white p-2">
              <ul className="nav nav-pills card-header-pills small">
                <li className="nav-item">
                  <button
                    className={`nav-link py-1 px-3 ${activeTab === 'overlay' ? 'active' : ''}`}
                    onClick={() => setActiveTab('overlay')}
                  >
                    <i className="bi bi-bullseye me-1" />Bubble Detection Overlay
                  </button>
                </li>
                <li className="nav-item">
                  <button
                    className={`nav-link py-1 px-3 ${activeTab === 'markers' ? 'active' : ''}`}
                    onClick={() => setActiveTab('markers')}
                  >
                    <i className="bi bi-crop me-1" />Reference markers
                  </button>
                </li>
                <li className="nav-item">
                  <button
                    className={`nav-link py-1 px-3 ${activeTab === 'table' ? 'active' : ''}`}
                    onClick={() => setActiveTab('table')}
                  >
                    <i className="bi bi-clipboard-check me-1" />Review answers {reviewCount > 0 && <span className="review-nav-count">{reviewCount}</span>}
                  </button>
                </li>
                <li className="nav-item ms-auto">
                  <button
                    className={`nav-link py-1 px-3 ${activeTab === 'llm' ? 'active' : ''}`}
                    onClick={() => setActiveTab('llm')}
                  >
                    <i className="bi bi-robot me-1" />Share feedback
                  </button>
                </li>
              </ul>
            </div>

            <div className="card-body p-3">
              {/* Tab 1: Bubble Overlay */}
              {activeTab === 'overlay' && (
                <div className="text-center">
                  <div className="d-flex justify-content-between align-items-center mb-2 small text-muted">
                    <span>
                      <span className="text-success fw-bold">● Green:</span> Detected &nbsp;|&nbsp;
                      <span className="text-danger fw-bold">● Red:</span> Multiple &nbsp;|&nbsp;
                      <span className="text-warning text-dark fw-bold">● Yellow:</span> Uncertain &nbsp;|&nbsp;
                      <span className="text-secondary">○ Grey:</span> Blank
                    </span>
                    <span>Scroll / zoom to inspect bubble alignment</span>
                  </div>
                  {intermediateImages.bubbleOverlay ? (
                    <div style={{ maxHeight: '600px', overflow: 'auto' }} className="border rounded bg-dark p-2">
                      <img src={intermediateImages.bubbleOverlay} alt="Bubble Overlay" className="img-fluid" style={{ maxWidth: '100%' }} />
                    </div>
                  ) : (
                    <div className="alert alert-secondary small mb-0">Overlay not available for this scan.</div>
                  )}
                </div>
              )}

              {/* Tab 2: Detected Markers on Original Image */}
              {activeTab === 'markers' && (
                <div className="text-center">
                  <p className="small text-muted mb-2">
                    Highlighted reference points used to align your original photograph:
                  </p>
                  {intermediateImages.markerOverlay ? (
                    <div style={{ maxHeight: '600px', overflow: 'auto' }} className="border rounded bg-dark p-2">
                      <img src={intermediateImages.markerOverlay} alt="Marker Overlay" className="img-fluid" style={{ maxWidth: '100%' }} />
                    </div>
                  ) : (
                    <div className="alert alert-secondary small mb-0">Marker overlay not available.</div>
                  )}
                </div>
              )}

              {/* Tab 3: Review-first answer table. Complete answers are visible on demand. */}
              {activeTab === 'table' && (
                <section className="review-workspace" aria-label="Answer review">
                  <div className="review-summary">
                    <div>
                      <h5 className="mb-1 fw-bold">Review your answers</h5>
                      <p className="mb-0">Only questions that need attention appear by default. You can inspect all 50 at any time.</p>
                    </div>
                    <div className="review-summary-counts" aria-live="polite">
                      <span className="review-count-pill resolved"><i className="bi bi-check-circle me-1" />{resolvedCount} resolved</span>
                      <span className="review-count-pill flagged"><i className="bi bi-exclamation-circle me-1" />{reviewCount} to review</span>
                    </div>
                  </div>
                  <div className="review-filter-bar" role="group" aria-label="Filter reviewed answers">
                    <button type="button" aria-pressed={reviewFilter === 'flagged'}
                      className={`review-filter-btn ${reviewFilter === 'flagged' ? 'active' : ''}`}
                      onClick={() => setReviewFilter('flagged')}>
                      <i className="bi bi-flag me-1" /> Needs review ({reviewCount})
                    </button>
                    <button type="button" aria-pressed={reviewFilter === 'all'}
                      className={`review-filter-btn ${reviewFilter === 'all' ? 'active' : ''}`}
                      onClick={() => setReviewFilter('all')}>
                      <i className="bi bi-grid-3x3-gap me-1" /> All questions ({scanResult.answers.length})
                    </button>
                  </div>
                  {!hasAnswers ? (
                    <div className="review-empty-state">No answers could be processed.</div>
                  ) : reviewFilter === 'flagged' && reviewCount === 0 ? (
                    <div className="review-empty-state">
                      <i className="bi bi-check-circle-fill" aria-hidden="true" />
                      <strong>No questions need review</strong>
                      <span>Every question is resolved. Check the full sheet if you want to double-check.</span>
                      <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => setReviewFilter('all')}>View all answers</button>
                    </div>
                  ) : (
                    <div className="table-responsive answer-grid-table">
                      <table className="table review-answer-table mb-0">
                        <thead><tr><th scope="col">Question</th><th scope="col">Reading</th><th scope="col">Status</th><th scope="col">Confidence</th><th scope="col">Confirm or change answer</th></tr></thead>
                        <tbody>
                          {visibleAnswers.map(answer => {
                            const flagged = needsReview(answer);
                            return (
                              <tr key={answer.question} className={flagged ? 'review-answer-flagged' : 'review-answer-resolved'}>
                                <th scope="row" className="review-question-number">Q{String(answer.question).padStart(2,'0')}</th>
                                <td className="review-current-answer">{answer.detectedAnswer || '—'}</td>
                                <td><span className={`review-status-pill ${answer.status}`}>
                                  {flagged && <i className="bi bi-exclamation-circle me-1" />}
                                  {answer.isManuallyEdited ? 'Confirmed' : answer.status}
                                </span></td>
                                <td className="review-confidence">{answer.confidence.toFixed(0)}%</td>
                                <td>
                                  <div className="review-answer-actions" role="group" aria-label={`Set answer for question ${answer.question}`}>
                                    {(['A','B','C','D'] as AnswerOption[]).map(opt => (
                                      <button key={opt} type="button"
                                        aria-label={`Question ${answer.question}: set ${opt}`}
                                        aria-pressed={answer.detectedAnswer === opt}
                                        className={`review-choice ${answer.detectedAnswer === opt ? 'selected' : ''}`}
                                        onClick={() => updateAnswer(answer.question,opt)}>{opt}</button>
                                    ))}
                                    <button type="button" aria-label={`Question ${answer.question}: mark blank`}
                                      aria-pressed={answer.status === 'blank'}
                                      className={`review-choice review-blank-choice ${answer.status === 'blank' ? 'selected' : ''}`}
                                      onClick={() => updateAnswer(answer.question,null)}>Blank</button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="review-help-text"><i className="bi bi-info-circle me-1" />
                    A tick, slash, dot, crescent or incomplete fill is blank under SFG rules. Only uncertain, multiple or error readings require review.
                    Changes are saved in this scan.
                  </p>
                </section>
              )}

              {/* Tab 4: LLM Prompt Format */}
              {activeTab === 'llm' && (
                <div>
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <span className="small text-muted">
                      {showTechnicalReport ? 'Complete detailed report (larger):' : 'Compact report (low tokens) — send with your OMR photo:'}
                    </span>
                    <div className="d-flex gap-2 flex-wrap">
                      <button className="btn btn-sm btn-outline-secondary" onClick={() => setShowTechnicalReport(v => !v)}>
                        {showTechnicalReport ? 'Compact preview' : 'Full technical preview'}
                      </button>
                      <button className="btn btn-sm btn-primary" onClick={showTechnicalReport ? handleCopyLLMReport : handleCopyBetaReport}>
                        <i className="bi bi-clipboard me-1"/>{llmCopied ? 'Copied!' : showTechnicalReport ? 'Copy full diagnostic' : 'Copy compact report'}
                      </button>
                    </div>
                  </div>
                  <textarea
                    className="form-control font-monospace small bg-light"
                    rows={12}
                    readOnly
                    value={showTechnicalReport ? llmReportPreview : betaReportPreview}
                    onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                    style={{ fontSize: '0.75rem', lineHeight: '1.3' }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Submission bar */}
          {hasAnswers && (
            <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
              <button className="btn btn-success btn-lg" onClick={handleSubmit} disabled={!practice.activeTest || scanResult.overallStatus === 'failed'}>
                <i className="bi bi-check-circle me-2" />Submit & Score
              </button>
              {scanResult.overallStatus === 'failed' && <span className="text-danger small">Scan validation failed — rescan before scoring.</span>}
              {!practice.activeTest && (
                <span className="text-danger small">
                  <i className="bi bi-info-circle me-1" />
                  No test needed to inspect a scan. Create a practice test only if you want scoring.
                </span>
              )}
            </div>
          )}

          {submitError && <div className="alert alert-danger">{submitError}</div>}

          {/* Diagnostic Log Box if any warning/error or missing answers */}
          {hasErrorsOrWarnings && (
            <div className="mt-3">
              <ErrorLogBox
                title="Diagnostic Report (Copy & Send)"
                errorMessage={scanResult.errors.join('; ') || (hasAnswers ? null : 'Answers could not be extracted')}
                scanResult={scanResult}
                file={capturedFile}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
