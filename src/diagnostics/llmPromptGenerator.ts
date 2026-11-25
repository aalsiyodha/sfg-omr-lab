// src/diagnostics/llmPromptGenerator.ts
import { getSettings } from '../config/scannerSettings';
import { APP_VERSION, getBuildIdentity } from '../config/version';
import { grayStripInkCeiling } from '../scanner/grayCalibration';
import type { ScanResult } from '../types';

interface LLMReportOptions {
  scanResult: ScanResult;
  file?: File | null;
  fileSha256?: string | null;
  activeTestId?: number | null;
  answerKey?: string[] | null;
}

/** Explicit summaries of optional engines, including disabled/not-run states.
 * These logs are evidence of execution, unlike the unrelated AI fallback.
 */
const EXPERIMENT_LOGS=[
  'User-selected scan controls',
  'Registration engine budget and measured work',
  'v2.5.3 OpenCV 5 SIMD separate runtime probe',
  'v2.5.5 ttop32 OpenCV 4.8.1 WASM isolated runtime benchmark',
  'v2.5.2 withheld-print-validated local mesh',
  'v2.5.2 masked latent template predictor',
  'v2.5.2 synthetic-trained closed-set head',
  'v2.5.1 selective DecisionScan audit',
] as const;
function experimentSummary(scan:ScanResult,compact=false):string[]{
  const logs=scan.stageLogs??[];
  const result=['Opt-in engine decisions and execution evidence:'];
  for(const name of EXPERIMENT_LOGS){
    const hit=logs.find(l=>l.message===name);
    if(!hit){
      result.push('  '+name+': not logged (not proof of execution)');
      continue;
    }
    const data=hit.data??{};
    const summary=compact
      ?Object.fromEntries(Object.entries(data).map(([key,value])=>{
        if(['proposals','localVisualProofs','reviewCandidates','grid',
          'anomalies'].includes(key)&&Array.isArray(value)){
          return [key+'Count',value.length];
        }
        return [key,value];
      }))
      :data;
    result.push('  '+name+': '+JSON.stringify(summary));
  }
  return result;
}

/**
 * Format a comprehensive, copyable report specifically structured for LLMs (ChatGPT, Claude, etc.)
 * to diagnose scanning offsets, threshold issues, and misdetections.
 */
/** Complete diagnostic: compact enough to share, but retains all 50 bubble
 * measurements and every problematic row's individual evidence. */
