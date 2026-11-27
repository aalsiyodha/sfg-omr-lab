import { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import PracticeTestPage from './pages/PracticeTestPage';
import V26ScanPage from './pages/V26ScanPage';
import ResultsPage from './pages/ResultsPage';
import DiagnosticsPage from './pages/DiagnosticsPage';
import MultiPhotoDiagnosticsPage from './pages/MultiPhotoDiagnosticsPage';
import { usePracticeTest } from './hooks/usePracticeTest';
import { useScanResult } from './hooks/useScanResult';


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
    // Events may fire before React mounts. Read the actual runtime state
    // first, then subscribe, then read it again to close the mount race.
    const reconcile = () => {
      const engine = (window as any).cv;
      if ((window as any).opencvReady && typeof engine?.Mat === 'function') {
        setOpencvStatus('ready');
      } else if ((window as any).opencvError) {
        setOpencvStatus('error');
      }
    };
    window.addEventListener('opencv-ready', reconcile);
    window.addEventListener('opencv-error', reconcile);
    reconcile();
    return () => {
      window.removeEventListener('opencv-ready', reconcile);
      window.removeEventListener('opencv-error', reconcile);
    };
  }, []);

  const appState: AppState = { opencv: opencvStatus, practice, scanning };

  return (
    <HashRouter>
      <div className="min-vh-100 d-flex flex-column">
        <nav className="minimal-nav" aria-label="Main navigation">
          <NavLink to="/scan" className="minimal-nav-brand">
            <span className="v26-brand-mark"><i className="bi bi-upc-scan"/></span>SFG<span>OMR</span>
          </NavLink>
          <div className="minimal-nav-links">
            <NavLink to="/scan">Scanner</NavLink>
            <NavLink to="/practice">Practice test</NavLink>
            <NavLink to="/experiment-3-7-10">Experiment 3.7.10 · Local AI</NavLink>
            <span className="v26-nav-status"><span className="v26-nav-status-dot"/> On-device processing</span>
            <button type="button" className="minimal-theme-switch"
              aria-label={theme==='dark'?'Use light appearance':'Use dark appearance'}
              onClick={()=>setTheme(t=>t==='dark'?'light':'dark')}>
              <i className={theme==='dark'?'bi bi-sun':'bi bi-moon'}/>
            </button>
          </div>
        </nav>
        <main className="container-fluid py-4 flex-grow-1 minimal-app-main" style={{ maxWidth: 1100 }}>
          <Routes>
            <Route path="/" element={<Navigate to="/scan" replace />} />
            <Route path="/practice" element={<PracticeTestPage appState={appState} />} />
            <Route path="/scan" element={<V26ScanPage appState={appState} />} />
            <Route path="/results" element={<ResultsPage appState={appState} />} />
            <Route path="/diagnostics" element={<DiagnosticsPage appState={appState} />} />
            <Route path="/multi-scan" element={<Navigate to="/experiment-3-7-1" replace />} />
            <Route path="/experiment-3-5" element={<Navigate to="/experiment-3-6" replace />} />
            <Route path="/experiment-3-6" element={<Navigate to="/experiment-3-7-1" replace />} />
            <Route path="/experiment-3-7" element={<Navigate to="/experiment-3-7-1" replace />} />
            <Route path="/experiment-3-7-1" element={<Navigate to="/experiment-3-7-10" replace />} />
            <Route path="/experiment-3-7-2" element={<Navigate to="/experiment-3-7-10" replace />} />
            <Route path="/experiment-3-7-3" element={<Navigate to="/experiment-3-7-10" replace />} />
            <Route path="/experiment-3-7-4" element={<Navigate to="/experiment-3-7-10" replace />} />
            <Route path="/experiment-3-7-7" element={<Navigate to="/experiment-3-7-10" replace />} />
            <Route path="/experiment-3-7-8" element={<Navigate to="/experiment-3-7-10" replace />} />
            <Route path="/experiment-3-7-9" element={<Navigate to="/experiment-3-7-10" replace />} />
            <Route path="/experiment-3-7-10" element={<MultiPhotoDiagnosticsPage appState={appState} />} />
          </Routes>
        </main>

      </div>
    </HashRouter>
  );
}
