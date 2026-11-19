import { Link } from 'react-router-dom';
import type { AppState } from '../App';
import { APP_VERSION } from '../config/version';

interface Props { appState: AppState; }

export default function ResultsPage({ appState }: Props) {
  const { practice } = appState;
  const { scoreResult, activeTest } = practice;

  if (!scoreResult) {
    return (
      <div className="card p-4 p-md-5 bg-white border shadow-sm">
        <div style={{ maxWidth: 540 }}>
          <div className="d-flex align-items-center gap-2 mb-3">
            <span className="badge bg-secondary px-3 py-1 rounded-pill">{APP_VERSION}</span>
            <span className="text-muted small">SFG Scoring Engine</span>
          </div>
          <h2 className="fw-bold mb-2">No Active Results</h2>
          <p className="text-muted mb-4">Complete a practice test and scan your marked sheet to view your performance breakdown.</p>
          <div className="d-flex gap-2">
            <Link to="/practice" className="btn btn-primary px-4 py-2">
              <i className="bi bi-pencil-square me-2" />Go to Practice Test
            </Link>
            <Link to="/scan" className="btn btn-outline-secondary px-4 py-2">
              <i className="bi bi-camera me-2" />Scan Sheet
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const { correct, incorrect, unanswered, totalMarks, maxMarks, accuracyPercent, answers, testId } = scoreResult;
  const pct = (totalMarks / maxMarks) * 100;

  return (
    <div>
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-4 border-bottom pb-3">
        <div>
          <h2 className="fw-bold mb-0">Evaluation Results</h2>
          <small className="text-muted">Test ID {String(testId).padStart(2,'0')} &bull; SFG Optical Evaluation</small>
        </div>
        <div className="d-flex align-items-center gap-2">
          <span className="badge bg-primary px-3 py-2 fs-6">
            Test ID: {String(testId).padStart(2,'0')}
          </span>
          <span className="badge bg-light text-dark border px-3 py-2 fs-6">
            Score: {totalMarks} / {maxMarks}
          </span>
          <Link to="/scan" className="btn btn-sm btn-outline-secondary">
            <i className="bi bi-camera me-1" />Scan Another
          </Link>
        </div>
      </div>

      <div className="row g-3 mb-4">
        {[
          { label: 'Total Score', val: `${totalMarks} / ${maxMarks}`, sub: `${pct.toFixed(1)}% Marks`, color: 'var(--primary)', bg: '#f5f3ff' },
          { label: 'Correct Answers', val: correct, sub: `+${(correct * 2).toFixed(1)} Marks`, color: '#059669', bg: '#ecfdf5' },
          { label: 'Incorrect Answers', val: incorrect, sub: `−${(incorrect * 0.66).toFixed(2)} Penalty`, color: '#dc2626', bg: '#fef2f2' },
          { label: 'Unanswered / Blank', val: unanswered, sub: '0 Penalty', color: '#64748b', bg: '#f8fafc' },
          { label: 'Net Accuracy', val: `${accuracyPercent}%`, sub: `${correct}/${correct + incorrect} attempted`, color: '#d97706', bg: '#fffbeb' },
        ].map(({ label, val, sub, color, bg }) => (
          <div key={label} className="col-6 col-md-4 col-lg">
            <div className="border rounded p-3 text-center shadow-xs h-100" style={{ background: bg }}>
              <div className="fs-3 fw-bold" style={{ color }}>{val}</div>
              <div className="fw-semibold text-dark small mt-1">{label}</div>
              <div className="text-muted" style={{ fontSize: '0.72rem' }}>{sub}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="card p-3 bg-white border mb-4 shadow-sm">
        <div className="d-flex justify-content-between align-items-center mb-2 small text-muted">
          <span>Overall Percentage</span>
          <span className="fw-bold text-dark">{pct.toFixed(1)}%</span>
        </div>
        <div className="progress" style={{ height: 12 }}>
          <div
            className="progress-bar bg-primary"
            style={{ width: `${Math.max(0, Math.min(100, pct))}%`, transition: 'width 0.6s ease' }}
          />
        </div>
        <div className="text-muted small mt-2 d-flex justify-content-between">
          <span>Formula: +2.00 for Correct, −0.66 for Incorrect</span>
          <span>Max Marks: {maxMarks}</span>
        </div>
      </div>

      <div className="card bg-white border shadow-sm">
        <div className="card-header bg-white py-3 border-bottom d-flex justify-content-between align-items-center">
          <h5 className="mb-0 fw-bold" style={{ fontSize: '1rem' }}>Answer-by-Answer Detailed Review</h5>
          <span className="text-muted small">50 Total Questions</span>
        </div>
        <div className="table-responsive p-0">
          <table className="table table-sm table-hover table-bordered mb-0 text-center" style={{ fontSize: '0.82rem' }}>
            <thead className="table-light">
              <tr>
                <th style={{ width: '6%' }}>Q#</th>
                <th style={{ width: '10%' }}>Marked</th>
                <th style={{ width: '10%' }}>Key</th>
                <th style={{ width: '14%' }}>Result</th>
                <th className="border-start" style={{ width: '6%' }}>Q#</th>
                <th style={{ width: '10%' }}>Marked</th>
                <th style={{ width: '10%' }}>Key</th>
                <th style={{ width: '14%' }}>Result</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({length: 25}, (_, i) => i).map(i => {
                const left = answers[i];
                const right = answers[i + 25];
                const key = activeTest?.answerKey ?? [];
                const renderCells = (a: typeof left, idx: number, isRight = false) => {
                  const correctKey = key[idx];
                  const given = a.detectedAnswer;
                  const result = !given ? 'blank' : given === correctKey ? 'correct' : 'wrong';
                  return (
                    <>
                      <td className={`fw-bold text-muted ${isRight ? 'border-start' : ''}`}>
                        {String(a.question).padStart(2, '0')}
                      </td>
                      <td className="fw-bold">{given || '—'}</td>
                      <td className="fw-bold text-primary">{correctKey || '—'}</td>
                      <td>
                        <span className={`badge ${
                          result === 'correct' ? 'bg-success-subtle text-success border border-success-subtle' :
                          result === 'wrong' ? 'bg-danger-subtle text-danger border border-danger-subtle' :
                          'bg-light text-muted border'
                        }`} style={{ fontSize: '0.72rem' }}>
                          {result.toUpperCase()}
                        </span>
                      </td>
                    </>
                  );
                };
                return (
                  <tr key={i}>
                    {renderCells(left, i)}
                    {right && renderCells(right, i + 25, true)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="d-flex gap-2 mt-4">
        <Link to="/practice" className="btn btn-primary px-4">
          <i className="bi bi-arrow-repeat me-2" />New Test
        </Link>
        <Link to="/scan" className="btn btn-outline-secondary px-4">
          <i className="bi bi-camera me-2" />Scan Sheet Again
        </Link>
      </div>
    </div>
  );
}
