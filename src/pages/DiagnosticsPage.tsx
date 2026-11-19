import { useState } from 'react';
import type { AppState } from '../App';
import type { LogLevel, AnswerOption } from '../types';
import { getSettings, updateSettings, resetSettings } from '../config/scannerSettings';
import { APP_VERSION } from '../config/version';
import { logger } from '../diagnostics/diagnosticLogger';
import { buildDiagnosticReport, exportDiagnosticReport } from '../diagnostics/diagnosticReport';
import {
  generateSyntheticSheet,
  evaluateDetection,
  type SyntheticScenario,
  type BenchmarkReport,
  type GroundTruth,
} from '../testing/syntheticGenerator';
import { runFullScan } from '../scanner/scanOrchestrator';

interface Props { appState: AppState; }

export default function DiagnosticsPage({ appState }: Props) {
  const { opencv, scanning } = appState;
  const { scanResult, intermediateImages } = scanning;
  const [settings, setSettings] = useState(getSettings());
  const [logFilter, setLogFilter] = useState<LogLevel | 'ALL'>('ALL');
  const [logSearch, setLogSearch] = useState('');
  const [activeStage, setActiveStage] = useState<string>('original');
  const [logs, setLogs] = useState(logger.getAll());

  // Synthetic Benchmark State
  const [benchmarkScenario, setBenchmarkScenario] = useState<SyntheticScenario>('perfect');
  const [benchmarking, setBenchmarking] = useState(false);
  const [benchmarkResult, setBenchmarkResult] = useState<BenchmarkReport | null>(null);
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null);

  const refreshLogs = () => setLogs(logger.getAll());

  const handleSettingChange = (key: string, value: number | boolean) => {
    updateSettings({ [key]: value } as any);
    setSettings(getSettings());
  };

  const handleReset = () => { resetSettings(); setSettings(getSettings()); };

  const runSyntheticBenchmark = async (scenario: SyntheticScenario) => {
    setBenchmarking(true);
    setBenchmarkError(null);
    setBenchmarkResult(null);

    try {
      // 1. Create Ground Truth with known answers
      const sampleOptions: AnswerOption[] = ['A', 'B', 'C', 'D'];
      const answers: (AnswerOption | null | 'MULTIPLE')[] = Array.from({ length: 50 }, (_, i) => {
        if (scenario === 'blank') return null;
        if (scenario === 'multiple_marks' && (i === 4 || i === 12 || i === 24)) return 'MULTIPLE';
        return sampleOptions[i % 4];
      });

      const groundTruth: GroundTruth = {
        testId: 24,
        studentId: 'DEMO-STUDENT-0001',
        answers,
      };

      // 2. Generate Canvas & File
      const canvas = generateSyntheticSheet(scenario, groundTruth, settings.scanDpi);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
      const file = new File([blob], `synthetic-${scenario}.png`, { type: 'image/png' });

      // 3. Run Scanning Engine
      const startTime = Date.now();
      const { result } = await runFullScan(file);
      const latencyMs = Date.now() - startTime;

      // 4. Evaluate against Ground Truth
      const report = evaluateDetection(
        result.answers,
        result.testId,
        groundTruth,
        result.markerCount,
        scenario,
        latencyMs
      );
      setBenchmarkResult(report);
      refreshLogs();
    } catch (err: any) {
      setBenchmarkError(err.message || 'Benchmark failed');
    } finally {
      setBenchmarking(false);
    }
  };

  const filteredLogs = logs
    .filter(l => logFilter === 'ALL' || l.level === logFilter)
    .filter(l => !logSearch || l.message.toLowerCase().includes(logSearch.toLowerCase()));

  const stages = [
    { key: 'original', label: 'Original' },
    { key: 'grayscale', label: 'Grayscale' },
    { key: 'thresholded', label: 'Thresholded' },
    { key: 'perspectiveCorrected', label: 'Corrected' },
  ];

  const hasCamera = !!(navigator.mediaDevices?.getUserMedia);

  const NumberInput = ({ label, settingKey, min, max, step = 1 }: { label: string; settingKey: string; min: number; max: number; step?: number }) => (
    <div className="mb-3">
      <label className="form-label small fw-semibold">{label}</label>
      <div className="d-flex gap-2 align-items-center">
        <input type="range" className="form-range flex-grow-1"
          min={min} max={max} step={step}
          value={(settings as any)[settingKey]}
          onChange={e => handleSettingChange(settingKey, parseFloat(e.target.value))}
        />
        <span className="badge bg-secondary" style={{ minWidth: 40 }}>
          {(settings as any)[settingKey]}
        </span>
      </div>
    </div>
  );

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between mb-3 border-bottom pb-2">
        <div>
          <h2 className="mb-0 fw-bold">Diagnostics Lab</h2>
          <small className="text-muted">Algorithm Calibration & Synthetic Benchmarking Lab</small>
        </div>
        <span className="badge bg-primary px-3 py-2 fs-6 shadow-sm">
          <i className="bi bi-cpu me-1" />{APP_VERSION}
        </span>
      </div>

      {/* A: Engine Status */}
      <div className="card mb-4">
        <div className="card-header fw-semibold">A — Engine Status</div>
        <div className="card-body">
          <div className="row g-2">
            {[
              { label: 'OpenCV.js', ok: opencv === 'ready', detail: opencv },
              { label: 'jsQR Decoder', ok: true, detail: 'loaded' },
              { label: 'Camera', ok: hasCamera, detail: hasCamera ? 'available' : 'not available' },
              { label: 'Image Loaded', ok: !!scanResult, detail: scanResult ? `${scanResult.processingTimeMs}ms` : 'none' },
              { label: 'QR Decoded', ok: !!scanResult?.qrValid, detail: scanResult?.qrRaw || '—' },
              { label: 'Markers', ok: (scanResult?.markerCount ?? 0) >= 4, detail: `${scanResult?.markerCount ?? 0}/4` },
              { label: 'Browser', ok: true, detail: navigator.userAgent.split(' ').slice(-1)[0] },
            ].map(({ label, ok, detail }) => (
              <div key={label} className="col-6 col-md-4 col-lg-3">
                <div className="p-2 border rounded" style={{ background: '#fff' }}>
                  <div className="d-flex align-items-center">
                    <span className={`status-dot ${ok ? 'ok' : 'fail'}`} />
                    <span className="fw-semibold small">{label}</span>
                  </div>
                  <div className="text-muted" style={{ fontSize: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* B: Synthetic Benchmark Suite (NEW) */}
      <div className="card mb-4 border-primary">
        <div className="card-header bg-primary text-white fw-semibold d-flex justify-content-between align-items-center">
          <span><i className="bi bi-speedometer2 me-2" />B — Synthetic Testing & Accuracy Benchmark</span>
          <span className="badge bg-light text-primary">Requirement 13</span>
        </div>
        <div className="card-body">
          <p className="small text-muted mb-3">
            Evaluate the OpenCV scanning pipeline against synthetic ground truth sheets with controlled distortions.
          </p>
          <div className="row g-3 align-items-center mb-3">
            <div className="col-md-5">
              <label className="form-label small fw-semibold">Select Test Scenario:</label>
              <select
                className="form-select form-select-sm"
                value={benchmarkScenario}
                onChange={(e) => setBenchmarkScenario(e.target.value as SyntheticScenario)}
                disabled={benchmarking}
              >
                <option value="perfect">1. Perfectly Aligned Sheet (Baseline)</option>
                <option value="faint_marks">2. Faint Marks / Light Pencil (Low Density)</option>
                <option value="multiple_marks">3. Multiple / Over-marked Selections</option>
                <option value="blank">4. Completely Blank Sheet</option>
                <option value="mild_shadows">5. Mild Shadow Gradient Across Page</option>
                <option value="slightly_rotated">6. Slightly Rotated (~1.8° tilt)</option>
                <option value="missing_marker">7. Missing Registration Marker (Fault Tolerance)</option>
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label d-block small">&nbsp;</label>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => runSyntheticBenchmark(benchmarkScenario)}
                disabled={benchmarking || opencv !== 'ready'}
              >
                {benchmarking ? (
                  <><span className="spinner-border spinner-border-sm me-2" />Running Benchmark…</>
                ) : (
                  <><i className="bi bi-play-circle me-1" />Run Synthetic Benchmark</>
                )}
              </button>
            </div>
          </div>

          {benchmarkError && (
            <div className="alert alert-danger py-2 small mb-3">
              <i className="bi bi-exclamation-triangle me-2" />{benchmarkError}
            </div>
          )}

          {benchmarkResult && (
            <div className="border rounded p-3 bg-light">
              <h6 className="fw-bold mb-3 d-flex align-items-center">
                <i className="bi bi-clipboard-data me-2 text-primary" />
                Benchmark Results — Scenario: <code>{benchmarkResult.scenario}</code>
              </h6>
              <div className="row g-2 text-center mb-3">
                <div className="col-4 col-md-2">
                  <div className="p-2 border rounded bg-white">
                    <div className="fs-5 fw-bold text-primary">{benchmarkResult.overallAccuracy}%</div>
                    <small className="text-muted" style={{ fontSize: '0.65rem' }}>Overall Accuracy</small>
                  </div>
                </div>
                <div className="col-4 col-md-2">
                  <div className="p-2 border rounded bg-white">
                    <div className="fs-5 fw-bold text-success">{benchmarkResult.filledAccuracy}%</div>
                    <small className="text-muted" style={{ fontSize: '0.65rem' }}>Filled Accuracy</small>
                  </div>
                </div>
                <div className="col-4 col-md-2">
                  <div className="p-2 border rounded bg-white">
                    <div className="fs-5 fw-bold text-info">{benchmarkResult.blankAccuracy}%</div>
                    <small className="text-muted" style={{ fontSize: '0.65rem' }}>Blank Accuracy</small>
                  </div>
                </div>
                <div className="col-4 col-md-2">
                  <div className="p-2 border rounded bg-white">
                    <div className="fs-5 fw-bold">{benchmarkResult.correctDetections} / 50</div>
                    <small className="text-muted" style={{ fontSize: '0.65rem' }}>Correct (Q)</small>
                  </div>
                </div>
                <div className="col-4 col-md-2">
                  <div className="p-2 border rounded bg-white">
                    <div className={`fs-5 fw-bold ${benchmarkResult.testIdMatched ? 'text-success' : 'text-danger'}`}>
                      {benchmarkResult.testIdMatched ? 'Matched' : 'Mismatch'}
                    </div>
                    <small className="text-muted" style={{ fontSize: '0.65rem' }}>Test ID (24)</small>
                  </div>
                </div>
                <div className="col-4 col-md-2">
                  <div className="p-2 border rounded bg-white">
                    <div className="fs-5 fw-bold text-secondary">{benchmarkResult.latencyMs}ms</div>
                    <small className="text-muted" style={{ fontSize: '0.65rem' }}>Latency</small>
                  </div>
                </div>
              </div>
              <div className="small text-muted">
                <strong>Metrics breakdown:</strong> 200 total bubbles tested (50 questions × 4 options).
                Markers detected: <strong>{benchmarkResult.markersDetected}/4</strong>.
                Incorrect detections: <strong>{benchmarkResult.incorrectDetections}</strong>.
                Uncertain detections: <strong>{benchmarkResult.uncertainDetections}</strong>.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* C: Image Processing Stages */}
      {intermediateImages && Object.keys(intermediateImages).length > 0 && (
        <div className="card mb-4">
          <div className="card-header fw-semibold">C — Image Processing Stages</div>
          <div className="card-body">
            <div className="btn-group mb-3 flex-wrap" role="group">
              {stages.map(s => (
                <button key={s.key}
                  className={`btn btn-sm ${activeStage === s.key ? 'btn-primary' : 'btn-outline-secondary'}`}
                  onClick={() => setActiveStage(s.key)}
                  disabled={!(intermediateImages as any)[s.key]}
                >{s.label}</button>
              ))}
            </div>
            <div className="stage-preview text-center">
              {(intermediateImages as any)[activeStage]
                ? <img src={(intermediateImages as any)[activeStage]} alt={activeStage} style={{ maxHeight: 500 }} />
                : <span className="text-muted">No image for this stage</span>
              }
            </div>
          </div>
        </div>
      )}

      {/* D: Bubble Measurements */}
      {scanResult && (
        <div className="card mb-4">
          <div className="card-header fw-semibold">D — Bubble Detection Details</div>
          <div className="card-body p-0">
            <div className="table-responsive" style={{ maxHeight: 400 }}>
              <table className="table table-sm table-bordered mb-0" style={{ fontSize: '0.75rem' }}>
                <thead className="sticky-top bg-white">
                  <tr>
                    <th>Q</th><th>A%</th><th>B%</th><th>C%</th><th>D%</th>
                    <th>Answer</th><th>Status</th><th>Conf.</th>
                  </tr>
                </thead>
                <tbody>
                  {scanResult.answers.map(a => (
                    <tr key={a.question} className={a.status === 'multiple' ? 'table-danger' : a.status === 'uncertain' ? 'table-warning' : ''}>
                      <td className="fw-bold">{a.question}</td>
                      {a.measurements.map((m, i) => (
                        <td key={i} className={a.detectedAnswer === m.option ? 'fw-bold text-success' : ''}>
                          {m.fillPercent.toFixed(1)}
                        </td>
                      ))}
                      {a.measurements.length === 0 && <td colSpan={4} className="text-muted">—</td>}
                      <td className="fw-bold">{a.detectedAnswer || '—'}</td>
                      <td>{a.status}</td>
                      <td>{a.confidence.toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* E: Scanner Parameters */}
      <div className="card mb-4">
        <div className="card-header fw-semibold d-flex justify-content-between">
          E — Scanner Parameters (Experimental tuning)
          <button className="btn btn-sm btn-outline-secondary" onClick={handleReset}>Reset Defaults</button>
        </div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-6">
              <NumberInput label="Gaussian Blur Kernel (must be odd)" settingKey="gaussianBlurKsize" min={1} max={21} step={2} />
              <NumberInput label="Adaptive Threshold Block Size (must be odd)" settingKey="adaptiveThreshBlockSize" min={3} max={51} step={2} />
              <NumberInput label="Adaptive Threshold C" settingKey="adaptiveThreshC" min={1} max={30} />
            </div>
            <div className="col-md-6">
              <NumberInput label="Bubble Fill Threshold (%)" settingKey="bubbleFillThreshold" min={5} max={80} />
              <NumberInput label="Min Difference for Detection (%)" settingKey="bubbleMinDifference" min={2} max={40} />
              <NumberInput label="Uncertain Detection Threshold (%)" settingKey="bubbleUncertainThreshold" min={2} max={40} />
              <NumberInput label="Scan DPI" settingKey="scanDpi" min={72} max={300} step={6} />
            </div>
          </div>
          <div className="alert alert-info small mb-0 mt-2">
            Adjust thresholds and re-run a scan to test sensitivity. Changes apply immediately on the next scan or benchmark.
          </div>
        </div>
      </div>

      {/* F: Debug Log */}
      <div className="card mb-4">
        <div className="card-header fw-semibold d-flex flex-wrap align-items-center gap-2">
          F — Structured Debug Log
          <button className="btn btn-sm btn-outline-secondary ms-auto" onClick={refreshLogs}>Refresh</button>
          <button className="btn btn-sm btn-outline-danger" onClick={() => { logger.clear(); setLogs([]); }}>Clear</button>
          <button className="btn btn-sm btn-outline-primary" onClick={() => {
            const blob = new Blob([logger.exportTxt()], { type: 'text/plain' });
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
            a.download = 'sfg-omr-log.txt'; a.click();
          }}>Export TXT</button>
          <button className="btn btn-sm btn-outline-primary" onClick={() => {
            const blob = new Blob([logger.exportJson()], { type: 'application/json' });
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
            a.download = 'sfg-omr-log.json'; a.click();
          }}>Export JSON</button>
        </div>
        <div className="card-body">
          <div className="row g-2 mb-2">
            <div className="col-auto">
              <select className="form-select form-select-sm" value={logFilter}
                onChange={e => setLogFilter(e.target.value as any)}>
                <option value="ALL">All Levels</option>
                {(['DEBUG','INFO','WARNING','ERROR'] as LogLevel[]).map(l =>
                  <option key={l} value={l}>{l}</option>
                )}
              </select>
            </div>
            <div className="col">
              <input className="form-control form-control-sm" placeholder="Search logs…"
                value={logSearch} onChange={e => setLogSearch(e.target.value)} />
            </div>
          </div>
          <div style={{ maxHeight: 300, overflow: 'auto' }}>
            <table className="table table-sm log-table mb-0">
              <thead><tr><th>Time</th><th>Level</th><th>Stage</th><th>Message</th></tr></thead>
              <tbody>
                {filteredLogs.length === 0 && (
                  <tr><td colSpan={4} className="text-muted text-center">No logs</td></tr>
                )}
                {filteredLogs.map(l => (
                  <tr key={l.id} className={`log-${l.level}`}>
                    <td>{new Date(l.timestamp).toLocaleTimeString()}</td>
                    <td>{l.level}</td>
                    <td>{l.stage}</td>
                    <td>{l.message}{l.data ? ' — ' + JSON.stringify(l.data) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* G: Export Diagnostic Report */}
      {scanResult && (
        <div className="card mb-4">
          <div className="card-header fw-semibold">G — Export Diagnostic Report</div>
          <div className="card-body">
            <button className="btn btn-outline-primary" onClick={() => {
              const report = buildDiagnosticReport({
                imageWidth: 0, imageHeight: 0,
                markerResult: { found: scanResult.markerCount >= 4, count: scanResult.markerCount,
                  topLeft: null, topRight: null, bottomLeft: null, bottomRight: null, validGeometry: scanResult.perspectiveCorrected },
                qrRaw: scanResult.qrRaw,
                qrValid: scanResult.qrValid,
                detectedTestId: scanResult.testId,
                answers: scanResult.answers,
                processingTimeMs: scanResult.processingTimeMs,
              });
              exportDiagnosticReport(report);
            }}>
              <i className="bi bi-file-earmark-json me-2" />Export Diagnostic JSON
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
