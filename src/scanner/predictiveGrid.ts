/**
 * v2.5.1 predictive Local-Grid shadow experiment.
 * A tiny deterministic "predictive representation" baseline: neighboring
 * ring-offset estimates predict the expected offset at each answer row.
 * Unlike JEPA, no weights have been trained and no semantic embeddings.
 * Predictions are diagnostic only until held-out printed landmarks validate
 * a correction on real photographs.
 */
import type { GridAlignment, GridOffset } from './gridAlignment';
export type PredictedOffset = {
  dx:number;dy:number;valid:boolean;uncertaintyPx:number;
  source:'interpolated'|'verified-neighbor'|'unavailable';
};
const valid=(x:GridOffset)=>x.applied&&x.confidence>=6;
export function predictGridOffset(grid:GridAlignment,q:number):PredictedOffset {
  const left=q<=25,row=left?q:q-25;
  const upper=left?grid.leftUpper:grid.rightUpper;
  const lower=left?grid.leftLower:grid.rightLower;
  const a=valid(upper),b=valid(lower);
  if(!a&&!b)return {dx:0,dy:0,valid:false,
    uncertaintyPx:0,source:'unavailable'};
  if(a&&!b||!a&&b){
    const known=a?upper:lower;
    return {dx:known.dx,dy:known.dy,valid:true,
      uncertaintyPx:3,source:'verified-neighbor'};
  }
  // Anchor center rows: upper sample 1-12 -> row 6.5,
  // lower sample 13-25 -> row 19. Both are fixed printed-ring probes.
  const t=Math.max(0,Math.min(1,(row-6.5)/12.5));
  const dx=upper.dx*(1-t)+lower.dx*t;
  const dy=upper.dy*(1-t)+lower.dy*t;
  const disagreement=Math.hypot(upper.dx-lower.dx,upper.dy-lower.dy);
  return {dx,dy,valid:true,uncertaintyPx:disagreement/2,
    source:'interpolated'};
}
export function summarizePredictedGrid(grid:GridAlignment){
  const rows=Array.from({length:50},(_,i)=>({
    question:i+1,...predictGridOffset(grid,i+1)
  }));
  const highDrift=rows.filter(r=>r.valid&&r.uncertaintyPx>=3);
  return {predicted:rows.filter(r=>r.valid).length,
    highDriftQuestions:highDrift.map(r=>r.question),
    maxUncertaintyPx:Math.max(0,...rows.map(r=>r.uncertaintyPx)),
    note:'Diagnostic only; never shift grading coordinates without held-out ring verification'};
}
