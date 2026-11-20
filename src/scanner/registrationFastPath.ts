/**
 * v2.3: stop spending CPU on alternative full-page warps only
 * after the QR identity and both independent timing bands are perfect.
 * Intentionally retains the baseline fallback path for 49/50 or worse.
 */
export function canStopRegistrationSearch(
  qrVerified: boolean,
  timingMatched: number,
  leftMatched: number,
  rightMatched: number,
): boolean {
  return qrVerified && timingMatched === 50 &&
    leftMatched === 25 && rightMatched === 25;
}
