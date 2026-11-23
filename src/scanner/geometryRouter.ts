/**
 * v2.5.1 bounded geometry decision router.
 * No probabilistic claims and no bypass of QR/timing verification.
 * This is a deterministic baseline to be compared with a future learned
 * decision model only after independently labeled photographs exist.
 */
import { assessGeometry } from './unifiedGeometryPolicy';
export type GeometryAction = 'accept'|'refine'|'recover'|'reject_identity';
export function chooseGeometryAction(e:{
  qrValid:boolean;timingMatched:number;leftMatched:number;rightMatched:number;
  localResidualPx?:number;withheldErrorPx?:number;
}): {action:GeometryAction;reason:string;safeToScore:boolean} {
  const checked=assessGeometry(e);
  if(!e.qrValid)return {action:'reject_identity',reason:'QR identity missing',safeToScore:false};
  if(!checked.valid)return {action:'recover',reason:checked.reason,safeToScore:false};
  // A complete reference lattice may still conceal internal page deformation.
  // Additional local evidence is optional: missing evidence never warrants
  // an expensive mesh operation on otherwise perfect registered photographs.
  const residual=e.localResidualPx??0;
  const heldout=e.withheldErrorPx??0;
  if(heldout>2.0||residual>3.0)
    return {action:'refine',reason:'Local landmark residual warrants bounded correction',
      safeToScore:true};
  if(!checked.complete)return {action:'recover',
    reason:'Near-complete timing needs another registration hypothesis',safeToScore:true};
  return {action:'accept',reason:'Verified QR and 50/50 timing; no further warp',safeToScore:true};
}
