// src/diagnostics/llmPromptGenerator.ts
import { getSettings } from '../config/scannerSettings';
import { APP_VERSION, getBuildIdentity } from '../config/version';
import { grayStripInkCeiling } from '../scanner/grayCalibration';
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
  lines.push(`> Engine: SFG OMR Lab ${APP_VERSION} (Geometry-Verified • Multi-Mark • Adaptive Lighting)`);
  lines.push(`> **Exact build:** ${getBuildIdentity()}`);
  lines.push('> Share this report together with the original scan image AND, if available, the bubble overlay screenshot.');
  lines.push('> This report contains measurements, not the source image pixels. Visual confirmation requires the image.');
  lines.push('> Personal/student identifiers are intentionally excluded from this shareable report.\n');

  lines.push('## 1. Environment & Hardware');
  lines.push(`- **Timestamp:** ${new Date().toISOString()}`);
  lines.push(`- **Browser platform:** \`${navigator.platform}\``);
  lines.push(`- **Screen Size:** ${window.screen.width} × ${window.screen.height}`);
  lines.push('- **Note:** Browser user-agent omitted to reduce identifying metadata.');

  lines.push('\n## 2. Ingested Image & File Metadata');
  if (file) {
    lines.push('- **File Name:** omitted for privacy');
    lines.push(`- **File Size:** ${(file.size / 1024).toFixed(1)} KB`);
    lines.push(`- **MIME Type:** \`${file.type}\``);
  } else {
    lines.push('- **File Details:** Captured via camera / memory canvas');
  }

  lines.push('\n## 3. High-Level Scan Outcome');
  lines.push(`- **Overall Pipeline Status:** \`${scanResult.overallStatus.toUpperCase()}\``);
  lines.push(`- **Processing Latency:** ${scanResult.processingTimeMs} ms`);
  lines.push(`- **Corner Registration Markers Found:** ${scanResult.markerCount} / 4 (Perspective Corrected: \`${scanResult.perspectiveCorrected}\`)`);
  lines.push(`- **Student QR Code:** \`${scanResult.qrValid ? 'VALID' : 'INVALID / MISSING'}\` (raw payload and student ID omitted)`);
  lines.push(`- **Side timing marks verified:** \`${scanResult.alignmentVerified === true ? 'YES' : scanResult.alignmentVerified === false ? 'NO' : 'UNKNOWN'}\``);
  lines.push(`- **Registration method:** \`${scanResult.registrationMethod || 'none'}\``);
  lines.push(`- **Timing marks matched:** ${scanResult.alignmentMatched ?? 'unknown'}/50`);
  lines.push(`- **Rotation applied:** ${scanResult.orientationRotated ? '180°' : 'No'}`);
  if (scanResult.grayCalibration) {
    const c = scanResult.grayCalibration;
    lines.push(`- **Grayscale calibration:** \`${c.status}\` (validated ink ceiling: ${grayStripInkCeiling(c) ?? 'inactive'}; ceiling only affects thresholds above it)`);
    lines.push(`- **Grayscale patch medians (dark to light):** ${c.patchMedians.join(', ') || 'not available'}; contrast=${c.contrast ?? 'N/A'}; ordered=${c.ordered}`);
    lines.push(`- **Calibration note:** ${c.note}`);
  }
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

  // Aggregate markers help isolate scanner failures without guessing the correct answers.
  const statuses = ['detected', 'blank', 'multiple', 'uncertain', 'error'] as const;
  const statusCounts = Object.fromEntries(
    statuses.map((status) => [status, scanResult.answers.filter((q) => q.status === status).length])
  );
  const reviewRows = scanResult.answers.filter(
    (q) => q.status === 'uncertain' || q.status === 'multiple' || q.status === 'error'
  );
  const manualRows = scanResult.answers.filter((q) => q.isManuallyEdited);

  lines.push('\n## 5. Detection Summary & Review Priorities');
  lines.push(`- **Question results available:** ${scanResult.answers.length}/50`);
  lines.push(`- **Status counts:** ${statuses.map((s) => `${s}=${statusCounts[s]}`).join(', ')}`);
  lines.push(`- **Automatic review candidates (uncertain/multiple/error):** ${reviewRows.length ? reviewRows.map((q) => `Q${String(q.question).padStart(2, '0')} (${q.status})`).join(', ') : 'none'}`);
  lines.push(`- **Manually edited answers:** ${manualRows.length ? manualRows.map((q) => `Q${String(q.question).padStart(2, '0')}`).join(', ') : 'none'}`);
  lines.push('- **Important:** A status of detected does not prove correctness. Visual comparison with the image is required.');
  lines.push('- **Important:** Answer-key disagreement measures exam correctness, NOT optical detection correctness.');

  lines.push('\n## 6. Question-by-Question Darkness Measurements (All 50 Questions)');
  lines.push('Darkness percentage measured inside each bubble ROI:');
  lines.push('');
  lines.push('| Q# | A% | B% | C% | D% | Top | 2nd | Gap | Baseline | Det | Status | Conf% | Edited | Key | Key Match? |');
  lines.push('|---|---:|---:|---:|---:|---|---|---:|---:|---|---|---:|---|---|---|');

  scanResult.answers.forEach((q, idx) => {
    const qNum = String(q.question).padStart(2, '0');
    const aFill = q.measurements.find((m) => m.option === 'A')?.fillPercent.toFixed(1) ?? '—';
    const bFill = q.measurements.find((m) => m.option === 'B')?.fillPercent.toFixed(1) ?? '—';
    const cFill = q.measurements.find((m) => m.option === 'C')?.fillPercent.toFixed(1) ?? '—';
    const dFill = q.measurements.find((m) => m.option === 'D')?.fillPercent.toFixed(1) ?? '—';
    const ranked = [...q.measurements].sort((a, b) => b.fillPercent - a.fillPercent);
    const top = ranked[0];
    const second = ranked[1];
    const gap = top && second ? (top.fillPercent - second.fillPercent).toFixed(1) : '—';
    const baseline = ranked.length === 4
      ? ((ranked[1].fillPercent + ranked[2].fillPercent + ranked[3].fillPercent) / 3).toFixed(1)
      : '—';
    const det = q.detectedAnswer || '—';
    const status = q.status;
    const conf = `${q.confidence.toFixed(0)}%`;
    const exp = answerKey ? answerKey[idx] || '—' : '—';
    const match = answerKey ? (det === exp ? '✅' : det === '—' ? '⚪' : '❌') : '—';

    lines.push(`| ${qNum} | ${aFill}% | ${bFill}% | ${cFill}% | ${dFill}% | ${top?.option ?? '—'} | ${second?.option ?? '—'} | ${gap} | ${baseline} | ${det} | ${status} | ${conf} | ${q.isManuallyEdited ? 'yes' : 'no'} | ${exp} | ${match} |`);
  });

  lines.push('\n### Detailed bubble-shape diagnostics for review rows');
  const reviewDetails = scanResult.answers.filter(q =>
    q.status === 'uncertain' || q.status === 'multiple' ||
    q.status === 'error' || q.isManuallyEdited
  );
  if (!reviewDetails.length) lines.push('No ambiguous or manually edited rows.');
  for (const q of reviewDetails) {
    lines.push(`- **Q${String(q.question).padStart(2, '0')} (${q.status}):** ` +
      q.measurements.map(m => `${m.option}: fill=${m.fillPercent.toFixed(1)}%, ` +
        `H=${m.horizontalDisparity?.toFixed(1) ?? '?'}, ` +
        `D=${m.diagonalDisparity?.toFixed(1) ?? '?'}, ` +
        `valid=${m.validMark ?? '?'}, ` +
        `ROI=(${m.sampleXPx ?? '?'},${m.sampleYPx ?? '?'}), ` +
        `ink<${m.inkThreshold ?? '?'}, paper=${m.localPaperBrightness ?? '?'}, ` +
        `quadrants=${m.filledQuadrants ?? '?'}/4, stroke=${m.strokeLike ?? '?'}, ` +
        `axis=${m.axisCoverage?.toFixed(1) ?? '?'}, diag=${m.diagonalCoverage?.toFixed(1) ?? '?'}, ` +
        `stability=${m.stabilitySpread?.toFixed(1) ?? '?'}, ` +
        `radial=${m.radialShape ?? '?'} (core=${m.radialCore ?? '?'}, middle=${m.radialMiddle ?? '?'}, outer=${m.radialOuter ?? '?'}), ` +
        `reason=${m.rejectReason || 'none'}`).join(' | '));
  }

  lines.push('\n## 7. Execution Stage Logs (redacted)');
  lines.push('```text');
  // Use logs attached to this scan rather than a global history of previous scans.
  const logs = scanResult.stageLogs;
  const redact = (value: string): string => value
    .replace(/SFGOMR1:[^\s"'|,}]+/gi, '[REDACTED_QR]')
    .replace(/("?(?:studentId|qrRaw|raw|fileName)"?\s*:\s*)"[^"]*"/gi, '$1"[REDACTED]"');
  if (logs.length === 0) {
    lines.push('No execution logs recorded.');
  } else {
    logs.forEach((l) => {
      lines.push(
        redact(`[${l.timestamp.slice(11, 23)}] [${l.level.padEnd(7)}] [${l.stage.padEnd(16)}] ${l.message}${
          l.data ? ' | ' + JSON.stringify(l.data) : ''
        }`)
      );
    });
  }
  lines.push('```');

  lines.push('\n## 8. Instructions for the LLM and Image Comparison');
  lines.push('Based on the darkness measurements in Section 6, corner markers in Section 3, and settings in Section 4:');
  lines.push('1. Check if all questions in a column are shifted (e.g. if A is high across the whole column, there may be an X-offset error).');
  lines.push('2. Check if darkness values are uniformly low (underexposed/faint marks) or uniformly high (shadow/dark paper background).');
  lines.push('3. Inspect the source image and overlay side by side. Cite question numbers and visible marked options; distinguish what is visibly confirmed from hypotheses.');
  lines.push('4. For each suspected error, report: Q#, visible mark(s), detected answer/status, fill percentages, likely cause, and confidence in the diagnosis.');
  lines.push('5. Check rejected/blank/multiple cases and manually edited rows first, then look for systematic column or row offsets.');
  lines.push('6. Suggest specific code-level changes and reproducible regression tests. Do NOT recommend threshold tuning without supporting measurements.');
  lines.push('7. Do not confuse answer-key mismatch with an OMR scan failure.');
  lines.push('\n## 9. Context to Supply When Sharing');
  lines.push('- Attach the original photograph and, preferably, a screenshot of the bubble overlay.');
  lines.push('- State any questions the scanner got wrong and your expected marked options (or say: please verify independently).');
  lines.push('- If possible, describe lighting, pen/pencil, camera angle, and whether the sheet was printed at 100% scale.');
  lines.push('- Privacy: obscure student names, QR code and any personal details in shared images if necessary.');

  return lines.join('\n');
}


/**
 * Compact, privacy-safe beta report for friends. Original photo and
 * optional coloured overlay should be attached separately, never embedded.
 * Includes the answer map plus measurements only for suspicious rows.
 */
export function generateBetaFeedbackPrompt({ scanResult, activeTestId }: LLMReportOptions): string {
  // Compact by design: always include identity, overall result, 50 answer
  // decisions and at most 12 detailed review samples. Never paste 50x4 verbose
  // measurements or raw student/QR identifiers into an LLM by default.
  const counts = (['detected', 'blank', 'multiple', 'uncertain', 'error'] as const)
    .map(status => status + '=' + scanResult.answers.filter(q => q.status === status).length).join(', ');
  const lines: string[] = [
    'SFG OMR Lab — compact scan diagnostic',
    getBuildIdentity(),
    'Attach original OMR photo separately; photo pixels are not in this report.',
    'Status=' + scanResult.overallStatus +
      ' | testId=' + (scanResult.testId === null ? 'missing' : String(scanResult.testId).padStart(2,'0')) +
      ' | activeTest=' + (activeTestId == null ? 'none' : String(activeTestId).padStart(2,'0')) +
      ' | QR=' + (scanResult.qrValid ? 'valid' : 'unverified'),
    'Registration=' + (scanResult.registrationMethod || 'none') +
      ' | timing=' + (scanResult.alignmentMatched ?? '?') + '/50' +
      ' | verified=' + String(scanResult.alignmentVerified === true) +
      ' | rotated180=' + String(Boolean(scanResult.orientationRotated)),
    'Processing=' + scanResult.processingTimeMs + 'ms | ' + counts,
  ];
  if (scanResult.grayCalibration)
    lines.push('Calibration=' + scanResult.grayCalibration.status +
      ' | patches=' + scanResult.grayCalibration.patchMedians.join(',') +
      ' | contrast=' + (scanResult.grayCalibration.contrast ?? '?'));
  if (scanResult.errors.length) lines.push('Errors=' + scanResult.errors.slice(0, 3).join('; '));
  if (scanResult.warnings.length) lines.push('Warnings=' + scanResult.warnings.slice(0, 2).join('; '));

  lines.push('Answer map (— blank, X multiple, ? uncertain/error):');
  for (let start = 1; start <= 50; start += 10) {
    lines.push(Array.from({ length: 10 }, (_, i) => {
      const n = start+i;
      const q = scanResult.answers.find(a => a.question === n);
      const value = !q ? '?' : q.status === 'multiple' ? 'X' :
        q.status === 'uncertain' || q.status === 'error' ? '?' :
        q.detectedAnswer || '—';
      return String(n).padStart(2,'0') + ':' + value;
    }).join(' '));
  }

  const suspect = scanResult.answers.filter(q => {
    if (q.status === 'multiple' || q.status === 'uncertain' || q.status === 'error' || q.isManuallyEdited) return true;
    const ranked=[...q.measurements].sort((a,b)=>b.fillPercent-a.fillPercent);
    return q.status==='detected' && (ranked[0]?.fillPercent < 85 ||
      ranked[1]?.fillPercent >= 33 || ranked.some(m=>m.strokeLike ||
      (m.stabilitySpread ?? 0)>=12 || m.radialShape==='centre_dot' ||
      m.radialShape==='hollow_ring' || m.radialShape==='partial'));
  });
  const saturation = scanResult.answers.filter(q=>q.measurements.length===4 &&
    q.measurements.every(m=>m.fillPercent>=99)).length;
  if (saturation > 0) lines.push('All-four-bubbles near 100% on ' + saturation +
    '/50 rows: investigate paper/ink threshold or systematic misregistration.');
  const samples=suspect.slice(0,12);
  lines.push('Suspicious rows=' + suspect.length + '; detailed samples=' + samples.length +
    (suspect.length>samples.length ? ' (+'+(suspect.length-samples.length)+' omitted; use full report)' : ''));
  for (const q of samples) {
    const m=q.measurements.map(b=>b.option+':'+Math.round(b.fillPercent)+'%'+
      (b.localPaperBrightness===undefined?'':'/paper'+b.localPaperBrightness)+
      (b.inkThreshold===undefined?'':'/thr'+b.inkThreshold)).join(' ');
    lines.push('Q'+String(q.question).padStart(2,'0')+' '+q.status+' '+m);
  }
  lines.push('Please compare with the original photo; do not infer optical correctness from answer key.');
  lines.push('QR payload, student ID, file name and user-agent omitted.');
  return lines.join('\n');
}
