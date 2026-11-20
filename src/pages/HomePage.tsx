import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AppState } from '../App';
import { generateOMRSheet } from '../pdf/generateOMR';
import { APP_VERSION } from '../config/version';

interface Props { appState: AppState; }
const steps = [
  { n:'01', icon:'bi-file-earmark-arrow-down', title:'Get the sheet', body:'Download the standard A4 format and print at 100%.' },
  { n:'02', icon:'bi-pencil', title:'Fill your answers', body:'Shade bubbles fully. Ticks, dots and partial marks count as blank.' },
  { n:'03', icon:'bi-camera', title:'Scan and review', body:'Upload a clear photo, then confirm the detected answers.' },
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
          <h1>Every mark,<br/><span>clearly accounted for.</span></h1>
          <p className="product-hero-lead">A faster way to read your SFG answer sheets. Upload a photo, verify the bubbles, and review your results — all in your browser.</p>
          <div className="product-actions">
            <Link to="/scan" className="btn btn-primary btn-lg product-primary-cta"><i className="bi bi-upc-scan me-2" />Scan an OMR sheet <i className="bi bi-arrow-up-right ms-2" /></Link>
            <button type="button" className="btn btn-outline-secondary btn-lg product-secondary-cta" onClick={downloadSheet} disabled={downloading}>
              <i className="bi bi-download me-2" />{downloading?'Preparing…':'Download blank sheet'}
            </button>
          </div>
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

      <section className="product-workflow" aria-labelledby="workflow-title">
        <div className="product-section-heading">
          <div><span className="product-kicker">SIMPLE WORKFLOW</span><h2 id="workflow-title">From paper to clarity.</h2></div>
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
      <section className="product-bottom-callout">
        <div><span className="product-kicker">OPTIONAL PRACTICE</span><h2>Ready to check your score?</h2><p>Create or resume a practice test, then scan your marked sheet against its answer key.</p></div>
        <Link to="/practice" className="btn btn-outline-primary">{practice.activeTest?.status==='active'?'Continue practice test':'Create practice test'} <i className="bi bi-arrow-right ms-2"/></Link>
      </section>
      <p className="product-disclaimer">Designed for the official SFG sheet format. For practice and beta evaluation; verify unclear readings before relying on a score.</p>
    </div>
  );
}
