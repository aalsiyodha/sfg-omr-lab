import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import HomePage from './pages/HomePage';
import PracticeTestPage from './pages/PracticeTestPage';
import ScanPage from './pages/ScanPage';
import ResultsPage from './pages/ResultsPage';
import DiagnosticsPage from './pages/DiagnosticsPage';
import { usePracticeTest } from './hooks/usePracticeTest';
import { useScanResult } from './hooks/useScanResult';

import { APP_VERSION, APP_RELEASE_LABEL } from './config/version';

export type AppState = {
  opencv: 'loading' | 'ready' | 'error';
  practice: ReturnType<typeof usePracticeTest>;
  scanning: ReturnType<typeof useScanResult>;
};

export default function App() {
  const [opencvStatus, setOpencvStatus] = useState<'loading'|'ready'|'error'>('loading');
  const practice = usePracticeTest();
  const scanning = useScanResult();

  useEffect(() => {
    if ((window as any).opencvReady) { setOpencvStatus('ready'); return; }
    const onReady = () => setOpencvStatus('ready');
    const onError = () => setOpencvStatus('error');
    window.addEventListener('opencv-ready', onReady);
    window.addEventListener('opencv-error', onError);
    return () => { window.removeEventListener('opencv-ready', onReady); window.removeEventListener('opencv-error', onError); };
  }, []);

  const appState: AppState = { opencv: opencvStatus, practice, scanning };

  return (
    <BrowserRouter>
      <div className="min-vh-100 d-flex flex-column">
        <nav className="navbar navbar-expand-md navbar-dark py-2" style={{ background: 'var(--accent)' }}>
          <div className="container-fluid" style={{ maxWidth: 1100 }}>
            <NavLink to="/" className="text-decoration-none d-flex align-items-center gap-2">
              <div className="d-flex align-items-center justify-content-center rounded-2 bg-primary text-white" style={{ width: 32, height: 32 }}>
                <i className="bi bi-upc-scan" style={{ fontSize: '1rem' }} />
              </div>
              <span className="navbar-brand mb-0 text-white fw-bold" style={{ letterSpacing: '0.02em' }}>SFG OMR LAB</span>
              <span className="badge bg-white text-dark ms-1 fw-bold" style={{ fontSize: '0.68rem' }}>{APP_VERSION}</span>
            </NavLink>

            <button className="navbar-toggler border-0" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav">
              <span className="navbar-toggler-icon" />
            </button>
            <div className="collapse navbar-collapse" id="navbarNav">
              <ul className="navbar-nav ms-auto gap-1">
                {[
                  ['/', 'Home', 'bi-house'],
                  ['/practice', 'Practice Test', 'bi-pencil-square'],
                  ['/scan', 'Scan OMR', 'bi-camera'],
                  ['/results', 'Results', 'bi-bar-chart'],
                  ['/diagnostics', 'Diagnostics', 'bi-bug'],
                ].map(([to, label, icon]) => (
                  <li className="nav-item" key={to}>
                    <NavLink to={to} end={to==='/'} className={({isActive}) => `nav-link px-3 ${isActive ? 'active fw-bold' : ''}`}>
                      <i className={`bi ${icon} me-1`} />{label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </nav>

        <main className="container-fluid py-4 flex-grow-1" style={{ maxWidth: 1100 }}>
          <Routes>
            <Route path="/" element={<HomePage appState={appState} />} />
            <Route path="/practice" element={<PracticeTestPage appState={appState} />} />
            <Route path="/scan" element={<ScanPage appState={appState} />} />
            <Route path="/results" element={<ResultsPage appState={appState} />} />
            <Route path="/diagnostics" element={<DiagnosticsPage appState={appState} />} />
          </Routes>
        </main>

        <footer className="mt-auto py-3 border-top bg-white text-muted small">
          <div className="container-fluid d-flex flex-wrap align-items-center justify-content-between gap-2" style={{ maxWidth: 1100 }}>
            <div className="d-flex align-items-center gap-2">
              <span className="fw-semibold text-dark">SFG OMR LAB</span>
              <span className="badge bg-light text-secondary border">{APP_RELEASE_LABEL}</span>
            </div>
            <div>
              High-Precision Dual-Pass Optical Mark Recognition &bull; Calibrated for UPSC SFG 2027
            </div>
            <div className="text-muted small">
              100% Client-Side &bull; Pure WASM &bull; Offline Ready
            </div>
          </div>
        </footer>
      </div>
    </BrowserRouter>
  );
}
