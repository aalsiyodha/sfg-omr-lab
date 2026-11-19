import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AppState } from '../App';
import type { AnswerOption } from '../types';
import { APP_VERSION } from '../config/version';

interface Props { appState: AppState; }

export default function PracticeTestPage({ appState }: Props) {
  const { practice } = appState;
  const { activeTest, startNewTest } = practice;
  const [userAnswers, setUserAnswers] = useState<Record<number, AnswerOption>>({});

  const handleStart = () => {
    startNewTest();
    setUserAnswers({});
  };

  const selectAnswer = (q: number, opt: AnswerOption) => {
    setUserAnswers(prev => ({ ...prev, [q]: opt }));
  };

  if (!activeTest || activeTest.status === 'submitted') {
    return (
      <div className="card p-4 p-md-5 bg-white border shadow-sm">
        <div style={{ maxWidth: 560 }}>
          <div className="d-flex align-items-center gap-2 mb-3">
            <span className="badge bg-primary px-3 py-1 rounded-pill">{APP_VERSION}</span>
            <span className="text-muted small">SFG Test Engine</span>
          </div>
          <h2 className="fw-bold mb-2">Practice Test Generator</h2>
          {activeTest?.status === 'submitted' && (
            <div className="alert alert-success py-2 small mb-3">
              <i className="bi bi-check-circle me-1" />
              Previous test was submitted successfully!
            </div>
          )}
          <p className="text-muted mb-4">
            Generates an official 50-question session with a randomized answer key and an assigned Test ID (01–40).
            Mark your physical OMR sheet and scan it using your mobile camera to see instant scoring.
          </p>
          <div className="d-flex gap-2">
            <button className="btn btn-primary px-4 py-2" onClick={handleStart}>
              <i className="bi bi-play-circle me-2" />Generate New Test
            </button>
            {activeTest?.status === 'submitted' && (
              <Link to="/results" className="btn btn-outline-secondary px-3 py-2">
                <i className="bi bi-bar-chart me-2" />View Results
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  const answered = Object.keys(userAnswers).length;

  return (
    <div>
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-3 border-bottom pb-3">
        <div>
          <h2 className="mb-0 fw-bold">Active Practice Test</h2>
          <small className="text-muted">Test ID {String(activeTest.testId).padStart(2,'0')} &bull; Standard 50 Questions</small>
        </div>
        <div className="d-flex align-items-center gap-2">
          <span className="badge bg-primary px-3 py-2 fs-6">
            Test ID: {String(activeTest.testId).padStart(2,'0')}
          </span>
          <span className="badge bg-light text-dark border px-3 py-2 fs-6">
            {answered} / 50 Marked
          </span>
          <button className="btn btn-sm btn-outline-secondary" onClick={handleStart}>
            <i className="bi bi-arrow-repeat me-1" />Reset Test
          </button>
          <Link to="/scan" className="btn btn-sm btn-primary">
            <i className="bi bi-camera me-1" />Ready to Scan
          </Link>
        </div>
      </div>

      <div className="alert alert-light border small mb-3 text-muted d-flex align-items-center gap-2">
        <i className="bi bi-info-circle text-primary fs-5" />
        <div>
          <strong>Answer Key Locked:</strong> The randomized key is active in the background. Shade your physical OMR sheet with a dark pen and proceed to <strong>Scan OMR</strong> when finished.
        </div>
      </div>

      <div className="row g-2">
        {Array.from({length: 50}, (_, i) => i+1).map(q => (
          <div key={q} className="col-6 col-md-4 col-lg-3 col-xl-2">
            <div className="border rounded p-2 bg-white shadow-xs" style={{ fontSize: '0.85rem' }}>
              <div className="d-flex justify-content-between align-items-center mb-1">
                <span className="fw-semibold text-secondary">Q{String(q).padStart(2,'0')}</span>
                {userAnswers[q] && <span className="badge bg-success-subtle text-success small">{userAnswers[q]}</span>}
              </div>
              <div className="d-flex gap-1 justify-content-between">
                {(['A','B','C','D'] as AnswerOption[]).map(opt => (
                  <button
                    key={opt}
                    className={`btn btn-sm flex-fill ${userAnswers[q] === opt ? 'btn-primary' : 'btn-outline-secondary'}`}
                    style={{ padding: '2px 4px', fontSize: '0.72rem' }}
                    onClick={() => selectAnswer(q, opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card p-3 bg-white border mt-4 text-center">
        <p className="text-muted small mb-2">Done filling your physical sheet?</p>
        <div>
          <Link to="/scan" className="btn btn-primary px-4">
            <i className="bi bi-camera-fill me-2" />Proceed to Scan & Score
          </Link>
        </div>
      </div>
    </div>
  );
}
