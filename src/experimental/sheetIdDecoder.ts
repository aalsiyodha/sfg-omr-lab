/** Experimental footer verification, separate from production QR validation.
 * Verify BOTH hollow end boxes AND an exact codeword. Do not infer identity
 * from guessed bits or accept an unreadable footer.
 */
import { SHEET_FOOTER, decodeFooterWord, type SheetQuestionCount } from './sheetIdProtocol';
import { mmToPx } from '../config/omrLayout';
type Gray={rows:number;cols:number;ucharPtr(y:number,x:number):ArrayLike<number>};
const sample=(gray:Gray,x:number,y:number,r:number)=>{
 const cx=Math.round(x),cy=Math.round(y),rad=Math.max(1,Math.round(r));
 let dark=0,n=0,total=0;
 for(let yy=cy-rad;yy<=cy+rad;yy++)for(let xx=cx-rad;xx<=cx+rad;xx++){
  if(xx<0||yy<0||xx>=gray.cols||yy>=gray.rows)continue;
  const v=gray.ucharPtr(yy,xx)[0];total+=v;n++;
  if(v<135)dark++;
 }
 return {dark:n?dark/n:0,mean:n?total/n:255};
};
const boxCheck=(gray:Gray,xmm:number,dpi:number)=>{
 const f=SHEET_FOOTER;const x=xmm,y=f.boxYmm;
 const px=(a:number)=>mmToPx(a,dpi);
 // Four printed border samples plus untouched white centre.
 const h=f.boxSizeMm/2;
 const probes=[
  sample(gray,px(x+h),px(y+.4),px(.35)),
  sample(gray,px(x+h),px(y+f.boxSizeMm-.4),px(.35)),
  sample(gray,px(x+.4),px(y+h),px(.35)),
  sample(gray,px(x+f.boxSizeMm-.4),px(y+h),px(.35))
 ];
 const inside=sample(gray,px(x+h),px(y+h),px(.45));
 return {passed:probes.every(p=>p.dark>=.45)&&inside.mean>=155,
  borders:probes.map(p=>Number(p.dark.toFixed(2))),white:Number(inside.mean.toFixed(1))};
};
export interface FooterEvidence {
  valid:boolean;count:SheetQuestionCount|null;word:number;
  bits:string;confidence:number;leftBox:boolean;rightBox:boolean;
  reason:string;
}
export function decodeSheetFooter(gray:Gray,dpi:number):FooterEvidence{
 const f=SHEET_FOOTER;
 const left=boxCheck(gray,f.leftBoxXmm,dpi);
 const right=boxCheck(gray,f.rightBoxXmm,dpi);
 const pixels=Array.from({length:f.bitCount},(_,i)=>{
  const x=mmToPx(f.firstXmm+i*f.spacingMm,dpi);
  return sample(gray,x,mmToPx(f.yMm,dpi),mmToPx(.56,dpi));
 });
 const black=pixels.map(p=>p.mean);
 // A fixed 135 luma classifier is intentionally conservative: no guesses
 // if the image's black/white centers are not well separated.
 const bitValues=black.map(v=>v<135?1:0);
 const word=bitValues.reduce((acc,bit)=>((acc<<1)|bit),0);
 const decoded=decodeFooterWord(word);
 const dark=black.filter((_,i)=>bitValues[i]===1);
 const white=black.filter((_,i)=>bitValues[i]===0);
 const minWhite=Math.min(255,...white);
 const maxDark=Math.max(0,...dark);
 const separation=minWhite-maxDark;
 const contrast=dark.length>0&&white.length>0&&separation>=35;
 const valid=left.passed&&right.passed&&contrast&&decoded.exact;
 return {valid,count:valid?decoded.count:null,word,
  bits:bitValues.join(''),confidence:separation,leftBox:left.passed,rightBox:right.passed,
  reason:valid?'Both footer boxes and exact codeword validated':
    !left.passed||!right.passed?'Footer end-box geometry failed':
    !contrast?'Footer ink separation insufficient':'Unknown or damaged Sheet ID codeword'};
}
