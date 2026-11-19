import type { ScanResult } from '../types';

export function validateScanResult(result: ScanResult): { warnings: string[]; errors: string[] } {
  const warnings = [...result.warnings];
  const errors = [...result.errors];
  
  if (!result.qrValid) {
    errors.push('QR code not verified in its expected location; page orientation is untrusted.');
  }
  if (result.markerCount < 4) {
    errors.push(`Only ${result.markerCount}/4 registration markers detected. Scan may be inaccurate.`);
  }
  if (!result.perspectiveCorrected) {
    errors.push('Perspective correction not applied; answer locations cannot be trusted.');
  }
  if (result.testId === null) {
    errors.push('Test ID not detected. Verify geometry and marking before scoring.');
  }
  if (result.testId !== null && (result.testId < 1 || result.testId > 40)) {
    errors.push(`Detected test ID ${result.testId} is outside valid range 01–40.`);
  }
  
  if (result.answers.length !== 50) errors.push(`Expected 50 question results, received ${result.answers.length}.`);
  const blanks = result.answers.filter(a => a.status === 'blank').length;
  const uncertain = result.answers.filter(a => a.status === 'uncertain').length;
  const multiple = result.answers.filter(a => a.status === 'multiple').length;
  
  if (multiple > 0) warnings.push(`${multiple} question(s) have multiple selections marked.`);
  if (uncertain > 0) warnings.push(`${uncertain} question(s) have uncertain detections. Please review manually.`);
  if (blanks === 50) errors.push('No answers detected. Check image quality and orientation.');
  
  return { warnings, errors };
}
