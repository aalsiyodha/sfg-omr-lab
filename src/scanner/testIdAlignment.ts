/**
 * v2.1.2: Fail-closed Test ID rescue from two isolated filled digits.
 * Works when printed-ring registration has insufficient evidence. Searches
 * only a common translation of the entire ID grid; never guesses an ID from
 * one marked row, a close tie, or the known practice test.
 */
import { getTestIdBubbleCentre, mmToPx } from '../config/omrLayout';
import { grayReader, type GrayPixels } from './pixelAccess';
type Gray=GrayPixels;
export interface TestIdOffsetCandidate {dx:number;dy:number;tens:number;units:number;strength:number}
function coreFill(gray:Gray,x:number,y:number,r:number,threshold:number):number {
  const cx=Math.round(x),cy=Math.round(y),rr=Math.max(2,Math.round(r));
  if(cx-rr<0||cy-rr<0||cx+rr>=gray.cols||cy+rr>=gray.rows)return 0;
  const pixel=grayReader(gray);
  let dark=0,total=0;
  for(let dy=-rr;dy<=rr;dy++)for(let dx=-rr;dx<=rr;dx++){
    if(dx*dx+dy*dy>rr*rr)continue;
    total++;
    if(pixel(cy+dy,cx+dx)<threshold)dark++;
  }
  return total?100*dark/total:0;
}
export function rescueTestIdOffset(
  gray:Gray,dpi:number,threshold=145,
):TestIdOffsetCandidate|null {
  if(!gray||dpi<=0)return null;
  const r=mmToPx(0.7,dpi), max=Math.round(mmToPx(2.0,dpi));
  const tens=[0,1,2,3,4,5].map(d=>getTestIdBubbleCentre('tens',d));
  const units=Array.from({length:10},(_,d)=>getTestIdBubbleCentre('units',d));
  let winner:TestIdOffsetCandidate|null=null;
  for(let dy=-max;dy<=max;dy+=2)for(let dx=-max;dx<=max;dx+=2){
    const read=(row:{xMm:number;yMm:number}[])=>row.map((p,d)=>({
      digit:d,fill:coreFill(gray,mmToPx(p.xMm,dpi)+dx,mmToPx(p.yMm,dpi)+dy,r,threshold)
    })).sort((a,b)=>b.fill-a.fill);
    const t=read(tens),u=read(units);
    if(t[0].fill<80||u[0].fill<80||t[1].fill>25||u[1].fill>25)continue;
    const id=t[0].digit*10+u[0].digit;
    if(id<1||id>40)continue;
    const separation=Math.min(t[0].fill-t[1].fill,u[0].fill-u[1].fill);
    const score=separation-0.15*Math.hypot(dx,dy);
    if(!winner||score>winner.strength)
      winner={dx,dy,tens:t[0].digit,units:u[0].digit,strength:Number(score.toFixed(1))};
  }
  return winner;
}
