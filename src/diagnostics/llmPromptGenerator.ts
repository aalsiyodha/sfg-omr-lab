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
/** Complete diagnostic: compact enough to share, but retains all 50 bubble
 * measurements and every problematic row's individual evidence. */
export function generateLLMDiagnosticPrompt({
  scanResult, file, activeTestId, answerKey,
}: LLMReportOptions): string {
  const lines: string[] = [
    '# SFG OMR LAB — full scan diagnostic',
    getBuildIdentity(),
    'Generated=' + new Date().toISOString(),
    'File=' + (file?.name ?? 'camera/unknown') +
      (file ? ' | ' + (file.size / 1024).toFixed(1) + 'KB | ' + file.type : ''),
    'Status=' + scanResult.overallStatus + ' | elapsed=' + scanResult.processingTimeMs + 'ms' +
      ' | testId=' + (scanResult.testId ?? 'missing') + ' | activeTest=' + (activeTestId ?? 'none') +
      ' | QR=' + (scanResult.qrValid ? 'valid' : 'invalid'),
    'Registration=' + (scanResult.registrationMethod || 'none') +
      ' | corners=' + scanResult.markerCount + '/4' +
      ' | perspective=' + Boolean(scanResult.perspectiveCorrected) +
      ' | timing=' + (scanResult.alignmentMatched ?? '?') + '/50' +
      ' | verified=' + (scanResult.alignmentVerified === true) +
      ' | rotated180=' + Boolean(scanResult.orientationRotated),
  ];
  if (scanResult.grayCalibration) {
    const cal = scanResult.grayCalibration;
    lines.push('Calibration=' + cal.status + ' | patches=' + cal.patchMedians.join(',') +
      ' | contrast=' + (cal.contrast ?? '?') + ' | inkCeiling=' +
      (grayStripInkCeiling(cal) ?? 'inactive'));
  }
  if (scanResult.errors.length) lines.push('Errors=' + scanResult.errors.join(' ; '));
  if (scanResult.warnings?.length) lines.push('Warnings=' + scanResult.warnings.join(' ; '));
  const settings = getSettings();
  lines.push('Scanner settings=' + JSON.stringify(settings));

  const statuses = ['detected', 'blank', 'multiple', 'uncertain', 'error'] as const;
  lines.push('Counts=' + statuses.map(s=>s+':'+scanResult.answers.filter(q=>q.status===s).length).join(' '));
  lines.push('Full bubble measurements (percent, no redundant rank/baseline columns):');
  lines.push('Q | A | B | C | D | result | status | confidence | edited | key');
  for (const q of scanResult.answers) {
    const fill = (opt:string) => {
      const value=q.measurements.find(m=>m.option===opt)?.fillPercent;
      return value===undefined ? '-' : Math.round(value).toString();
    };
    const key = answerKey?.[q.question-1] || '-';
    lines.push(String(q.question).padStart(2,'0') + ' | ' +
      ['A','B','C','D'].map(fill).join(' | ') + ' | ' +
      (q.detectedAnswer || '-') + ' | ' + q.status + ' | ' +
      Math.round(q.confidence) + ' | ' + (q.isManuallyEdited ? 'yes' : 'no') + ' | ' + key);
  }

  // Include rejected high-ink bubbles even when strict policy intentionally
  // reports the question as blank. Samples 03/05 had no diagnostics for
  // Q20/Q24/Q35 or Q19/Q22/Q46 despite visible ink.
  const review = scanResult.answers.filter(q =>
    q.status==='multiple' || q.status==='uncertain' || q.status==='error' ||
    q.isManuallyEdited || (q.status==='blank' && (
      q.policyRejectedBlank === true ||
      q.measurements.some(m => m.fillPercent >= 30 && m.validMark === false)
    )));

  lines.push('Detailed optical evidence for flagged, edited or high-ink rejected rows (' + review.length + '):');
  if (!review.length) lines.push('None.');
  for (const q of review) {
    const parts = q.measurements.map(m => {
      const f=(v:number|undefined)=>v===undefined?'-':Math.round(v).toString();
      return m.option+'='+f(m.fillPercent)+'%'+
        ' paper='+f(m.localPaperBrightness)+' thr='+f(m.inkThreshold)+
        ' ROI='+f(m.sampleXPx)+','+f(m.sampleYPx)+
        ' valid='+String(m.validMark ?? '?')+
        ' H='+f(m.horizontalDisparity)+' D='+f(m.diagonalDisparity)+
        ' quad='+String(m.filledQuadrants??'?')+
        ' hatchRows='+String(m.hatchGapRows??'?')+
        (m.hatchLike?' hatchLike=true':'')+
        ' sectors='+String(m.filledSectors??'?')+
        ' axis='+f(m.axisCoverage)+' diag='+f(m.diagonalCoverage)+
        ' radial='+String(m.radialShape??'?')+
        ' core='+f(m.radialCore)+' mid='+f(m.radialMiddle)+
        ' outer='+f(m.radialOuter)+
        (m.stabilitySpread===undefined?'':' spread='+f(m.stabilitySpread))+
        (m.strokeLike?' stroke':'')+
        (m.rejectReason?' reason='+m.rejectReason:'');
    });
    lines.push('Q'+String(q.question).padStart(2,'0')+' '+q.status+
      (q.policyRejectedBlank?' policyRejectedBlank=true':'')+': '+parts.join(' ; '));
  }

  // Preserve per-scan logs, but remove noisy successful stage messages.
  // Never omit warnings/errors: those often explain a rejected registration.
  const logs = scanResult.stageLogs ?? [];
  const significant = logs.filter(l =>
    l.level==='ERROR' || l.level==='WARNING' ||
    /hypothes|registration|timing|test id|alignment|calibrat|complete|threshold|candidate/i.test(l.message));
  lines.push('Important stage logs ('+significant.length+'/'+logs.length+'):');
  if (!significant.length) lines.push('None.');
  const redact=(s:string)=>s
    .replace(/SFGOMR1:[^\s"'|,}]+/gi,'[REDACTED_QR]')
    .replace(/("?(?:studentId|qrRaw|raw)"?\s*:\s*)"[^"]*"/gi,'$1"[REDACTED]"');
  for (const log of significant)
    lines.push(redact('['+log.level+'/'+log.stage+'] '+log.message+
      (log.data?' '+JSON.stringify(log.data):'')));

  lines.push('Original photograph and optional bubble overlay should be attached separately.');
  lines.push('Filename is included for image/report matching; student and QR identities are omitted.');
  return lines.join('\n');
}

/**
 * Compact, privacy-safe beta report for friends. Original photo and
 * optional coloured overlay should be attached separately, never embedded.
 * Includes the answer map plus measurements only for suspicious rows.
 */
export function generateBetaFeedbackPrompt({ scanResult, activeTestId, file }: LLMReportOptions): string {
  // Compact by design: always include identity, overall result, 50 answer
  // decisions and at most 12 detailed review samples. Never paste 50x4 verbose
  // measurements or raw student/QR identifiers into an LLM by default.
  const counts = (['detected', 'blank', 'multiple', 'uncertain', 'error'] as const)
    .map(status => status + '=' + scanResult.answers.filter(q => q.status === status).length).join(', ');
  const lines: string[] = [
    'SFG OMR Lab — compact scan diagnostic',
    getBuildIdentity(),
    'File=' + (file?.name ?? 'camera/unknown') + (file ? ' | ' + (file.size/1024).toFixed(1) + 'KB' : ''),
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
  if (scanResult.warnings?.length) lines.push('Warnings=' + scanResult.warnings.slice(0, 2).join('; '));

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
    if (q.status === 'multiple' || q.status === 'uncertain' || q.status === 'error' || q.isManuallyEdited || q.policyRejectedBlank) return true;
    if (q.status === 'blank' && q.measurements.some(m=>m.fillPercent>=30 && m.validMark===false)) return true;
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
    lines.push('Q'+String(q.question).padStart(2,'0')+' '+q.status+
      (q.policyRejectedBlank?' [invalid mark]':'')+' '+m);
  }
  lines.push('Please compare with the original photo; do not infer optical correctness from answer key.');
  lines.push('QR payload and student ID omitted; filename retained to match original photo.');
  return lines.join('\n');
}
