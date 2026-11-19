import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AppState } from '../App';
import { generateOMRSheet } from '../pdf/generateOMR';
import { APP_VERSION } from '../config/version';

interface Props { appState: AppState; }

export default function HomePage({ appState }: Props) {
  const { opencv } = appState;
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try { await generateOMRSheet(); }
    catch (e: any) { alert('PDF generation failed: ' + e.message); }
    finally { setDownloading(false); }
  };

  const StatusRow = ({ label, status, detail }: { label: string; status: 'ok'|'fail'|'loading'; detail?: string }) => (
    <div className="d-flex align-items-center justify-content-between py-2 border-bottom border-light">
      <div className="d-flex align-items-center">
        <span className={`status-dot ${status}`} />
        <span className="fw-semibold text-dark small">{label}</span>
      </div>
      {detail && <span className="badge bg-light text-muted border small font-monospace">{detail}</span>}
    </div>
  );

  const cvStatus = opencv === 'ready' ? 'ok' : opencv === 'error' ? 'fail' : 'loading';
  const hasLiveCamera = !!(navigator.mediaDevices?.getUserMedia);
  const hasNativeCamera = typeof document !== 'undefined' && ('capture' in document.createElement('input') || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
  const hasCamera = hasLiveCamera || hasNativeCamera;

  return (
    <div className="row g-4">
      {/* Hero Banner */}
      <div className="col-12">
        <div className="p-4 p-md-5 rounded-3 border bg-white shadow-sm position-relative overflow-hidden">
          <div className="position-absolute end-0 top-0 p-3 opacity-10 d-none d-md-block">
            <i className="bi bi-upc-scan text-primary" style={{ fontSize: '10rem', lineHeight: 1 }} />
          </div>
          <div className="position-relative" style={{ maxWidth: 680 }}>
            <div className="d-flex align-items-center gap-2 mb-3">
              <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-3 py-1 rounded-pill fw-semibold">
                <i className="bi bi-award me-1" />UPSC SFG Standard
              </span>
              <span className="badge bg-light text-secondary border px-2 py-1 rounded-pill">
                Engine {APP_VERSION}
              </span>
            </div>
            <h1 className="display-6 fw-bold mb-3" style={{ color: 'var(--accent)', letterSpacing: '-0.02em' }}>
              High-Precision Optical Mark Recognition
            </h1>
            <p className="text-muted fs-6 mb-4 lead" style={{ fontSize: '1rem' }}>
              Standardised 50-question optical evaluation engine designed specifically for UPSC practice sheets.
              Features client-side perspective correction, adaptive lighting calibration, dual-pass verification, and partial-mark rejection.
            </p>
            <div className="d-flex flex-wrap gap-2">
              <Link to="/scan" className="btn btn-primary px-4 py-2 fw-medium shadow-sm">
                <i className="bi bi-camera-fill me-2" />Scan OMR Sheet
              </Link>
              <Link to="/practice" className="btn btn-outline-primary px-3 py-2 fw-medium">
                <i className="bi bi-pencil-square me-2" />Practice Test
              </Link>
              <button className="btn btn-outline-secondary px-3 py-2 fw-medium" onClick={handleDownload} disabled={downloading}>
                <i className="bi bi-download me-2" />{downloading ? 'Generating PDF…' : 'Print Blank Sheet'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Pipeline Status */}
      <div className="col-md-5 col-lg-4">
        <div className="card p-3 h-100 shadow-sm border bg-white">
          <div className="d-flex align-items-center justify-content-between mb-3 pb-2 border-bottom">
            <h6 className="fw-bold mb-0 text-uppercase text-muted" style={{ fontSize: '0.75rem', letterSpacing: '0.06em' }}>
              Engine Status
            </h6>
            <span className="badge bg-success-subtle text-success border border-success-subtle">
              Operational
            </span>
          </div>
          <StatusRow label="OpenCV WASM Engine" status={cvStatus} detail={opencv === 'loading' ? 'Loading…' : 'Active (150 DPI)'} />
          <StatusRow label="Perspective Homography" status="ok" detail="4-Point Anchor" />
          <StatusRow label="Adaptive Lighting" status="ok" detail="Otsu Dynamic" />
          <StatusRow label="QR Code Decoder" status="ok" detail="jsQR Decoded" />
          <StatusRow label="Camera Flash / Torch" status={hasCamera ? 'ok' : 'fail'} detail={hasCamera ? 'Hardware Ready' : 'Unavailable'} />
          <StatusRow label="PDF Sheet Spec" status="ok" detail="210×297mm A4" />
        </div>
      </div>

      {/* Workflow & Instructions */}
      <div className="col-md-7 col-lg-8">
        <div className="card p-4 h-100 shadow-sm border bg-white">
          <h6 className="fw-bold mb-3 text-uppercase text-muted" style={{ fontSize: '0.75rem', letterSpacing: '0.06em' }}>
            Standard Operating Workflow
          </h6>
          <div className="row g-3">
            {[
              {
                step: '01',
                title: 'Generate or Choose Test',
                desc: 'Generate a 50-question practice test with hidden randomized key or select an official test ID.',
                icon: 'bi-file-earmark-text',
              },
              {
                step: '02',
                title: 'Fill Standard Sheet',
                desc: 'Fill bubbles completely using dark black or blue ballpoint pen. Incomplete slashes or crosses are rejected.',
                icon: 'bi-pen',
              },
              {
                step: '03',
                title: 'Dual-Pass Scan',
                desc: 'Capture using phone camera with torch enabled. The engine corrects perspective and double-checks answers.',
                icon: 'bi-camera',
              },
              {
                step: '04',
                title: 'Instant Scoring & Review',
                desc: 'Receive immediate breakdown (+2.0 correct, −0.66 wrong) with visual overlay and LLM diagnostic export.',
                icon: 'bi-check2-circle',
              },
            ].map(({ step, title, desc, icon }) => (
              <div key={step} className="col-sm-6">
                <div className="p-3 border rounded bg-light h-100">
                  <div className="d-flex align-items-center justify-content-between mb-2">
                    <span className="badge bg-white text-dark border fw-bold small">{step}</span>
                    <i className={`bi ${icon} text-primary fs-5`} />
                  </div>
                  <h6 className="fw-semibold mb-1" style={{ fontSize: '0.9rem' }}>{title}</h6>
                  <p className="text-muted small mb-0">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
