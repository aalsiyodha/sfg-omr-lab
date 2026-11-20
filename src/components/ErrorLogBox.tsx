// src/components/ErrorLogBox.tsx
import { useState } from 'react';
import { logger } from '../diagnostics/diagnosticLogger';
import { getSettings } from '../config/scannerSettings';
import { getBuildIdentity } from '../config/version';
import { copyText } from '../utils/copyText';
import type { ScanResult } from '../types';

interface Props {
  title?: string;
  errorMessage?: string | null;
  scanResult?: ScanResult | null;
  file?: File | null;
}

export function ErrorLogBox({ title = 'Scan Error & Diagnostics', errorMessage, scanResult, file }: Props) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const generateDiagnosticText = (): string => {
    const lines: string[] = [];
    lines.push('==================================================');
    lines.push('SFG OMR LAB — DIAGNOSTIC ERROR REPORT');
    lines.push('==================================================');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(getBuildIdentity());
    lines.push('Browser user-agent omitted for privacy');
    lines.push(`Platform: ${navigator.platform}`);
    lines.push(`Screen: ${window.screen.width}x${window.screen.height}`);

    lines.push('\n--- FILE & IMAGE DETAILS ---');
    if (file) {
      lines.push(`File Name: ${file.name}`);
      lines.push(`File Size: ${(file.size / 1024).toFixed(1)} KB`);
      lines.push(`File Type: ${file.type}`);
    } else {
      lines.push('File: Not available');
    }

    lines.push('\n--- SCAN PIPELINE OUTCOME ---');
    if (errorMessage) {
      lines.push(`Error Message: ${errorMessage}`);
    }
    if (scanResult) {
      lines.push(`Overall Status: ${scanResult.overallStatus}`);
      lines.push(`Processing Time: ${scanResult.processingTimeMs} ms`);
      lines.push(`Markers Detected: ${scanResult.markerCount} / 4`);
      lines.push(`Perspective Corrected: ${scanResult.perspectiveCorrected}`);
      lines.push(`QR Code Valid: ${scanResult.qrValid} (QR payload omitted)`);
      lines.push(`Test ID: ${scanResult.testId || 'null'}`);
      lines.push(`Answers Count: ${scanResult.answers?.length || 0}`);
      if (scanResult.errors.length > 0) {
        lines.push(`Pipeline Errors:\n  * ${scanResult.errors.join('\n  * ')}`);
      }
      if (scanResult.warnings.length > 0) {
        lines.push(`Pipeline Warnings:\n  * ${scanResult.warnings.join('\n  * ')}`);
      }
    }

    lines.push('\n--- ACTIVE SCANNER SETTINGS ---');
    lines.push(JSON.stringify(getSettings(), null, 2));

    lines.push('\n--- DETAILED EXECUTION LOGS ---');
    const logs = scanResult?.stageLogs ?? logger.getAll();
    if (logs.length === 0) {
      lines.push('No log entries recorded.');
    } else {
      logs.forEach((l) => {
        lines.push(
          `[${l.timestamp.slice(11, 23)}] [${l.level}] [${l.stage}] ${l.message}${
            l.data ? ' | ' + JSON.stringify(l.data) : ''
          }`.replace(/SFGOMR1:[^\\s"'|,}]+/gi, '[REDACTED_QR]').replace(/("?(?:studentId|qrRaw|fileName)"?\\s*:\\s*)"[^"]*"/gi, '$1"[REDACTED]"')
        );
      });
    }

    lines.push('\n==================================================');
    lines.push('END OF DIAGNOSTIC REPORT');
    lines.push('==================================================');

    return lines.join('\n');
  };

  const handleCopy = async () => {
    const ok = await copyText(generateDiagnosticText());
    setCopied(ok);
    setCopyError(!ok);
  };

  const handleDownload = () => {
    const text = generateDiagnosticText();
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sfg-omr-error-log-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const diagnosticText = generateDiagnosticText();

  return (
    <div className="card border-danger my-3 shadow-sm">
      <div className="card-header bg-danger text-white d-flex flex-wrap justify-content-between align-items-center py-2">
        <span className="fw-semibold">
          <i className="bi bi-bug me-2" />
          {title}
        </span>
        <div className="d-flex gap-2">
          <button className="btn btn-sm btn-light fw-bold" onClick={handleCopy}>
            <i className={`bi ${copied ? 'bi-check2' : 'bi-clipboard'} me-1`} />
            {copied ? 'Copied to Clipboard!' : 'Copy Diagnostic Log'}
          </button>
          <button className="btn btn-sm btn-outline-light" onClick={handleDownload} title="Download TXT">
            <i className="bi bi-download" />
          </button>
          <button
            className="btn btn-sm btn-outline-light"
            onClick={() => setExpanded(!expanded)}
            title={expanded ? 'Collapse' : 'Expand'}
          >
            <i className={`bi ${expanded ? 'bi-chevron-up' : 'bi-chevron-down'}`} />
          </button>
        </div>
      </div>

      <div className="card-body p-3 bg-light">
        {copyError && <p role="alert" className="small text-danger">Clipboard access failed. Select the report below and copy it manually.</p>}
        {errorMessage && (
          <div className="alert alert-danger py-2 small mb-2">
            <strong>Error:</strong> {errorMessage}
          </div>
        )}

        <p className="small text-muted mb-2">
          Click <strong>"Copy Diagnostic Log"</strong> above and paste it directly into the chat so I can analyze the exact failure:
        </p>

        {expanded && (
          <textarea
            className="form-control font-monospace small bg-white text-dark"
            rows={8}
            readOnly
            value={diagnosticText}
            onClick={(e) => (e.target as HTMLTextAreaElement).select()}
            style={{ fontSize: '0.75rem', lineHeight: '1.3' }}
          />
        )}
      </div>
    </div>
  );
}
