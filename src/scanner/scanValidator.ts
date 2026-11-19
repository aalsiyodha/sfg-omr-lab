import type { ScanResult } from '../types';

export function validateScanResult(result: ScanResult): { warnings: string[]; errors: string[] } {
  const warnings = [...result.warnings];
  const errors = [...result.errors];

  // Fail at the earliest untrusted stage. Later missing QR, test ID and answers
  // are consequences, not independent problems that users can fix separately.
  if (!result.perspectiveCorrected) {
    if (errors.length === 0) errors.push('Registration geometry could not be verified. Try another well-lit, full-page photo.');
    return { warnings, errors };
  }
  if (!result.qrValid) {
    if (!errors.some(e => e.includes('orientation'))) errors.push('Page orientation could not be verified from QR position.');
    return { warnings, errors };
  }
  if (result.alignmentVerified === false) {
    if (errors.length === 0) errors.push('The timing marks do not align with the expected answer grid.');
    return { warnings, errors };
  }
  if (result.testId === null || result.testId < 1 || result.testId > 40) {
    errors.push('Test ID missing or outside the valid range 01–40. Check its marked bubbles.');
  }
  if (result.answers.length !== 50) {
    errors.push(`Expected 50 question results, received ${result.answers.length}.`);
    return { warnings, errors };
  }

  const blanks = result.answers.filter(a => a.status === 'blank').length;
  const uncertain = result.answers.filter(a => a.status === 'uncertain').length;
  const multiple = result.answers.filter(a => a.status === 'multiple').length;
  if (multiple) warnings.push(`${multiple} question(s) have multiple selections marked.`);
  if (uncertain) warnings.push(`${uncertain} question(s) have uncertain detections. Please review manually.`);
  if (blanks === 50) errors.push('No answers detected. Verify the sheet and image quality.');
  return { warnings, errors };
}
