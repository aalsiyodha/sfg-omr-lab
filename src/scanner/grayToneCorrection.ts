/**
 * Conservative seven-tone image calibration for experimental A/B testing.
 * Unlike the baseline hard ceiling, ALL seven measured tones affect the LUT.
 * The two white-paper references provide a bounded top/bottom correction.
 * Original corrected grayscale is never modified; fail closed on invalid data.
 */
import type { GrayCalibration } from './grayCalibration';
declare const cv: any;

const NOMINAL = [20,36,64,128,191,220,245];
export function buildSevenToneLut(calibration:GrayCalibration):Uint8Array|null {
  const src=calibration.patchMedians;
  if(calibration.status!=='ok'||src.length!==7||!calibration.ordered)return null;
  // Reject near-duplicate patch values: interpolating would amplify noise.
  if(src.slice(1).some((value,i)=>value-src[i]<2))return null;
  const lut=new Uint8Array(256);
  for(let v=0;v<256;v++){
    let k=0;
    while(k<5&&v>src[k+1])k++;
    const a=src[k],b=src[k+1];
    const f=Math.max(0,Math.min(1,(v-a)/Math.max(1,b-a)));
    const nominal=NOMINAL[k]+f*(NOMINAL[k+1]-NOMINAL[k]);
    // Bound correction so an unusual printer's greys do not overwhelm ink.
    const shift=Math.max(-14,Math.min(14,(nominal-v)*.45));
    lut[v]=Math.max(0,Math.min(255,Math.round(v+shift)));
  }
  return lut;
}
export interface ToneCorrectionResult {
  corrected:any;
  applied:boolean;
  topBottomDelta:number;
  description:string;
  /** Map original-image ink threshold into the tone-corrected image domain. */
  mapInkThreshold:(original:number,yPx?:number)=>number;
}
/** Returns an independent clone; caller owns/delete()s it. */
export function applySevenToneCorrection(gray:any,calibration:GrayCalibration):ToneCorrectionResult{
  const corrected=gray.clone();
  const lut=buildSevenToneLut(calibration);
  if(!lut || !corrected.data || corrected.channels()!==1) {
    return {corrected,applied:false,topBottomDelta:0,
      description:'Seven-tone calibration unavailable; original grayscale retained',
      mapInkThreshold:(original:number)=>original};
  }
  const refs=calibration.whiteReferences;
  // White references are at distinct x too, so keep correction VERY small.
  const validRefs=refs&&refs.length===2&&refs.every(v=>v>=140&&v<=255);
  const delta=validRefs?Math.max(-8,Math.min(8,(refs[0]-refs[1])*.12)):0;
  const raw=gray.data;
  const output=corrected.data;
  const W=gray.cols,H=gray.rows;
  for(let y=0;y<H;y++){
    const position=(y/Math.max(1,H-1))-.5;
    const vertical=delta*position;
    const at=y*W;
    for(let x=0;x<W;x++){
      const old=raw[at+x];
      output[at+x]=Math.min(255,Math.max(0,Math.round(lut[old]+vertical)));
    }
  }
  const mapInkThreshold=(original:number,yPx?:number):number=>{
    const intensity=Math.max(0,Math.min(255,Math.round(original)));
    // Apply the EXACT same seven-tone mapping to the decision boundary as
    // to the pixel values. The old code remapped ink pixels but retained the
    // uncorrected ceiling (~158), losing Q18-D near the threshold.
    const position=typeof yPx==='number'
      ? yPx/Math.max(1,H-1)-.5 : 0;
    return Math.max(0,Math.min(255,lut[intensity]+delta*position));
  };
  return {corrected,applied:true,topBottomDelta:delta,mapInkThreshold,
    description:'Seven-tone bounded LUT with threshold/ceiling mapped into the same intensity domain; white-reference vertical correction'};
}
