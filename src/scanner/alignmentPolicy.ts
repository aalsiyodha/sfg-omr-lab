/** v2.2.2 registration policy. Pure functions for repeatable regression tests. */
export type RegistrationKind = 'corner' | 'midpoint' | 'aruco';
export interface RegistrationEvidence {
  kind: RegistrationKind;
  timingMatched: number;
  leftMatched: number;
  rightMatched: number;
  qrVerified: boolean;
}
/** Geometry is only eligible after both independent timing bands and QR verify. */
export function registrationScore(e: RegistrationEvidence): number {
  if (!e.qrVerified || e.timingMatched < 20 ||
      e.leftMatched < 6 || e.rightMatched < 6) return -Infinity;
  // Prefer more independent timing marks, then direct corner geometry.
  return e.timingMatched + 1 + (e.kind === 'corner' ? 0.25 : 0);
}
/** Avoid costly redundant Otsu square warps after a strong upright match. */
export function skipRedundantFallback(
  bestTimingMatched: number | null,
  candidateName: string,
  kind: RegistrationKind
): boolean {
  return bestTimingMatched !== null && bestTimingMatched >= 44 &&
    (candidateName.endsWith('/Otsu') || candidateName.endsWith('-Otsu')) &&
    kind !== 'aruco';
}

/** A verified warp may be refined only with an independent, strictly better
 * left/right timing result. Never replace a perfect or degraded registration.
 * Weak initial registrations need a substantial gain (>=8) to avoid
 * accepting spurious timing squares.
 */
export function shouldAdoptTimingRefinement(
  before: {passed:boolean;matched:number;leftMatched:number;rightMatched:number},
  after: {passed:boolean;matched:number;leftMatched:number;rightMatched:number},
): boolean {
  if (!after.passed || before.matched >= 50) return false;
  if (before.passed) {
    return after.matched > before.matched &&
      after.leftMatched >= before.leftMatched &&
      after.rightMatched >= before.rightMatched;
  }
  return after.matched >= before.matched + 8;
}
