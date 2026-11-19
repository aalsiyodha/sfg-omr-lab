import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AppState } from '../App';
import { generateOMRSheet } from '../pdf/generateOMR';
import { APP_VERSION } from '../config/version';

interface Props { appState: AppState; }

const steps = [
  { number: '01', icon: 'bi-file-earmark-arrow-down', title: 'Print the SFG sheet', text: 'Use our standard A4 OMR PDF and print at 100% scale. Keep all four edges visible.' },
  { number: '02', icon: 'bi-pencil', title: 'Fill in Test ID and answers', text: 'Use a dark blue or black pen or pencil. Fill circles completely; avoid ticks and crosses.' },
  { number: '03', icon: 'bi-camera', title: 'Take a clear photo', text: 'Place the sheet flat, avoid glare, and include the entire page. Upright or upside-down is fine.' },
  { number: '04', icon: 'bi-shield-check', title: 'Review before trusting results', text: 'Check the coloured overlay and resolve uncertain marks. Scoring is optional.' },
];

export default function HomePage({ appState }: Props) {
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const { opencv, practice } = appState;

  const downloadSheet = async () => {
    setDownloading(true);
    try { await generateOMRSheet(); }
    catch (error) { window.alert('Could not download the OMR PDF: ' + String(error)); }
    finally { setDownloading(false); }
  };

  const shareBeta = async () => {
    const url = window.location.origin + '/scan';
    try {
      if (navigator.share) {
        await navigator.share({ title: 'SFG OMR Lab Beta', text: 'Test OMR scanning and send feedback', url });
      } else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
      }
    } catch (error) {
      // Cancelling the system share dialog is normal.
      if ((error as Error)?.name !== 'AbortError') {
        window.prompt('Copy this link to share:', url);
      }
    }
  };

  return (
    <div className="beta-home">
      <section className="beta-hero p-4 p-md-5 mb-4">
        <div className="row align-items-center g-4 position-relative">
          <div className="col-lg-8">
            <div className="d-flex flex-wrap gap-2 mb-3">
              <span className="beta-pill"><i className="bi bi-circle-fill me-2" style={{ fontSize: 7 }} />Public beta</span>
              <span className="beta-pill beta-pill-muted">{APP_VERSION} · Fixed SFG sheet</span>
            </div>
            <h1 className="beta-display mb-3">Scan your OMR sheet.<br/><span>Understand every mark.</span></h1>
            <p className="beta-lead mb-4">Photograph a 50-question SFG answer sheet, check the detected bubbles, and correct uncertain readings before using a score. No account needed to try the scanner.</p>
            <div className="d-flex flex-wrap gap-2">
              <Link to="/scan" className="btn btn-light btn-lg beta-main-action"><i className="bi bi-upc-scan me-2" />Scan a sheet</Link>
              <button type="button" onClick={downloadSheet} disabled={downloading} className="btn btn-outline-light btn-lg">
                <i className="bi bi-file-earmark-pdf me-2" />{downloading ? 'Preparing PDF…' : 'Download blank sheet'}
              </button>
            </div>
            <div className="d-flex flex-wrap gap-3 mt-4 beta-hero-notes">
              <span><i className="bi bi-phone me-1" />Phone or computer</span>
              <span><i className="bi bi-shield-lock me-1" />Image processed in your browser</span>
              <span><i className="bi bi-exclamation-circle me-1" />Human review advised</span>
            </div>
          </div>
          <div className="col-lg-4 d-none d-lg-flex justify-content-center">
            <div className="beta-sheet-illustration" aria-hidden="true">
              <div className="beta-sheet-top" />
              {Array.from({ length: 8 }, (_, i) => (
                <div className="beta-sheet-row" key={i}>
                  <span className="beta-sheet-line" />
                  {Array.from({ length: 4 }, (_, j) => <span key={j} className={'beta-sheet-dot' + ((i+j)%5===0?' filled':'')} />)}
                </div>
              ))}
              <div className="beta-sheet-label"><i className="bi bi-check-circle-fill me-1" />Check and review</div>
            </div>
          </div>
        </div>
      </section>

      <div className="row g-3 mb-4">
        <div className="col-lg-6">
          <div className="card h-100 p-4 beta-path-card">
            <div className="beta-icon"><i className="bi bi-camera" /></div>
            <h2 className="h4 mt-3">Just want to test the scanner?</h2>
            <p className="text-muted">Upload or photograph a marked SFG sheet. You can inspect the results and share a diagnostic report without creating a practice test.</p>
            <Link to="/scan" className="btn btn-primary mt-auto align-self-start">Scan &amp; inspect <i className="bi bi-arrow-right ms-1" /></Link>
          </div>
        </div>
        <div className="col-lg-6">
          <div className="card h-100 p-4 beta-path-card">
            <div className="beta-icon beta-icon-green"><i className="bi bi-clipboard-check" /></div>
            <h2 className="h4 mt-3">Want a practice score?</h2>
            <p className="text-muted">Create a practice test first, mark its Test ID on the sheet, then scan and review it. Scoring uses the active test's answer key.</p>
            <Link to="/practice" className="btn btn-outline-primary mt-auto align-self-start">
              {practice.activeTest?.status === 'active' ? 'Continue practice test' : 'Create a practice test'} <i className="bi bi-arrow-right ms-1" />
            </Link>
          </div>
        </div>
      </div>

      <section className="mb-4">
        <div className="d-flex flex-wrap justify-content-between align-items-end gap-2 mb-3">
          <div>
            <span className="text-primary fw-semibold small text-uppercase">Getting started</span>
            <h2 className="h3 fw-bold mt-1 mb-0">Four easy steps</h2>
          </div>
          <span className="text-muted small">No special scanner hardware required</span>
        </div>
        <div className="row g-3">
          {steps.map(step => (
            <div key={step.number} className="col-sm-6 col-xl-3">
              <div className="beta-step h-100">
                <span className="beta-step-num">{step.number}</span>
                <i className={'bi ' + step.icon + ' beta-step-icon'} />
                <h3 className="h6 fw-bold mt-3">{step.title}</h3>
                <p className="text-muted small mb-0">{step.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="row g-3 mb-4">
        <div className="col-lg-7">
          <section className="card p-4 h-100">
            <h2 className="h5 fw-bold"><i className="bi bi-lightbulb text-warning me-2" />Tips for a reliable scan</h2>
            <ul className="beta-tip-list small text-muted mb-0">
              <li>Use the <strong>official SFG OMR PDF</strong> at actual size. Other OMR formats aren't supported.</li>
              <li>Keep the entire sheet, corner squares and the QR code visible.</li>
              <li>Avoid shadows, strong flash reflections, blur, and steep viewing angles.</li>
              <li>Marks with crosses, slashes, erasures or faint shading may need manual review.</li>
              <li><strong>Partial</strong> means some markings need attention; it does not necessarily mean the scan failed.</li>
            </ul>
          </section>
        </div>
        <div className="col-lg-5">
          <section className="card p-4 h-100">
            <h2 className="h5 fw-bold">Help improve the beta</h2>
            <p className="text-muted small">Share the scan link with testers. If a result looks wrong, use <strong>Copy diagnostic report</strong> on the Scan page and share the report plus a cropped, privacy-safe overlay.</p>
            <div className="d-flex flex-wrap gap-2 mt-auto">
              <button type="button" className="btn btn-outline-primary" onClick={shareBeta}>
                <i className="bi bi-share me-2" />{copied ? 'Link copied' : 'Share beta link'}
              </button>
              <a className="btn btn-outline-secondary" href="https://github.com/aalsiyodha/sfg-omr-lab/issues/new" target="_blank" rel="noreferrer">
                <i className="bi bi-chat-left-text me-2" />Report an issue
              </a>
            </div>
            <p className="text-muted mt-3 mb-0" style={{fontSize:12}}>For beta evaluation only. Review all questionable marks; do not rely on automated scores for official examinations.</p>
          </section>
        </div>
      </div>

      <div className="beta-engine-status mb-2">
        <span className={'status-dot ' + (opencv === 'ready' ? 'ok' : opencv === 'loading' ? 'loading' : 'fail')} />
        <span className="fw-semibold">Scanning engine:</span>
        <span>{opencv === 'ready' ? 'Ready to scan' : opencv === 'loading' ? 'Loading OpenCV…' : 'Unavailable — reload the page'}</span>
      </div>
    </div>
  );
}
