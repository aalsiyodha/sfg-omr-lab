import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AppState } from '../App';
import type { AnswerOption } from '../types';
import { ErrorLogBox } from '../components/ErrorLogBox';
import { generateLLMDiagnosticPrompt } from '../diagnostics/llmPromptGenerator';
import { APP_VERSION, APP_BUILD_NAME } from '../config/version';

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
  const [activeTab, setActiveTab] = useState<ResultViewTab>('overlay');
  const [llmCopied, setLlmCopied] = useState(false);

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
    setLlmCopied(false);
  };

  const handleCopyLLMReport = async () => {
    if (!scanResult) return;
    const reportText = generateLLMDiagnosticPrompt({
      scanResult,
      file: capturedFile,
      activeTestId: practice.activeTest?.testId,
      answerKey: practice.activeTest?.answerKey,
    });
    try {
      await navigator.clipboard.writeText(reportText);
      setLlmCopied(true);
      setTimeout(() => setLlmCopied(false), 3500);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = reportText;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setLlmCopied(true);
      setTimeout(() => setLlmCopied(false), 3500);
    }
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
      <div className="d-flex align-items-center justify-content-between mb-3 border-bottom pb-2">
        <div>
          <h2 className="mb-0">Scan OMR Sheet</h2>
          <small className="text-muted">{APP_BUILD_NAME}</small>
        </div>
        <span className="badge bg-primary px-3 py-2 fs-6 shadow-sm">
          <i className="bi bi-cpu me-1" />{APP_VERSION}
        </span>
      </div>

      {opencv !== 'ready' && (
        <div className={`alert alert-${opencv === 'loading' ? 'warning' : 'danger'} mb-3`}>
          <i className="bi bi-exclamation-triangle me-2" />
          OpenCV is {opencv === 'loading' ? 'still loading — please wait a moment…' : 'not available. Please refresh the page.'}
        </div>
      )}

      {/* Input section (hidden once scan result exists) */}
      {!scanResult && (
        <div className="row g-3">
          <div className="col-12">
            <div className="d-flex flex-wrap gap-2 mb-2">
              <button className="btn btn-primary" onClick={triggerNativeCamera} disabled={isScanning}>
                <i className="bi bi-camera-fill me-2" />Take Photo (Camera + Flash)
              </button>
              <button className="btn btn-outline-primary" onClick={() => fileInputRef.current?.click()} disabled={isScanning}>
                <i className="bi bi-upload me-2" />Upload Image
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
                accept=".jpg,.jpeg,.png,image/*"
                hidden
                onChange={handleFileChange}
              />
            </div>
            <small className="text-muted d-block mb-3">
              <i className="bi bi-lightning-charge me-1 text-warning" />
              <strong>Tip for Mobile:</strong> Use <strong>"Take Photo"</strong> to open your phone's native camera with forced hardware flash for crisp bubble shadows.
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
                <div className="scanner-viewport">
                  <div className="scanner-laser-line" />
                  <div className="viewport-grid">
                    {[1, 2, 3, 4, 5, 6, 7].map(r => (
                      <div className="grid-row-mock" key={r}>
                        <span className={`grid-dot-mock ${r % 3 === 0 ? 'filled' : ''}`} />
                        <span className={`grid-dot-mock ${r % 2 === 1 ? 'filled' : ''}`} />
                        <span className={`grid-dot-mock ${r % 4 === 0 ? 'filled' : ''}`} />
                        <span className="grid-dot-mock" />
                      </div>
                    ))}
                  </div>
                </div>

                <h5 className="fw-bold mb-1" style={{ color: 'var(--text-main)' }}>
                  Evaluating OMR Sheet (Dual-Pass Engine)
                </h5>
                <p className="text-muted small mb-3">
                  {progress?.stage || 'Meticulously double-checking answers and symmetry…'}
                </p>

                <div className="progress mb-3" style={{ height: 6, maxWidth: 440, margin: '0 auto' }}>
                  <div
                    className="progress-bar progress-bar-striped progress-bar-animated"
                    style={{ width: `${progress?.percent || 20}%`, backgroundColor: 'var(--primary)' }}
                  />
                </div>

                <div className="scan-stages-checklist">
                  <div className={`scan-stage-item ${(progress?.percent || 0) >= 30 ? 'completed' : (progress?.percent || 0) >= 10 ? 'active' : ''}`}>
                    <span className="scan-stage-icon">
                      {(progress?.percent || 0) >= 30 ? <i className="bi bi-check-circle-fill text-success" /> : <span className="spinner-border spinner-border-sm" />}
                    </span>
                    <span>1. Registration Markers & Page Homography</span>
                  </div>
                  <div className={`scan-stage-item ${(progress?.percent || 0) >= 60 ? 'completed' : (progress?.percent || 0) >= 30 ? 'active' : ''}`}>
                    <span className="scan-stage-icon">
                      {(progress?.percent || 0) >= 60 ? <i className="bi bi-check-circle-fill text-success" /> : (progress?.percent || 0) >= 30 ? <span className="spinner-border spinner-border-sm" /> : <i className="bi bi-circle text-muted" />}
                    </span>
                    <span>2. Student QR Identity & Test ID Calibration</span>
                  </div>
                  <div className={`scan-stage-item ${(progress?.percent || 0) >= 80 ? 'completed' : (progress?.percent || 0) >= 60 ? 'active' : ''}`}>
                    <span className="scan-stage-icon">
                      {(progress?.percent || 0) >= 80 ? <i className="bi bi-check-circle-fill text-success" /> : (progress?.percent || 0) >= 60 ? <span className="spinner-border spinner-border-sm" /> : <i className="bi bi-circle text-muted" />}
                    </span>
                    <span>3. Pass 1: Bubble Darkness Matrix Sweep</span>
                  </div>
                  <div className={`scan-stage-item ${(progress?.percent || 0) >= 100 ? 'completed' : (progress?.percent || 0) >= 80 ? 'active' : ''}`}>
                    <span className="scan-stage-icon">
                      {(progress?.percent || 0) >= 100 ? <i className="bi bi-check-circle-fill text-success" /> : (progress?.percent || 0) >= 80 ? <span className="spinner-border spinner-border-sm text-primary" /> : <i className="bi bi-circle text-muted" />}
                    </span>
                    <span>4. Pass 2: Double-Check Symmetry (Rejects Slashes & Crescents)</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {!isScanning && previewUrl && (
            <div className="col-12 col-md-8 col-lg-6">
              <p className="fw-semibold mb-1">Image Preview:</p>
              <img src={previewUrl} alt="Preview" className="img-fluid border rounded mb-2" style={{ maxHeight: 420 }} />
              <div className="d-flex gap-2">
                <button className="btn btn-primary" onClick={handleScan} disabled={isScanning || opencv !== 'ready'}>
                  <i className="bi bi-cpu me-2" />Scan Sheet (Dual-Pass Engine)
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

            <button
              className={`btn btn-sm ${llmCopied ? 'btn-success text-white' : 'btn-primary'} ms-auto`}
              onClick={handleCopyLLMReport}
            >
              <i className={`bi ${llmCopied ? 'bi-check-circle-fill' : 'bi-clipboard-data'} me-1`} />
              {llmCopied ? 'Copied! Paste to ChatGPT / Chat' : '📋 Copy LLM Debug Report (ChatGPT / Claude)'}
            </button>

            <button className="btn btn-sm btn-outline-secondary" onClick={handleReset}>
              <i className="bi bi-arrow-repeat me-1" />Scan Another
            </button>
          </div>

          {llmCopied && (
            <div className="alert alert-success py-2 small mb-3">
              <i className="bi bi-check2-circle me-1" />
              <strong>Report Copied!</strong> Paste it directly into ChatGPT, Claude, or this chat window so the LLM can analyze the exact bubble darkness values and geometry.
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
                Corner Markers: {scanResult.markerCount}/4
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
                    <i className="bi bi-crop me-1" />Corner Markers View
                  </button>
                </li>
                <li className="nav-item">
                  <button
                    className={`nav-link py-1 px-3 ${activeTab === 'table' ? 'active' : ''}`}
                    onClick={() => setActiveTab('table')}
                  >
                    <i className="bi bi-table me-1" />Answer Table (Edit)
                  </button>
                </li>
                <li className="nav-item ms-auto">
                  <button
                    className={`nav-link py-1 px-3 ${activeTab === 'llm' ? 'active' : ''}`}
                    onClick={() => setActiveTab('llm')}
                  >
                    <i className="bi bi-robot me-1" />LLM Prompt Format
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
                    Cyan boxes indicate where OpenCV located the 4 registration markers on your original photograph:
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

              {/* Tab 3: Answer Grid Table */}
              {activeTab === 'table' && (
                <div>
                  {hasAnswers ? (
                    <div className="table-responsive answer-grid-table">
                      <table className="table table-sm table-bordered mb-0" style={{ fontSize: '0.8rem' }}>
                        <thead>
                          <tr className="table-light">
                            <th>Q</th><th>Det.</th><th>Status</th><th>Conf.</th><th>Edit</th>
                            <th>Q</th><th>Det.</th><th>Status</th><th>Conf.</th><th>Edit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Array.from({length: 25}, (_, i) => i).map(i => {
                            const left = scanResult.answers[i];
                            const right = scanResult.answers[i + 25];
                            const renderRow = (a: typeof left) => {
                              if (!a) return <td colSpan={5} className="text-muted">—</td>;
                              return (
                                <>
                                  <td className="fw-bold">{a.question}</td>
                                  <td className="fw-bold" style={{ color: a.isManuallyEdited ? 'var(--accent)' : undefined }}>
                                    {a.detectedAnswer || '—'}
                                  </td>
                                  <td>
                                    <span className={`badge ${
                                      a.status==='detected' ? 'bg-success' :
                                      a.status==='multiple' ? 'bg-danger' :
                                      a.status==='uncertain' ? 'bg-warning text-dark' : 'bg-secondary'
                                    }`} style={{ fontSize: '0.65rem' }}>{a.status}</span>
                                  </td>
                                  <td>{a.confidence.toFixed(0)}%</td>
                                  <td>
                                    <div className="d-flex gap-1">
                                      {(['A','B','C','D'] as AnswerOption[]).map(opt => (
                                        <button key={opt}
                                          className={`btn btn-xs ${a.detectedAnswer === opt ? 'btn-primary' : 'btn-outline-secondary'}`}
                                          style={{ padding: '1px 5px', fontSize: '0.65rem' }}
                                          onClick={() => updateAnswer(a.question, opt)}
                                        >{opt}</button>
                                      ))}
                                      <button className="btn btn-xs btn-outline-secondary"
                                        style={{ padding: '1px 5px', fontSize: '0.65rem' }}
                                        onClick={() => updateAnswer(a.question, null)}
                                      >—</button>
                                    </div>
                                  </td>
                                </>
                              );
                            };
                            return (
                              <tr key={i}>
                                {renderRow(left)}
                                {right && renderRow(right)}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="alert alert-warning small mb-0">No answer answers could be processed.</div>
                  )}
                </div>
              )}

              {/* Tab 4: LLM Prompt Format */}
              {activeTab === 'llm' && (
                <div>
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <span className="small text-muted">
                      Full structured report ready to copy and send to ChatGPT, Claude, or any LLM:
                    </span>
                    <button className="btn btn-sm btn-primary" onClick={handleCopyLLMReport}>
                      <i className={`bi ${llmCopied ? 'bi-check' : 'bi-clipboard'} me-1`} />
                      {llmCopied ? 'Copied!' : 'Copy to Clipboard'}
                    </button>
                  </div>
                  <textarea
                    className="form-control font-monospace small bg-light"
                    rows={12}
                    readOnly
                    value={llmReportPreview}
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
                  Please generate a practice test first to enable scoring.
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
