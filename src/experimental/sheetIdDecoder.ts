/** QR-free experimental Sheet ID reader.
 * The printed hollow boxes have THIN outlines: measure edge profiles, never
 * sample 0.4 mm inside the stroke. Bound the footer search to +/-2 mm from
 * a four-corner-warped A4. Every accepted candidate must verify both hollow
 * boxes AND an exact 16-bit word; the scanner independently requires timing.
 */
import { SHEET_FOOTER, decodeFooterWord, type SheetQuestionCount } from './sheetIdProtocol';
import { mmToPx } from '../config/omrLayout';

type Gray={rows:number;cols:number;ucharPtr(y:number,x:number):ArrayLike<number>;
  data?:Uint8Array|Uint8ClampedArray};
type Probe={passed:boolean;score:number;edges:number[];white:number};
const pixel=(gray:Gray,x:number,y:number)=>{
 const xx=Math.round(x),yy=Math.round(y);
 if(xx<0||yy<0||xx>=gray.cols||yy>=gray.rows)return 255;
 const data=gray.data;
 return data&&data.length>=gray.cols*gray.rows?data[yy*gray.cols+xx]:
   gray.ucharPtr(yy,xx)[0];
};
const average=(gray:Gray,x:number,y:number,r:number)=>{
 const cx=Math.round(x),cy=Math.round(y),rad=Math.max(1,Math.round(r));
 let sum=0,n=0;
 for(let dy=-rad;dy<=rad;dy++)for(let dx=-rad;dx<=rad;dx++){
  if(dx*dx+dy*dy>rad*rad)continue;
  sum+=pixel(gray,cx+dx,cy+dy);n++;
 }
 return n?sum/n:255;
};
const boxCheck=(gray:Gray,xmm:number,dpi:number,dxMm:number,dyMm:number):Probe=>{
 const f=SHEET_FOOTER,scale=dpi/25.4;
 const x=(xmm+dxMm)*scale,y=(f.boxYmm+dyMm)*scale,s=f.boxSizeMm*scale;
 // Six regularly spaced profile probes per edge. For each, locate the
 // *minimum* luma across a short 0.6 mm normal segment centred ON the line.
 // This tolerates antialiasing and 1px stroke changes but NOT an absent box.
 const offset=.35*scale;
 const edge=(side:number)=>{
  let dark=0;
  for(let i=1;i<=6;i++){
   const t=i/7,along=t*s;
   let min=255;
   for(let j=-2;j<=2;j++){
    const d=j*offset/2;
    const px=side===0?x+along:side===1?x+along:side===2?x+d:x+s+d;
    const py=side===0?y+d:side===1?y+s+d:y+along;
    min=Math.min(min,pixel(gray,px,py));
   }
   if(min<185)dark++;
  }
  return dark/6;
 };
 const edges=[edge(0),edge(1),edge(2),edge(3)];
 const white=average(gray,x+s/2,y+s/2,.55*scale);
 return {passed:edges.every(v=>v>=.66)&&white>=160,
   score:edges.reduce((a,b)=>a+b,0)/4,edges,white};
};
export interface FooterEvidence {
 valid:boolean;count:SheetQuestionCount|null;word:number;bits:string;
 confidence:number;leftBox:boolean;rightBox:boolean;reason:string;
 offsetMm:{dx:number;dy:number};
 candidatesChecked:number;leftEdgeScores:number[];rightEdgeScores:number[];
}
function inspect(gray:Gray,dpi:number,dx:number,dy:number):FooterEvidence{
 const f=SHEET_FOOTER,scale=dpi/25.4;
 const left=boxCheck(gray,f.leftBoxXmm,dpi,dx,dy);
 const right=boxCheck(gray,f.rightBoxXmm,dpi,dx,dy);
 const means=Array.from({length:f.bitCount},(_,i)=>average(gray,
  (f.firstXmm+i*f.spacingMm+dx)*scale,(f.yMm+dy)*scale,.56*scale));
 // Restrict decoding to decisively separated centre samples; never decide
 // a bit from the printed circular outline or assume all-white is valid.
 const bits=means.map(v=>v<135?1:0);
 const word=bits.reduce<number>((v,b)=>((v<<1)|b),0);
 const parsed=decodeFooterWord(word);
 const blacks=means.filter((_,i)=>bits[i]===1);
 const whites=means.filter((_,i)=>bits[i]===0);
 const contrast=blacks.length&&whites.length?
  Math.min(...whites)-Math.max(...blacks):0;
 const readable=contrast>=30;
 const valid=left.passed&&right.passed&&Boolean(readable)&&parsed.exact;
 return {valid,count:valid?parsed.count:null,word,bits:bits.join(''),
  confidence:contrast,leftBox:left.passed,rightBox:right.passed,
  reason:valid?'Exact footer and both hollow references verified':
    !left.passed||!right.passed?'Footer end-box geometry failed':
    !readable?'Footer contrast insufficient':'Footer codeword mismatch',
  offsetMm:{dx,dy},candidatesChecked:1,
  leftEdgeScores:left.edges,rightEdgeScores:right.edges};
}
export function decodeSheetFooter(gray:Gray,dpi:number):FooterEvidence{
 let best=inspect(gray,dpi,0,0);
 if(best.valid)return best;
 let checked=1;
 // Prefer exact zero-offset. Only attempt a bounded local search when needed.
 // Each candidate still needs TWO real boxes AND an exact known codeword.
 for(const delta of [.5,1,1.5,2]){
  for(const dx of [-delta,0,delta])for(const dy of [-delta,0,delta]){
   if(dx===0&&dy===0)continue;
   const next=inspect(gray,dpi,dx,dy);checked++;
   if(next.valid)return {...next,candidatesChecked:checked};
   const quality=Number(next.leftBox)+Number(next.rightBox)+
    (next.confidence>=30?1:0)+
    next.leftEdgeScores.reduce((a,b)=>a+b,0)/4+
    next.rightEdgeScores.reduce((a,b)=>a+b,0)/4;
   const bestQuality=Number(best.leftBox)+Number(best.rightBox)+
    (best.confidence>=30?1:0)+
    best.leftEdgeScores.reduce((a,b)=>a+b,0)/4+
    best.rightEdgeScores.reduce((a,b)=>a+b,0)/4;
   if(quality>bestQuality)best=next;
  }
 }
 return {...best,candidatesChecked:checked,
  reason:best.reason+'; no exact two-box/known-code match within 2 mm'};
}
