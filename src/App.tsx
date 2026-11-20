import { useState, useEffect } from 'react';
import { BrowserRouter, HashRouter, Routes, Route, NavLink } from 'react-router-dom';
import HomePage from './pages/HomePage';
import PracticeTestPage from './pages/PracticeTestPage';
import ScanPage from './pages/ScanPage';
import ResultsPage from './pages/ResultsPage';
import DiagnosticsPage from './pages/DiagnosticsPage';
import { usePracticeTest } from './hooks/usePracticeTest';
import { useScanResult } from './hooks/useScanResult';

import { APP_VERSION, APP_RELEASE_LABEL, APP_DEPLOY_LABEL, APP_BUILD_META } from './config/version';

export type AppState = {
  opencv: 'loading' | 'ready' | 'error';
  practice: ReturnType<typeof usePracticeTest>;
  scanning: ReturnType<typeof useScanResult>;
};

export default function App() {
  const [opencvStatus, setOpencvStatus] = useState<'loading'|'ready'|'error'>('loading');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const stored = window.localStorage.getItem('sfg-omr-theme');
      if (stored === 'light' || stored === 'dark') return stored;
    } catch { /* storage may be blocked */ }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-bs-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    try { window.localStorage.setItem('sfg-omr-theme', theme); }
    catch { /* private browsing: use in-memory preference */ }
  }, [theme]);
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

  const Router = import.meta.env.BASE_URL === '/sfg-omr-lab/' ? HashRouter : BrowserRouter;
  return (
    <Router>
      <div className="min-vh-100 d-flex flex-column">
        <nav className="navbar navbar-expand-md sticky-top product-navbar">
          <div className="container-fluid" style={{ maxWidth: 1160 }}>
            <NavLink to="/" className="product-brand text-decoration-none d-flex align-items-center gap-2">
              <span className="product-brand-icon"><i className="bi bi-upc-scan" /></span>
              <span className="product-brand-name">SFG <span>OMR Lab</span></span>
              <span className="product-version-tag">{APP_VERSION}</span>
            </NavLink>
            <div className="product-header-controls">
              <button type="button" className="product-theme-toggle" onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} aria-pressed={theme === 'dark'}>
                <i className={`bi ${theme === 'dark' ? 'bi-sun' : 'bi-moon-stars'}`} aria-hidden="true" />
                <span className="product-theme-caption">{theme === 'dark' ? 'Light' : 'Dark'}</span>
              </button>
              <button className="navbar-toggler product-navbar-toggle" type="button"
                data-bs-toggle="collapse" data-bs-target="#navbarNav"
                aria-controls="navbarNav" aria-expanded="false" aria-label="Toggle navigation">
                <span className="navbar-toggler-icon" />
              </button>
            </div>
            <div className="collapse navbar-collapse" id="navbarNav">
              <ul className="navbar-nav ms-auto align-items-md-center gap-1">
                {[
                  ['/', 'Overview'], ['/practice', 'Practice'], ['/results', 'Results'], ['/diagnostics', 'Advanced'],
                ].map(([to,label])=>(
                  <li className="nav-item" key={to}>
                    <NavLink to={to} end={to==='/'} className={({isActive})=>`nav-link product-nav-link ${isActive?'active':''}`}>{label}</NavLink>
                  </li>
                ))}
                <li className="nav-item ms-md-2"><NavLink to="/scan" className="btn btn-primary product-nav-cta"><i className="bi bi-upc-scan me-2" />Scan a sheet</NavLink></li>
              </ul>
            </div>
          </div>
        </nav>

        <main className="container-fluid py-4 flex-grow-1" style={{ maxWidth: 1160 }}>
          <Routes>
            <Route path="/" element={<HomePage appState={appState} />} />
            <Route path="/practice" element={<PracticeTestPage appState={appState} />} />
            <Route path="/scan" element={<ScanPage appState={appState} />} />
            <Route path="/results" element={<ResultsPage appState={appState} />} />
            <Route path="/diagnostics" element={<DiagnosticsPage appState={appState} />} />
          </Routes>
        </main>

        <footer className="mt-auto product-footer">
          <div className="container-fluid d-flex flex-wrap align-items-center justify-content-between gap-2" style={{ maxWidth: 1160 }}>
            <span className="product-footer-brand">SFG OMR LAB <span>· {APP_RELEASE_LABEL}</span></span>
            <span>Built for thoughtful practice. Processed on your device.</span>
            <span className="product-deployment-label" title={`Commit: ${APP_BUILD_META.sha} · Built: ${APP_BUILD_META.builtAt}`}>{APP_DEPLOY_LABEL} · commit {APP_BUILD_META.buildId}{APP_BUILD_META.dirty ? ' · modified' : ''}</span>
            <span>Beta · Verify before scoring</span>
          </div>
        </footer>
      </div>
    </Router>
  );
}
