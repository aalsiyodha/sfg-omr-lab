import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AppState } from '../App';
import { generateOMRSheet } from '../pdf/generateOMR';
import { APP_VERSION } from '../config/version';

interface Props { appState: AppState; }
const steps = [
  { n:'01', icon:'bi-file-earmark-arrow-down', title:'Print an answer sheet', body:'Download OMR 2.1 and print on A4 at Actual Size (100%).' },
  { n:'02', icon:'bi-pencil', title:'Fill the Test ID and answers', body:'Shade one Test ID digit in each row. Fully fill answer bubbles; ticks and partial marks are blank.' },
  { n:'03', icon:'bi-camera', title:'Photograph and review', body:'Keep all four corners visible, upload the photo and check any flagged results.' },
];

export default function HomePage({ appState }: Props) {
  const [downloading,setDownloading]=useState(false);
  const {opencv,practice}=appState;
  const downloadSheet=async()=>{
    setDownloading(true);
    try{ await generateOMRSheet(); }
    catch(error){ window.alert('Could not generate OMR sheet: '+String(error)); }
    finally{setDownloading(false);}
  };
  return (
    <div className="product-home">
      <section className="product-hero">
        <div className="product-hero-content">
          <div className="product-eyebrow"><span className="product-eyebrow-dot" /> SFG OMR LAB <span className="product-eyebrow-separator">/</span> {APP_VERSION}</div>
          <h1>Scan your OMR sheet.<br/><span>Check your answers.</span></h1>
          <p className="product-hero-lead">Turn a photo of your filled SFG answer sheet into a clear 50-question result. No setup needed: scan, review flagged questions and see what was detected.</p>
          <div className="product-actions">
            <Link to="/scan" className="btn btn-primary btn-lg product-primary-cta"><i className="bi bi-upc-scan me-2" />Scan my sheet <i className="bi bi-arrow-up-right ms-2" /></Link>
            <button type="button" className="btn btn-outline-secondary btn-lg product-secondary-cta" onClick={downloadSheet} disabled={downloading}>
              <i className="bi bi-download me-2" />{downloading?'Preparing…':'Get printable OMR 2.1'}
            </button>
          </div>
          <p className="product-hero-hint"><i className="bi bi-lightbulb me-2" />New here? Download the sheet, print it at 100%, then take a photo after marking your answers.</p>
          <div className="product-trust-row">
            <span><i className="bi bi-shield-lock" /> On-device processing</span>
            <span><i className="bi bi-list-check" /> 50-question SFG format</span>
            <span><i className="bi bi-person-check" /> Review before scoring</span>
          </div>
        </div>
        <div className="product-hero-preview" aria-hidden="true">
          <div className="product-sheet">
            <div className="product-sheet-head"><span className="product-sheet-logo">SFG</span><span>ANSWER SHEET</span><span className="product-sheet-qr" /></div>
            <div className="product-sheet-rule" />
            <div className="product-sheet-bubbles">
              {Array.from({length:12},(_,i)=>(
                <div className="product-sheet-bubble-row" key={i}>
                  <span className="product-sheet-number">{String(i+1).padStart(2,'0')}</span>
                  {Array.from({length:4},(_,j)=>(
                    <span key={j} className={'product-sheet-bubble'+((i*3+j)%7===0?' marked':'')} />
                  ))}
                </div>
              ))}
            </div>
            <div className="product-sheet-scanline" />
            <div className="product-sheet-bottom"><span className="product-sheet-status-dot"/> Detecting marks <span className="product-sheet-status-lines">•••</span></div>
          </div>
          <div className="product-floating-chip"><i className="bi bi-check-circle-fill" /> Geometry verified</div>
        </div>
      </section>

      <section className="container my-3" aria-label="Latest scanner changes">
        <div className="alert alert-info border mb-0" role="note">
          <strong><i className="bi bi-stars me-2" />New in v2.2.5</strong>
          <p className="small mb-0 mt-1">
            Partial bubbles, dots, hatches and ticks are rejected as blank;
            two fully shaded options remain multiple even if crossed through.
            In practice scoring, multiple selections now receive the incorrect
            answer penalty (−0.66 for a 2-mark question). Diagnostic reports
            show why high-ink partial marks were rejected.
          </p>
        </div>
      </section>
      <section className="product-workflow" aria-labelledby="workflow-title">
        <div className="product-section-heading">
          <div><span className="product-kicker">SIMPLE WORKFLOW</span><h2 id="workflow-title">How it works — just 3 steps.</h2></div>
          <span className={'product-engine-pill '+(opencv==='ready'?'ready':opencv==='error'?'error':'')}>
            <span className="status-dot" />{opencv==='ready'?'Scanner ready':opencv==='error'?'Scanner unavailable':'Preparing scanner'}
          </span>
        </div>
        <div className="product-step-grid">
          {steps.map(step=>(
            <div className="product-step" key={step.n}>
              <div className="product-step-top"><span>{step.n}</span><i className={'bi '+step.icon} /></div>
              <h3>{step.title}</h3><p>{step.body}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="product-quick-guide" aria-labelledby="photo-guide-title">
        <div className="product-quick-guide-heading">
          <div><span className="product-kicker">FOR ACCURATE SCANNING</span><h2 id="photo-guide-title">Take a photo the scanner can read.</h2></div>
          <Link to="/scan" className="product-inline-link">Open scanner <i className="bi bi-arrow-right" /></Link>
        </div>
        <div className="product-guide-grid">
          <div className="product-guide-item"><i className="bi bi-bounding-box-circles" aria-hidden="true" /><div><strong>Keep the entire page visible</strong><span>Include all four corner squares and the QR code. Avoid cropping.</span></div></div>
          <div className="product-guide-item"><i className="bi bi-brightness-high" aria-hidden="true" /><div><strong>Use even lighting</strong><span>Avoid shadows, glare, motion blur and strong perspective angles.</span></div></div>
          <div className="product-guide-item"><i className="bi bi-check2-circle" aria-hidden="true" /><div><strong>Shade bubbles completely</strong><span>Dots, ticks, slashes, crosses and half-fills are treated as blank.</span></div></div>
        </div>
      </section>
      <section className="product-bottom-callout">
        <div><span className="product-kicker">OPTIONAL PRACTICE</span><h2>Ready to check your score?</h2><p>Create or resume a practice test, then scan your marked sheet against its answer key.</p></div>
        <Link to="/practice" className="btn btn-outline-primary">{practice.activeTest?.status==='active'?'Continue practice test':'Create practice test'} <i className="bi bi-arrow-right ms-2"/></Link>
      </section>
      <p className="product-disclaimer">Designed for the SFG OMR 2.1 printable sheet. For practice and beta evaluation; verify unclear readings before relying on a score.</p>
    </div>
  );
}
