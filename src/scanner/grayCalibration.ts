/**
 * SFG OMR 2.1: seven-patch neutral grayscale strip at bottom of A4.
 * All positions are top-left origin in millimetres, matching corrected images.
 * Printed source: SFG_OMR_2.1_COORDINATES.json.
 * The two white-reference samples are diagnostics, not hard thresholds.
 */
export interface GrayCalibration {
  status: 'ok' | 'low_contrast' | 'unavailable';
  patchMedians: number[];
  contrast: number | null;
  ordered: boolean;
  note: string;
  whiteReferences?: number[];
}
export const CALIBRATION_PATCH_CENTRES_MM = [
  {x:132,y:286.5}, {x:141,y:286.5}, {x:150,y:286.5},
  {x:159,y:286.5}, {x:168,y:286.5}, {x:177,y:286.5},
  {x:186,y:286.5},
] as const;
export const WHITE_REFERENCE_CENTRES_MM = [
  {x:73,y:9.5}, {x:37,y:286.5},
] as const;

type Gray = { rows:number;cols:number;ucharPtr(y:number,x:number):ArrayLike<number> };
function sampleMedian(gray:Gray,dpi:number,xMm:number,yMm:number,halfMm:number):number|null {
  const scale=dpi/25.4, cx=Math.round(xMm*scale), cy=Math.round(yMm*scale);
  const half=Math.max(1,Math.round(halfMm*scale));
  if(cx-half<0||cy-half<0||cx+half>=gray.cols||cy+half>=gray.rows)return null;
  const values:number[]=[];
  for(let y=cy-half;y<=cy+half;y++)
    for(let x=cx-half;x<=cx+half;x++) values.push(gray.ucharPtr(y,x)[0]);
  values.sort((a,b)=>a-b);
  return values[Math.floor(values.length/2)];
}
export function measureGrayCalibration(gray:Gray,dpi:number):GrayCalibration {
  const unavailable=(note:string):GrayCalibration=>({
    status:'unavailable',patchMedians:[],contrast:null,ordered:false,note,
  });
  if(!gray||dpi<=0||!gray.rows||!gray.cols)return unavailable('No corrected grayscale image');
  const medians:number[]=[];
  for(const p of CALIBRATION_PATCH_CENTRES_MM){
    const v=sampleMedian(gray,dpi,p.x,p.y,1.3);
    if(v===null)return unavailable('Calibration strip outside corrected image');
    medians.push(v);
  }
  const whites=WHITE_REFERENCE_CENTRES_MM.map(p=>sampleMedian(gray,dpi,p.x,p.y,1.1));
  const whiteReferences=whites.every(v=>v!==null)?whites as number[]:undefined;
  const contrast=medians[6]-medians[0];
  const ordered=medians.slice(1).every((v,i)=>v+10>=medians[i]);
  const extra={patchMedians:medians,contrast,ordered,whiteReferences};
  if(medians[0]>125||!ordered||contrast<12)
    return {...extra,status:'unavailable',note:'Seven-tone grayscale reference not reliably identified; no scoring impact'};
  if(contrast<55)
    return {...extra,status:'low_contrast',note:'Low separation in seven-tone reference; review lighting and focus'};
  return {...extra,status:'ok',
    note:'Seven-tone grayscale reference usable; top/bottom white samples for illumination diagnostics'};
}
/** Conservative upper limit only; never increase ink threshold based on calibration. */
export function grayStripInkCeiling(c:GrayCalibration):number|null{
  if(c.status!=='ok'||!c.ordered||c.patchMedians.length!==7)return null;
  const [black,,,,,,white]=c.patchMedians;
  if(black>90||white<125||white-black<90)return null;
  return Math.max(100,Math.min(158,Math.round(white-(white-black)*0.22)));
}