export function generateLLMDiagnosticPrompt({
  scanResult, file, fileSha256, activeTestId, answerKey,
}: LLMReportOptions): string {
  const lines: string[] = [
    '# SFG OMR LAB — '+APP_VERSION+' FAST LOCAL SCANNER diagnostic',
    getBuildIdentity(),
    'Generated=' + new Date().toISOString(),
    'File=' + (file?.name ?? 'camera/unknown') +
      (file ? ' | ' + (file.size / 1024).toFixed(1) + 'KB | ' + file.type : ''),
    'File SHA-256=' + (fileSha256 ?? 'pending/unavailable'),
    'Status=' + scanResult.overallStatus + ' | elapsed=' + scanResult.processingTimeMs + 'ms' +
      ' | testId=' + (scanResult.testId ?? 'missing') + ' | activeTest=' + (activeTestId ?? 'none') +
      ' | QR=' + (scanResult.qrValid ? 'valid' : 'invalid'),
    'Student ID=' + (scanResult.studentId ?? 'not decoded') +
      ' | QR payload=' + (scanResult.qrRaw ?? 'not decoded'),
    'Registration=' + (scanResult.registrationMethod || 'none') +
      ' | corners=' + scanResult.markerCount + '/4' +
      ' | perspective=' + Boolean(scanResult.perspectiveCorrected) +
      ' | timing=' + (scanResult.alignmentMatched ?? '?') + '/50' +
      ' | verified=' + (scanResult.alignmentVerified === true) +
      ' | provisional=' + Boolean(scanResult.provisional) +
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
  lines.push(...experimentSummary(scanResult));

  const statuses = ['detected', 'blank', 'multiple', 'uncertain', 'error'] as const;
  lines.push('Counts=' + statuses.map(s=>s+':'+scanResult.answers.filter(q=>q.status===s).length).join(' '));
  if(scanResult.answers.length===0){
    lines.push('NO BUBBLE READINGS: Registration was not verified; 0 answers were examined. This is not 50 blank answers.');
    lines.push('Failure investigation: scanner never reached grayscale-strip calibration, Test ID or bubble analysis.');
    lines.push('Image dimensions and input evidence: see Image loaded and marker-detection stage logs below.');
    const qrFailures=(scanResult.stageLogs??[]).filter(l=>l.stage==='qrDecoding' &&
      (l.level==='WARNING'||l.level==='ERROR'));
    lines.push('QR verification failures ('+qrFailures.length+'):');
    if(qrFailures.length===0)lines.push('No explicit QR rejection logged; inspect registration attempts below.');
    for(const log of qrFailures)lines.push('  '+log.message+
      (log.data?' '+JSON.stringify(log.data):''));
    const boundary=(scanResult.stageLogs??[]).filter(l=>
      /Outer-page boundary recovery evidence|Outer-page fiducial redetection|Recovery conclusion/.test(l.message));
    lines.push('Page-rescue evidence ('+boundary.length+'):');
    for(const log of boundary)lines.push('  '+log.message+
      (log.data?' '+JSON.stringify(log.data):''));
    lines.push('Next capture check: ensure the entire sheet, all corners and QR are in-frame, evenly lit and sharp.');
  }
  // AI is only invoked after traditional registration fails. Keep all stages
  // available even if the AI runtime or model fails before inference.
  const aiLogs=(scanResult.stageLogs??[]).filter(l=>
    /AI trace:|AI document boundary recovery|AI-prewarped fiducial discovery|AI candidate verification result|AI-assisted registration independently verified|AI last-resort summary|Optional AI recovery unavailable/i.test(l.message));
  lines.push('AI fallback evidence ('+aiLogs.length+'):');
  if(!aiLogs.length)lines.push('AI not invoked (or no AI logs present).');
  for(const l of aiLogs)lines.push('  ['+l.level+'/'+l.stage+'] '+l.message+
    (l.data?' '+JSON.stringify(l.data):''));
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
    scanResult.answers.length===0 || l.level==='ERROR' || l.level==='WARNING' ||
    /hypothes|registration|timing|test id|alignment|calibrat|complete|threshold|candidate|boundary|recovery|performance|AI trace|AI last-resort/i.test(l.message));
  // Keep one compact, machine-parsable performance and registration summary.
  const performance=logs.filter(l=>/Registration performance summary|Outer-page rescue timing|Scan stage timings|Scan complete in/i.test(l.message));
  const recovery=logs.filter(l=>/timing-track recovery evidence|timing-track holdout validation|Outer-page boundary recovery evidence|Outer-page fiducial redetection|Hybrid cross-family recovery evidence|grayscale landmark cross-check|Independent original-photo QR locator/i.test(l.message));
  lines.push('Registration & performance milestones ('+(performance.length+recovery.length)+'):');
  const summarize=(l:typeof logs[number])=>
    '['+l.level+'/'+l.stage+'] '+l.message+(l.data?' '+JSON.stringify(l.data):'');
  for(const l of [...recovery,...performance])lines.push(summarize(l));
    lines.push('Important stage logs ('+significant.length+'/'+logs.length+'):');
  if (!significant.length) lines.push('None.');
  for (const log of significant)
    lines.push('['+log.level+'/'+log.stage+'] '+log.message+
      (log.data?' '+JSON.stringify(log.data):''));

  lines.push('Original photograph and optional bubble overlay should be attached separately.');
  lines.push('Unredacted testing report: filenames, build commit SHA, student IDs and decoded QR data are retained when available.');
  return lines.join('\n');
}

/**
 * Compact, unredacted testing report. Original photo and
 * optional coloured overlay should be attached separately, never embedded.
 * Includes the answer map plus measurements only for suspicious rows.
 */
