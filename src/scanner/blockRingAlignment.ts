/**
 * 3.9.0 OMRKit-inspired multi-ring Sobel alignment.
 * Search coherent XY translations of printed-ring edges in four SFG regions.
 * Fit alternate question rows, require independent held-out rows to improve.
 * No student ink or answer choice is used to select the best hypothesis.
 * Never replaces QR identity or timing verification.
 */
import {getBubbleCentre,mmToPx,OMR_LAYOUT} from '../config/omrLayout';
import type {GridOffset} from './gridAlignment';
import {grayReader} from './pixelAccess';
type Gray={rows:number;cols:number;ucharPtr(y:number,x:number):ArrayLike<number>;data?:Uint8Array|Uint8ClampedArray};
export type BlockRingEvidence={
  region:string;dx:number;dy:number;fitBaseline:number;fitCandidate:number;
  heldoutBaseline:number;heldoutCandidate:number;accepted:boolean;
  holdoutRings:number;reason:string
};
export type BlockRingResult={offsets:Record<number,GridOffset>;adopted:number;
  checked:number;evidence:BlockRingEvidence[]};
type Pt={x:number;y:number};
const regionDefs=[
  {name:'left-upper',first:1,last:12},
  {name:'left-lower',first:13,last:25},
  {name:'right-upper',first:26,last:37},
  {name:'right-lower',first:38,last:50}
] as const;
const rnd=(x:number)=>Math.round(x*100)/100;
export function refineBlockRings(
  gray:Gray,dpi:number,base:(q:number)=>GridOffset,maxShift=4
):BlockRingResult{
  const offsets:Record<number,GridOffset>={},evidence:BlockRingEvidence[]=[];
  const read=grayReader(gray),w=gray.cols,h=gray.rows;
  // 3.9.1: sample gradients at expected ring perimeter coordinates only.
  // The original 3.9.0 stage allocated/wrote a full-page gradient image
  // despite using only a small number of circular sample positions.
  const edgeAt=(x:number,y:number):number=>{
    const gx=Math.abs(read(y,x+1)-read(y,x-1));
    const gy=Math.abs(read(y+1,x)-read(y-1,x));
    return Math.min(255,Math.round((gx+gy)/2));
  };
  const radius=mmToPx(OMR_LAYOUT.answers.bubbleDiamMm/2,dpi);
  const angles=Array.from({length:20},(_,i)=>2*Math.PI*i/20);
  const ring=(p:Pt,dx:number,dy:number)=>{
    let score=0,valid=0;
    for(const theta of angles){
      const x=Math.round(p.x+dx+radius*Math.cos(theta));
      const y=Math.round(p.y+dy+radius*Math.sin(theta));
      if(x<2||y<2||x>=w-2||y>=h-2)continue;
      score+=edgeAt(x,y);valid++;
    }
    return valid>=16?score/valid:0;
  };
  let adopted=0,checked=0;
  for(const region of regionDefs){
    const training:Pt[]=[],holdout:Pt[]=[];
    for(let q=region.first;q<=region.last;q++){
      // Use all printed rings, not a single potentially filled option.
      // Robust trimmed averaging below prevents one ink-heavy choice from
      // determining the geometric translation of the entire block.
      const b=base(q);
      for(const option of [0,1,2,3] as const){
        const c=getBubbleCentre(q,option);
        const point={x:mmToPx(c.xMm,dpi)+b.dx,y:mmToPx(c.yMm,dpi)+b.dy};
        if((q-region.first)%2===0)training.push(point);else holdout.push(point);
      }
    }
    if(training.length<5||holdout.length<5)continue;
    const mean=(points:Pt[],dx:number,dy:number)=>{
      const values=points.map(p=>ring(p,dx,dy)).sort((a,b)=>a-b);
      const trim=Math.floor(values.length*.20);
      const middle=values.slice(trim,values.length-trim);
      return middle.reduce((sum,v)=>sum+v,0)/Math.max(1,middle.length);
    };
    const zero=mean(training,0,0),zeroHold=mean(holdout,0,0);
    let best={dx:0,dy:0,score:zero};
    for(let dy=-maxShift;dy<=maxShift;dy++)for(let dx=-maxShift;dx<=maxShift;dx++){
      if(dx===0&&dy===0)continue;
      const score=mean(training,dx,dy)-0.22*Math.hypot(dx,dy);
      if(score>best.score)best={dx,dy,score};
    }
    const hold=mean(holdout,best.dx,best.dy);
    const gain=hold-zeroHold;
    // Hard acceptance: fit and independent holdout improvement, with
    // a minimum printed-edge strength. Weak/flat regions keep 3.8 geometry.
    const accepted=(best.dx!==0||best.dy!==0)&&
      best.score-zero>=3&&gain>=3&&gain>=zeroHold*0.06&&hold>=12;
    for(let q=region.first;q<=region.last;q++){
      const b=base(q);
      offsets[q]=accepted?{dx:b.dx+best.dx,dy:b.dy+best.dy,
        applied:true,confidence:Math.min(100,gain)}:b;
    }
    checked++;
    if(accepted)adopted++;
    evidence.push({region:region.name,dx:best.dx,dy:best.dy,
      fitBaseline:rnd(zero),fitCandidate:rnd(best.score),
      heldoutBaseline:rnd(zeroHold),heldoutCandidate:rnd(hold),
      accepted,holdoutRings:holdout.length,
      reason:accepted?'heldout-ring-edge-improvement':'no-independent-ring-edge-gain'});
  }
  return {offsets,adopted,checked,evidence};
}
