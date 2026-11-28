/**
 * OMRKit + OMRChecker-inspired read-only comparative optical measurements.
 *
 * Reports alternative classifier signals alongside the strict SFG result.
 * DOES NOT alter any answer, validity decision, or QR/timing registration.
 */
import {getBubbleCentre,mmToPx} from '../config/omrLayout';
import {grayReader} from './pixelAccess';
type Gray={rows:number;cols:number;ucharPtr(y:number,x:number):ArrayLike<number>;data?:Uint8Array|Uint8ClampedArray};
export interface OpticalProbe {
  possible:boolean;reason:string;measured:number;checkerGapThreshold:number|null;
  kitPredictions:string[];checkerPredictions:string[];
  kitVsStrict:number[];checkerVsStrict:number[];
  knownCases:Array<{question:number;strict:string;kit:string;checker:string;
    kitScores:number[];coreMeans:number[]}>;
}
const round=(x:number)=>Math.round(x*1000)/1000;
type Sample={score:number;mean:number;valid:boolean};
const percentile=(vals:number[],fraction:number):number=>{
  if(!vals.length)return 0;
  const sorted=[...vals].sort((a,b)=>a-b);
  return sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*fraction))];
};
export function sampleAlternativeOptics(
  gray:Gray,dpi:number,offset:(q:number)=>{dx:number;dy:number},
  strictAnswers:ReadonlyArray<{question:number;detectedAnswer:string|null;status:string}>
):OpticalProbe {
  const empty=(reason:string):OpticalProbe=>({possible:false,reason,measured:0,
    checkerGapThreshold:null,kitPredictions:[],checkerPredictions:[],
    kitVsStrict:[],checkerVsStrict:[],knownCases:[]});
  if(!gray?.rows||!gray?.cols)return empty('no-registered-grayscale');
  const pixel=grayReader(gray),scale=dpi/25.4;
  const sample=(q:number,opt:0|1|2|3):Sample=>{
    const c=getBubbleCentre(q,opt),b=offset(q);
    const cx=Math.round(mmToPx(c.xMm,dpi)+b.dx),cy=Math.round(mmToPx(c.yMm,dpi)+b.dy);
    const inner:number[]=[],outer:number[]=[];
    const r=Math.ceil(2.6*scale);
    if(cx-r<0||cy-r<0||cx+r>=gray.cols||cy+r>=gray.rows)
      return {score:0,mean:255,valid:false};
    for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
      const d=Math.hypot(dx,dy)/scale;
      if(d<=1.05)inner.push(pixel(cy+dy,cx+dx));
      else if(d>=2.05&&d<=2.55)outer.push(pixel(cy+dy,cx+dx));
    }
    if(inner.length<5||outer.length<10)return {score:0,mean:255,valid:false};
    const paper=percentile(outer,.75);
    const mean=inner.reduce((s,x)=>s+x,0)/inner.length;
    const fill=inner.filter(x=>x<paper-22).length/inner.length;
    const ink=inner.filter(x=>x<paper-36).length/inner.length;
    const dark=Math.max(0,Math.min(1,(paper-mean)/Math.max(1,paper)));
    return {score:Math.max(0,Math.min(1,.44*fill+.36*dark+.20*Math.min(1,ink*2.2))),
      mean,valid:true};
  };
  const groups=Array.from({length:50},(_,i)=>
    [0,1,2,3].map(opt=>sample(i+1,opt as 0|1|2|3)));
  const all=groups.flat();
  const valid=all.filter(x=>x.valid);
  if(valid.length<180)return empty('insufficient-optical-patches');
  // OMRChecker-inspired: choose a significant global intensity gap, then
  // fall back to no decision. We deliberately do not force every question
  // to contain a marked bubble.
  const sorted=valid.map(x=>x.mean).sort((a,b)=>a-b);
  let gap=0,threshold:number|null=null;
  for(let i=1;i<sorted.length;i++){
    const jump=sorted[i]-sorted[i-1];
    if(jump>gap){gap=jump;threshold=(sorted[i]+sorted[i-1])/2;}
  }
  if(gap<10)threshold=null;
  const kitPredictions:string[]=[],checkerPredictions:string[]=[];
  const kitVsStrict:number[]=[],checkerVsStrict:number[]=[];
  const knownCases:OpticalProbe['knownCases']=[];
  const baseline=percentile(valid.map(x=>x.score),.35);
  for(let q=1;q<=50;q++){
    const row=groups[q-1],raw=row.map(x=>x.score);
    const sortedScores=[...raw].sort((a,b)=>b-a);
    const localBase=Math.min(percentile(sortedScores.slice(1),.5),.26*.95);
    const effective=raw.map(x=>Math.max(0,x-localBase));
    const top=Math.max(...effective);
    const kitChosen=effective.flatMap((x,i)=>x>=.20&&x>=top*.70?['ABCD'[i]]:[]);
    const kit=top<.10?'-':kitChosen.length===1?kitChosen[0]:
      kitChosen.length>1?'M':'?';
    // Lower grayscale means darker. Checker's threshold is intentionally a
    // global, provisional prediction; never accepted as a strict answer.
    const cutoff=threshold;
    const checkChosen=cutoff===null?[]:row.flatMap((x,i)=>
      x.valid&&x.mean<cutoff?['ABCD'[i]]:[]);
    const checker=threshold===null?'?':checkChosen.length===0?'-':
      checkChosen.length===1?checkChosen[0]:'M';
    const strictRow=strictAnswers.find(x=>x.question===q);
    const strict=strictRow?.status==='multiple'?'M':strictRow?.status==='uncertain'?'?':
      strictRow?.detectedAnswer??'-';
    kitPredictions.push(kit);checkerPredictions.push(checker);
    if(kit!==strict)kitVsStrict.push(q);
    if(checker!==strict)checkerVsStrict.push(q);
    if([20,38,49].includes(q)||kit!==strict||checker!==strict){
      knownCases.push({question:q,strict,kit,checker,
        kitScores:raw.map(round),coreMeans:row.map(x=>round(x.mean))});
    }
  }
  return {possible:true,reason:'read-only-reference-alternatives;not-UPSC-compliant',
    measured:valid.length,checkerGapThreshold:threshold===null?null:round(threshold),
    kitPredictions,checkerPredictions,kitVsStrict,checkerVsStrict,
    knownCases:knownCases.slice(0,50)};
}