export function generateBetaFeedbackPrompt({ scanResult, activeTestId, file, fileSha256 }: LLMReportOptions): string {
  // Compact by design: always include identity, overall result, 50 answer
  // decisions and at most 12 detailed review samples. Never paste 50x4 verbose
  // measurements; identifiers are deliberately retained for testing.
  const counts = (['detected', 'blank', 'multiple', 'uncertain', 'error'] as const)
    .map(status => status + '=' + scanResult.answers.filter(q => q.status === status).length).join(', ');
  const lines: string[] = [
    'SFG OMR Lab — compact scan diagnostic',
    getBuildIdentity(),
    'File=' + (file?.name ?? 'camera/unknown') + (file ? ' | ' + (file.size/1024).toFixed(1) + 'KB' : ''),
    'File SHA-256=' + (fileSha256 ?? 'pending/unavailable'),
    'Attach original OMR photo separately; photo pixels are not in this report.',
    'Status=' + scanResult.overallStatus +
      ' | testId=' + (scanResult.testId === null ? 'missing' : String(scanResult.testId).padStart(2,'0')) +
      ' | activeTest=' + (activeTestId == null ? 'none' : String(activeTestId).padStart(2,'0')) +
      ' | QR=' + (scanResult.qrValid ? 'valid' : 'unverified'),
    'Registration=' + (scanResult.registrationMethod || 'none') +
      ' | timing=' + (scanResult.alignmentMatched ?? '?') + '/50' +
      ' | verified=' + String(scanResult.alignmentVerified === true) +
      ' | rotated180=' + String(Boolean(scanResult.orientationRotated)) +
      ' | provisional=' + String(Boolean(scanResult.provisional)),
    'Student ID=' + (scanResult.studentId ?? 'not decoded') +
      ' | QR payload=' + (scanResult.qrRaw ?? 'not decoded'),
    'Processing=' + scanResult.processingTimeMs + 'ms | ' + counts,
  ];
  // Always show experiment states in the COMPACT report too; otherwise a
  // scanner claiming AI improvements cannot be audited without huge logs.
  lines.push(...experimentSummary(scanResult,true));
  if (scanResult.grayCalibration)
    lines.push('Calibration=' + scanResult.grayCalibration.status +
      ' | patches=' + scanResult.grayCalibration.patchMedians.join(',') +
      ' | contrast=' + (scanResult.grayCalibration.contrast ?? '?'));
  if (scanResult.errors.length) lines.push('Errors=' + scanResult.errors.slice(0, 3).join('; '));
  if(scanResult.answers.length===0){
    const logs=scanResult.stageLogs??[];
    const ai=logs.filter(l=>/AI trace: scanic-variant|AI trace: raw-model-corners|AI document boundary recovery|AI candidate verification result|QR-less provisional geometry evidence|AI last-resort summary|Optional AI recovery unavailable/.test(l.message));
    const landmarks=logs.filter(l=>
      /grayscale landmark cross-check|Outer-page boundary recovery evidence|Independent original-photo QR locator/.test(l.message));
    lines.push('Critical registration evidence:');
    for(const l of [...landmarks.slice(-3),...ai.slice(-9)]){
      const data=l.data||{};
      // Avoid repeating full coordinate arrays in a routine compact report.
      const summary=Object.fromEntries(Object.entries(data)
        .filter(([key])=>!['corners','allCandidates','modelTimings','modelStageTimings','imageAnchors','candidateSummary'].includes(key)));
      lines.push('  '+l.message+' '+JSON.stringify(summary));
    }
    if(ai.length===0)lines.push('  No AI fallback evidence recorded.');
    lines.push('No bubble measurements: do not interpret omitted questions as blank/uncertain marks.');
  }
  if (scanResult.answers.length===0) lines.push('No answers were processed: registration failed; this is not a blank sheet.');
  if (scanResult.warnings?.length) lines.push('Warnings=' + scanResult.warnings.slice(0, 2).join('; '));

  if(scanResult.answers.length===50)lines.push('Answer map (— blank, X multiple, ? uncertain/error):');
  for (let start = 1; scanResult.answers.length===50 && start <= 50; start += 10) {
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
  lines.push('Testing report: all available identifiers and source filenames retained.');
  return lines.join('\n');
}
