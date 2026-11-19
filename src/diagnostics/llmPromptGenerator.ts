// src/diagnostics/llmPromptGenerator.ts
import { getSettings } from '../config/scannerSettings';
import { APP_VERSION } from '../config/version';
import { logger } from './diagnosticLogger';
import type { ScanResult } from '../types';

interface LLMReportOptions {
  scanResult: ScanResult;
  file?: File | null;
  activeTestId?: number | null;
  answerKey?: string[] | null;
}

/**
 * Format a comprehensive, copyable report specifically structured for LLMs (ChatGPT, Claude, etc.)
 * to diagnose scanning offsets, threshold issues, and misdetections.
 */
export function generateLLMDiagnosticPrompt({
  scanResult,
  file,
  activeTestId,
  answerKey,
}: LLMReportOptions): string {
  const settings = getSettings();
  const lines: string[] = [];

  lines.push(`# SFG OMR LAB — SCAN DIAGNOSTIC REPORT FOR LLM DEBUGGING (${APP_VERSION})`);
  lines.push(`> Engine: SFG OMR Lab ${APP_VERSION} (Dual-Pass • Multi-Mark • Adaptive Lighting)`);
  lines.push('> Paste this entire block into ChatGPT, Claude, or Antigravity to diagnose why answers or bubbles are off.\n');

  lines.push('## 1. Environment & Hardware');
  lines.push(`- **Timestamp:** ${new Date().toISOString()}`);
  lines.push(`- **Browser / User-Agent:** \`${navigator.userAgent}\``);
  lines.push(`- **Platform:** \`${navigator.platform}\``);
  lines.push(`- **Screen Size:** ${window.screen.width} × ${window.screen.height}`);

  lines.push('\n## 2. Ingested Image & File Metadata');
  if (file) {
    lines.push(`- **File Name:** \`${file.name}\``);
    lines.push(`- **File Size:** ${(file.size / 1024).toFixed(1)} KB`);
    lines.push(`- **MIME Type:** \`${file.type}\``);
  } else {
    lines.push('- **File Details:** Captured via camera / memory canvas');
  }

  lines.push('\n## 3. High-Level Scan Outcome');
  lines.push(`- **Overall Pipeline Status:** \`${scanResult.overallStatus.toUpperCase()}\``);
  lines.push(`- **Processing Latency:** ${scanResult.processingTimeMs} ms`);
  lines.push(`- **Corner Registration Markers Found:** ${scanResult.markerCount} / 4 (Perspective Corrected: \`${scanResult.perspectiveCorrected}\`)`);
  lines.push(`- **Student QR Code:** \`${scanResult.qrValid ? 'VALID' : 'INVALID / MISSING'}\` (Raw String: \`${scanResult.qrRaw || 'null'}\`)`);
  lines.push(`- **Detected Test ID:** \`${scanResult.testId ? String(scanResult.testId).padStart(2, '0') : 'NULL / NOT DETECTED'}\``);
  if (activeTestId) {
    lines.push(`- **Active Practice Test ID:** \`${String(activeTestId).padStart(2, '0')}\``);
    lines.push(`- **Test ID Match:** \`${activeTestId === scanResult.testId ? 'MATCHED' : 'MISMATCH'}\``);
  }

  if (scanResult.errors.length > 0) {
    lines.push('\n### Errors Reported:');
    scanResult.errors.forEach((err) => lines.push(`- ❌ ${err}`));
  }
  if (scanResult.warnings.length > 0) {
    lines.push('\n### Warnings Reported:');
    scanResult.warnings.forEach((warn) => lines.push(`- ⚠️ ${warn}`));
  }

  lines.push('\n## 4. Active Scanner Parameters & Thresholds');
  lines.push('```json');
  lines.push(JSON.stringify(settings, null, 2));
  lines.push('```');

  lines.push('\n## 5. Question-by-Question Darkness Measurements (All 50 Questions)');
  lines.push('Darkness percentage measured inside each bubble ROI:');
  lines.push('');
  lines.push('| Q# | A Fill% | B Fill% | C Fill% | D Fill% | Det | Status | Conf% | Expected Key | Match? |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');

  scanResult.answers.forEach((q, idx) => {
    const qNum = String(q.question).padStart(2, '0');
    const aFill = q.measurements.find((m) => m.option === 'A')?.fillPercent.toFixed(1) ?? '—';
    const bFill = q.measurements.find((m) => m.option === 'B')?.fillPercent.toFixed(1) ?? '—';
    const cFill = q.measurements.find((m) => m.option === 'C')?.fillPercent.toFixed(1) ?? '—';
    const dFill = q.measurements.find((m) => m.option === 'D')?.fillPercent.toFixed(1) ?? '—';
    const det = q.detectedAnswer || '—';
    const status = q.status;
    const conf = `${q.confidence.toFixed(0)}%`;
    const exp = answerKey ? answerKey[idx] || '—' : '—';
    const match = answerKey ? (det === exp ? '✅' : det === '—' ? '⚪' : '❌') : '—';

    lines.push(`| ${qNum} | ${aFill}% | ${bFill}% | ${cFill}% | ${dFill}% | ${det} | ${status} | ${conf} | ${exp} | ${match} |`);
  });

  lines.push('\n## 6. Execution Stage Logs');
  lines.push('```text');
  const logs = logger.getAll();
  if (logs.length === 0) {
    lines.push('No execution logs recorded.');
  } else {
    logs.forEach((l) => {
      lines.push(
        `[${l.timestamp.slice(11, 23)}] [${l.level.padEnd(7)}] [${l.stage.padEnd(16)}] ${l.message}${
          l.data ? ' | ' + JSON.stringify(l.data) : ''
        }`
      );
    });
  }
  lines.push('```');

  lines.push('\n## 7. Instructions for the LLM');
  lines.push('Based on the darkness measurements in Section 5, corner markers in Section 3, and settings in Section 4:');
  lines.push('1. Check if all questions in a column are shifted (e.g. if A is high across the whole column, there may be an X-offset error).');
  lines.push('2. Check if darkness values are uniformly low (underexposed/faint marks) or uniformly high (shadow/dark paper background).');
  lines.push('3. Recommend exact parameter adjustments (e.g. bubbleFillThreshold, bubbleMinDifference, or geometric offset).');

  return lines.join('\n');
}
