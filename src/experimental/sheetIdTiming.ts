/** Local timing-track alignment for Sheet ID prototype.
 * Only the 50 independently printed 1.6-mm black timing squares contribute
 * to offsets. No answer ink is used to fit geometry.
 */
import {mmToPx, OMR_LAYOUT} from '../config/omrLayout';
export type TimingOffset={dx:number;dy:number};
export type TimingTrack={
  matched:number;left:number;right:number;valid:boolean;reason:string;
  rows:Array<{row:number;left:TimingOffset|null;right:TimingOffset|null}>;
  maxShiftPx:number;
  offsetForQuestion:(q:number,xMm:number)=>TimingOffset;
};
type Gray={rows:number;cols:number;data?:Uint8Array|Uint8ClampedArray;
  ucharPtr(y:number,x:number):ArrayLike<number>};
const at=(g:Gray,x:number,y:number)=>{
  if(x<0||y<0||x>=g.cols||y>=g.rows)return 255;
  return g.data&&g.data.length>=g.cols*g.rows?
    g.data[y*g.cols+x]:g.ucharPtr(y,x)[0];
};
export function measureTimingTrack(gray:Gray,dpi:number):TimingTrack{
  const W=gray.cols,H=gray.rows;
  const integral=new Int32Array((W+1)*(H+1));
  for(let y=1;y<=H;y++){
    let run=0;
    for(let x=1;x<=W;x++){
      run+=at(gray,x-1,y-1)<135?1:0;
      integral[y*(W+1)+x]=integral[(y-1)*(W+1)+x]+run;
    }
  }
  const sum=(x:number,y:number,r:number)=>{
    const l=x-r,t=y-r,rr=x+r+1,b=y+r+1;
    if(l<0||t<0||rr>W||b>H)return 0;
    return integral[b*(W+1)+rr]-integral[t*(W+1)+rr]-
      integral[b*(W+1)+l]+integral[t*(W+1)+l];
  };
  const locate=(xMm:number,yMm:number):TimingOffset|null=>{
    const x0=Math.round(mmToPx(xMm,dpi)),y0=Math.round(mmToPx(yMm,dpi));
    const radius=Math.round(mmToPx(3.9,dpi));
    let bestScore=-Infinity,best:TimingOffset|null=null;
    for(let dy=-radius;dy<=radius;dy++)
      for(let dx=-radius;dx<=radius;dx++){
        const x=x0+dx,y=y0+dy;
        if(x<10||y<10||x>=W-10||y>=H-10)continue;
        const core=sum(x,y,3)/49;
        if(core<.76)continue;
        const surround=(sum(x,y,9)-sum(x,y,3))/312;
        // 1.6-mm square has a dark interior and light paper surrounding
        // it; a broad dark background region fails this contrast check.
        if(surround>.33)continue;
        const score=core-.8*surround-.00018*(dx*dx+dy*dy);
        if(score>bestScore){bestScore=score;best={dx,dy};}
      }
    return best;
  };
  const {answers}=OMR_LAYOUT;
  const rows=Array.from({length:25},(_,row)=>{
    const y=answers.rowStartY+row*answers.rowSpacingY;
    return {row,left:locate(13.3,y),right:locate(196.7,y)};
  });
  const left=rows.filter(r=>r.left).length,right=rows.filter(r=>r.right).length;
  const matched=left+right;
  // A false positive may resemble one black square. Demand that measured
  // timing positions form locally continuous, physically plausible tracks.
  const coherent=(side:'left'|'right')=>{
    let prev:TimingOffset|null=null;
    for(const r of rows){
      const cur=r[side];
      if(!cur)continue;
      if(prev&&Math.hypot(cur.dx-prev.dx,cur.dy-prev.dy)>12)return false;
      prev=cur;
    }
    return true;
  };
  const valid=matched>=48&&left>=23&&right>=23&&
    coherent('left')&&coherent('right');
  const nearest=(row:number,side:'left'|'right'):TimingOffset=>{
    for(let delta=0;delta<25;delta++)
      for(const idx of [row-delta,row+delta]){
        if(idx>=0&&idx<25&&rows[idx][side])return rows[idx][side]!;
      }
    return {dx:0,dy:0};
  };
  const maxShiftPx=Math.max(0,...rows.flatMap(r=>[r.left,r.right]
    .filter((v):v is TimingOffset=>v!==null).map(v=>Math.hypot(v.dx,v.dy))));
  return {matched,left,right,valid,
    reason:valid?'Both 25-row timing tracks match independently':
      'Timing landmarks insufficient or discontinuous: '+left+'/25 left, '+right+'/25 right',
    rows,maxShiftPx,
    offsetForQuestion:(q,xMm)=>{
      const row=(q-1)%25;
      const l=nearest(row,'left'),r=nearest(row,'right');
      const t=Math.max(0,Math.min(1,(xMm-13.3)/(196.7-13.3)));
      return {dx:l.dx*(1-t)+r.dx*t,dy:l.dy*(1-t)+r.dy*t};
    }
  };
}
