/**
 * Read-only diagnostic for rejected QR-valid registrations.
 * Samples nearby darkness without influencing timing acceptance, refinement
 * or any answer decision. The nearest dark patch is NOT necessarily a
 * printed timing square; treat these as approximate, unverified offsets.
 */
import { OMR_LAYOUT, mmToPx } from '../config/omrLayout';
import { computeAdaptiveDarkThreshold } from './bubbleDetector';
import { grayReader } from './pixelAccess';
type Side='left'|'right';
export interface TimingResidual {
  row:number;side:Side;darkAtExpected:boolean;
  dxMm:number|null;dyMm:number|null;quality:number;
}
export interface TimingResidualReport {
  searchRadiusMm:number;threshold:number;
  foundNearby:number;leftNearby:number;rightNearby:number;
  medianAbsDxMm:number|null;medianAbsDyMm:number|null;
  samples:TimingResidual[];
  warning:string;
}
const median=(a:number[])=>{
  if(!a.length)return null;
  const sorted=[...a].sort((x,y)=>x-y);
  return sorted[Math.floor(sorted.length/2)];
};
export function diagnosticTimingResiduals(gray:any,dpi:number):TimingResidualReport {
  const threshold=computeAdaptiveDarkThreshold(gray);
  const read=grayReader(gray);
  const px=(n:number)=>mmToPx(n,dpi);
  const radius=Math.max(1,Math.round(px(.35)));
  const search=Math.max(2,Math.round(px(2.0)));
  const samples:TimingResidual[]=[];
  let foundNearby=0,leftNearby=0,rightNearby=0;
  const absDx:number[]=[],absDy:number[]=[];
  for(const side of ['left','right'] as const)for(let i=0;i<25;i++){
    const x=Math.round(px(side==='left'?13.3:196.7));
    const y=Math.round(px(OMR_LAYOUT.answers.rowStartY+
      i*OMR_LAYOUT.answers.rowSpacingY));
    let best=-Infinity,bestDx=0,bestDy=0;
    const score=(cx:number,cy:number)=>{
      let dark=0,seen=0;
      for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
        if(cx+dx<0||cy+dy<0||cx+dx>=gray.cols||cy+dy>=gray.rows)continue;
        seen++;
        if(read(cy+dy,cx+dx)<threshold)dark++;
      }
      return seen?dark/seen:0;
    };
    const atExpected=score(x,y);
    for(let dy=-search;dy<=search;dy+=2){
      for(let dx=-search;dx<=search;dx+=2){
        // Prefer the expected location on equal-quality dark patches; the
        // local search is only a signed-residual diagnostic, not a fitter.
        const quality=score(x+dx,y+dy)-.015*Math.hypot(dx,dy);
        if(quality>best){best=quality;bestDx=dx;bestDy=dy;}
      }
    }
    const reliable=best>=.48;
    if(reliable){
      foundNearby++;
      if(side==='left')leftNearby++;else rightNearby++;
      absDx.push(Math.abs(bestDx*25.4/dpi));
      absDy.push(Math.abs(bestDy*25.4/dpi));
    }
    samples.push({row:i+1,side,darkAtExpected:atExpected>=.4,
      dxMm:reliable?Number((bestDx*25.4/dpi).toFixed(2)):null,
      dyMm:reliable?Number((bestDy*25.4/dpi).toFixed(2)):null,
      quality:Number(Math.max(0,best).toFixed(2))});
  }
  const format=(v:number|null)=>v===null?null:Number(v.toFixed(2));
  return {searchRadiusMm:2,threshold,
    foundNearby,leftNearby,rightNearby,
    medianAbsDxMm:format(median(absDx)),
    medianAbsDyMm:format(median(absDy)),samples,
    warning:'Candidate dark patches are not verified timing squares. Diagnostics only: acceptance, 0.35mm sample and all timing thresholds unchanged.'};
}
