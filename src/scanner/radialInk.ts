/**
 * Fixed-template bubble ink topology. A filled 3.4mm circle must carry
 * broad ink outside its tiny centre. The three radial zones deliberately
 * stop short of the printed 1.7mm ring, avoiding false positives from ink
 * already printed on the blank SFG form.
 *
 * Read-only algorithm: it NEVER moves a bubble centre to chase dark ink.
 * All scores are physical ink coverages, not correctness probabilities.
 */
export interface RadialInkProfile {
  core: number;
  middle: number;
  outer: number;
  corePixels: number;
  middlePixels: number;
  outerPixels: number;
  centreBias: number;
  ringBias: number;
  classification: 'solid_like' | 'centre_dot' | 'hollow_ring' | 'partial' | 'no_ink' | 'insufficient_resolution';
}

export interface RadialRules {
  coreRadiusMm: number;
  middleRadiusMm: number;
  outerRadiusMm: number;
  minOuterCoverage: number;
  minMiddleCoverage: number;
  dotCentreCoverage: number;
  dotOuterMax: number;
  hollowCentreMax: number;
  hollowOuterMin: number;
}

export const RADIAL_RULES: RadialRules = {
  coreRadiusMm: 0.52,
  middleRadiusMm: 1.04,
  outerRadiusMm: 1.40,
  minOuterCoverage: 40,
  minMiddleCoverage: 40,
  dotCentreCoverage: 55,
  dotOuterMax: 30,
  hollowCentreMax: 25,
  hollowOuterMin: 55,
};

/** Analyses the same fixed physical coordinates at any output DPI. */
export function measureRadialInk(
  gray: { rows:number; cols:number; ucharPtr(y:number,x:number):ArrayLike<number> },
  cxPx: number,
  cyPx: number,
  dpi: number,
  threshold: number,
  rules: RadialRules = RADIAL_RULES,
): RadialInkProfile {
  const mmPx = dpi / 25.4;
  const bounds = [
    (rules.coreRadiusMm * mmPx) ** 2,
    (rules.middleRadiusMm * mmPx) ** 2,
    (rules.outerRadiusMm * mmPx) ** 2,
  ];
  const dark = [0,0,0], total = [0,0,0];
  const cx = Math.round(cxPx), cy = Math.round(cyPx);
  const radius = Math.ceil(rules.outerRadiusMm * mmPx);
  for (let dy=-radius;dy<=radius;dy++) {
    const y=cy+dy;
    if (y<0||y>=gray.rows) continue;
    for(let dx=-radius;dx<=radius;dx++){
      const r2=dx*dx+dy*dy;
      if(r2>bounds[2]) continue;
      const x=cx+dx;
      if(x<0||x>=gray.cols) continue;
      const zone = r2<=bounds[0]?0:r2<=bounds[1]?1:2;
      total[zone]++;
      if(gray.ucharPtr(y,x)[0]<threshold)dark[zone]++;
    }
  }
  const [core,middle,outer]=total.map((n,i)=>n ? 100*dark[i]/n : 0);
  const sufficient=total.every(n=>n>=9);
  let classification:RadialInkProfile['classification']='partial';
  if(!sufficient)classification='insufficient_resolution';
  else if(core<15 && middle<15 && outer<15)classification='no_ink';
  else if(core>=rules.dotCentreCoverage && outer<rules.dotOuterMax &&
          middle<rules.minMiddleCoverage)classification='centre_dot';
  else if(core<=rules.hollowCentreMax && outer>=rules.hollowOuterMin)
    classification='hollow_ring';
  else if(middle>=rules.minMiddleCoverage && outer>=rules.minOuterCoverage &&
          core>=rules.hollowCentreMax)classification='solid_like';
  return {
    core, middle, outer,
    corePixels:total[0], middlePixels:total[1], outerPixels:total[2],
    centreBias:core-outer, ringBias:outer-core, classification,
  };
}
