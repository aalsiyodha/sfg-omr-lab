/**
 * v2.5 unified optical geometry acceptance policy.
 * Independent evidence: QR identity, 25 left timing squares, 25 right timing
 * squares. Grayscale strip is evaluated later as calibration evidence, never
 * as a substitute for identity. A 49/50 candidate is valid for further
 * processing but is not grounds to skip an available 50/50 alternative.
 */
export type GeometryEvidence = {
  qrValid: boolean;
  timingMatched: number;
  leftMatched: number;
  rightMatched: number;
};
export function assessGeometry(e: GeometryEvidence): {
  valid: boolean; complete: boolean; continueRecovery: boolean; reason: string;
} {
  const countsValid = Number.isInteger(e.timingMatched) &&
    Number.isInteger(e.leftMatched) && Number.isInteger(e.rightMatched) &&
    e.leftMatched >= 0 && e.leftMatched <= 25 &&
    e.rightMatched >= 0 && e.rightMatched <= 25 &&
    e.timingMatched === e.leftMatched + e.rightMatched;
  if (!e.qrValid) return {valid:false,complete:false,continueRecovery:true,reason:'QR identity not verified'};
  if (!countsValid) return {valid:false,complete:false,continueRecovery:true,reason:'Inconsistent timing evidence'};
  const complete = e.leftMatched === 25 && e.rightMatched === 25;
  return {
    valid: e.timingMatched >= 48 && e.leftMatched >= 23 && e.rightMatched >= 23,
    complete, continueRecovery: !complete,
    reason: complete ? 'Complete independent timing registration' :
      'Recover missing timing marks before early exit'
  };
}
export function canStopUnifiedRegistration(qrValid:boolean,timingMatched:number,leftMatched:number,rightMatched:number):boolean{
  return assessGeometry({qrValid,timingMatched,leftMatched,rightMatched}).complete;
}
