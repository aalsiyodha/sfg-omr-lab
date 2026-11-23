/**
 * v2.5.2 genuinely FITTED (synthetic-data) closed-set multinomial head.
 * A tiny linear softmax model, NOT Google's Gemini/Jev architecture.
 *
 * Weights were optimized by gradient descent using synthetic feature
 * distributions (see scripts/train_synthetic_decision.py).
 * This is NOT validated on real, human-labeled circular OMR bubbles.
 * Scores are uncalibrated; NEVER interpret a score as an empirical
 * correctness probability. It cannot create a new marked answer.
 */
import type { BubbleMeasurement } from '../types';
export const SYNTHETIC_CLASSES = [
 'empty','solid','partial','stroke','hatching','ring'
] as const;
export type SyntheticClass=(typeof SYNTHETIC_CLASSES)[number];
export const SYNTHETIC_MODEL_INFO={
  model:'linear-softmax-v1',trainingData:'synthetically sampled optical feature distributions',
  calibration:'none',realPhotoAccuracy:'unmeasured',scoringPermission:false
} as const;
const WEIGHTS=[
 [-1.415,1.394,0.556,-0.561,-0.179,0.205],
 [-1.279,1.620,2.014,-0.255,-0.101,-2.000],
 [-1.104,1.412,-0.608,-0.142,0.418,0.024],
 [-0.846,1.415,-1.575,-0.581,-0.169,1.755],
 [-1.469,0.775,-0.272,-0.521,0.572,0.915],
 [-1.683,0.466,-0.157,0.024,0.623,0.727],
 [-0.144,-0.812,-1.319,-0.538,3.608,-0.795],
 [-0.577,-0.320,-1.416,3.711,-0.601,-0.797],
 [-1.035,-1.886,0.395,0.837,-0.542,2.231],
 [-0.869,-1.401,0.539,1.067,1.205,-0.541]
] as const;
const BIAS=[4.333,-2.496,1.191,-0.224,-1.421,-1.382] as const;
const unit=(x:number|undefined)=>Math.max(0,Math.min(1,(x??0)/100));
export function decisionFeatures(m:BubbleMeasurement):number[]{
  const core=unit(m.radialCore),middle=unit(m.radialMiddle),
    outer=unit(m.radialOuter);
  return [unit(m.fillPercent),core,middle,outer,
    Math.max(0,Math.min(1,(m.filledSectors??0)/8)),
    Math.max(0,Math.min(1,(m.filledQuadrants??0)/4)),
    m.hatchLike?1:Math.max(0,Math.min(1,(m.hatchGapRows??0)/6)),
    m.strokeLike?1:0,
    Math.max(0,Math.min(1,Math.abs(outer-core))),
    unit(m.stabilitySpread)];
}
export function predictSyntheticDecision(m:BubbleMeasurement):{
  label:SyntheticClass;scores:Record<SyntheticClass,number>;
  margin:number;calibrated:false;
}{
  const features=decisionFeatures(m),logits=BIAS.map((b,j)=>
    b+features.reduce((sum,x,i)=>sum+x*WEIGHTS[i][j],0));
  const peak=Math.max(...logits),exp=logits.map(z=>Math.exp(z-peak));
  const denominator=exp.reduce((a,b)=>a+b,0);
  const probs=exp.map(z=>z/denominator);
  const ordered=probs.map((v,i)=>({v,i})).sort((a,b)=>b.v-a.v);
  const scores=(Object.fromEntries(SYNTHETIC_CLASSES.map((name,i)=>[name,probs[i]])))
    as Record<SyntheticClass,number>;
  return {label:SYNTHETIC_CLASSES[ordered[0].i],scores,
    margin:ordered[0].v-ordered[1].v,calibrated:false};
}
