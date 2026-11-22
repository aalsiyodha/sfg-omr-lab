import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AppState } from '../App';
import { generateOMRSheet } from '../pdf/generateOMR';
import { APP_VERSION } from '../config/version';

interface Props { appState: AppState; }
export default function HomePage({appState}:Props){
  const [downloading,setDownloading]=useState(false);
  const {opencv,practice}=appState;
  const download=async()=>{
    setDownloading(true);
    try{await generateOMRSheet();}
    catch(error){window.alert('Could not generate OMR sheet: '+String(error));}
    finally{setDownloading(false);}
  };
  return (
    <div className="minimal-home">
      <header className="minimal-home-header">
        <span className="minimal-eyebrow">SFG OMR LAB · {APP_VERSION}</span>
        <h1>OMR answer sheet scanner</h1>
        <p>Print a sheet, fill the bubbles, and scan it. Check all readings before scoring.</p>
      </header>
      <section className="minimal-actions" aria-label="Start">
        <Link className="btn btn-primary" to="/scan"><i className="bi bi-upc-scan me-2"/>Scan a sheet</Link>
        <button className="btn btn-outline-secondary" onClick={download} disabled={downloading}>
          <i className="bi bi-file-earmark-arrow-down me-2"/>{downloading?'Preparing PDF…':'Download OMR 2.1'}
        </button>
        <Link className="btn btn-outline-secondary" to="/practice">
          {practice.activeTest?.status==='active'?'Continue practice test':'Practice test'}
        </Link>
      </section>
      <section className="minimal-steps" aria-label="How it works">
        <h2>Before scanning</h2>
        <ol>
          <li>Print the OMR PDF on A4 at <strong>actual size (100%)</strong>.</li>
          <li>Completely fill the Test ID and answer bubbles.</li>
          <li>Photograph the entire sheet with all four corners and the QR visible.</li>
          <li>Scan, review the answers, then submit when verified.</li>
        </ol>
      </section>
      <p className="minimal-readiness" role="status">
        <span className={opencv==='ready'?'minimal-ready-dot':'minimal-wait-dot'}/>
        {opencv==='ready'?'Scanner ready':opencv==='error'?'Scanner unavailable':'Preparing scanner'}
        <span className="ms-2 text-muted">· Processing stays on your device</span>
      </p>
      <p className="small text-muted mb-0">Beta scanning tool. A rejected alignment is not graded. <Link to="/diagnostics">Advanced diagnostics</Link></p>
    </div>
  );
}
