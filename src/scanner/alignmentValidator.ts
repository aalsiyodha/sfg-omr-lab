import { OMR_LAYOUT, mmToPx } from '../config/omrLayout';
import { computeAdaptiveDarkThreshold } from './bubbleDetector';

/**
 * Independently check the 25 left + 25 right timing marks AFTER perspective
 * correction and orientation. Their positions are defined by the printed
 * sheet, not inferred from answer darkness or QR success.
 */
export interface AlignmentCheck {
  passed: boolean;
  matched: number;
  total: number;
  required: number;
  leftMatched: number;
  rightMatched: number;
  reason?: string;
}

export function verifyTimingMarks(grayMat: any, dpi: number): AlignmentCheck {
  const threshold = computeAdaptiveDarkThreshold(grayMat);
  const radius = Math.max(1, Math.round(mmToPx(0.35, dpi)));
  let leftMatched = 0;
  let rightMatched = 0;
  const rowCount = OMR_LAYOUT.answers.questionsPerCol;
  for (let row = 0; row < rowCount; row++) {
    const y = Math.round(mmToPx(OMR_LAYOUT.answers.rowStartY +
      row * OMR_LAYOUT.answers.rowSpacingY, dpi));
    for (const [side, xMm] of [['left', 13.3], ['right', 196.7]] as const) {
      const x = Math.round(mmToPx(xMm, dpi));
      if (x - radius < 0 || y - radius < 0 ||
          x + radius >= grayMat.cols || y + radius >= grayMat.rows) continue;
      let dark = 0, samples = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          samples++;
          if (grayMat.ucharPtr(y + dy, x + dx)[0] < threshold) dark++;
        }
      }
      if (dark / samples >= 0.4) {
        if (side === 'left') leftMatched++;
        else rightMatched++;
      }
    }
  }
  const matched = leftMatched + rightMatched;
  // This is deliberately lenient for photographed/compressed marks. Require
  // evidence from BOTH sides rather than trusting one accidentally dark band.
  const required = 20;
  const passed = matched >= required && leftMatched >= 6 && rightMatched >= 6;
  return {
    passed, matched, total: rowCount * 2, required, leftMatched, rightMatched,
    reason: passed ? undefined :
      `Timing-mark alignment not verified (${matched}/${rowCount * 2}, left=${leftMatched}, right=${rightMatched}). Rescan with the full page visible and sharper contrast.`
  };
}
