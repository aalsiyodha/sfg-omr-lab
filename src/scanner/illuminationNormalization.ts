/**
 * 3.9.1: OMRKit-inspired smooth paper illumination division.
 * Uses a downscaled morphological closing + Gaussian illumination field.
 * Normalized output is a SHADOW comparator only: it never directly changes
 * official answer grades or bypasses QR + bilateral timing verification.
 * Own returned Mat and call .delete() after use.
 */
declare const cv:any;
export interface IlluminationEvidence {
  supported:boolean;reason:string;elapsedMs:number;scale:number;
  paperMin:number;paperMax:number;correctedPixels:number;
}
export function dividePaperPixel(gray:number,paper:number):number {
  return Math.max(0,Math.min(255,Math.round(245*(gray+1)/(paper+1))));
}
export function normalizePaperIllumination(gray:any):{
  normalized:any|null;evidence:IlluminationEvidence
}{
  const start=Date.now();
  const details:IlluminationEvidence={
    supported:false,reason:'not-attempted',elapsedMs:0,scale:1,
    paperMin:255,paperMax:0,correctedPixels:0};
  const done=(reason:string,normalized:any=null)=>{
    details.supported=Boolean(normalized);
    details.reason=reason;details.elapsedMs=Date.now()-start;
    return {normalized,evidence:details};
  };
  let small:any=null,closed:any=null,background:any=null,fullBackground:any=null;
  let kernel:any=null,result:any=null;
  try{
    if(!gray||!gray.cols||!gray.rows||!gray.data||
       gray.data.length!==gray.cols*gray.rows)
      return done('requires contiguous 8-bit single channel grayscale');
    const minSide=Math.min(gray.cols,gray.rows);
    const scale=minSide>=600?4:2;
    details.scale=scale;
    const sw=Math.max(32,Math.round(gray.cols/scale));
    const sh=Math.max(32,Math.round(gray.rows/scale));
    small=new cv.Mat();closed=new cv.Mat();background=new cv.Mat();
    fullBackground=new cv.Mat();
    cv.resize(gray,small,new cv.Size(sw,sh),0,0,cv.INTER_AREA);
    const closeSize=Math.max(5,Math.floor(Math.min(sw,sh)*.025)|1);
    kernel=cv.getStructuringElement(cv.MORPH_ELLIPSE,
      new cv.Size(closeSize,closeSize));
    cv.morphologyEx(small,closed,cv.MORPH_CLOSE,kernel);
    const blurSize=Math.max(7,Math.floor(Math.min(sw,sh)*.045)|1);
    cv.GaussianBlur(closed,background,new cv.Size(blurSize,blurSize),0);
    cv.resize(background,fullBackground,new cv.Size(gray.cols,gray.rows),0,0,
      cv.INTER_LINEAR);
    result=gray.clone();
    const src=gray.data as Uint8Array;
    const bg=fullBackground.data as Uint8Array;
    const dst=result.data as Uint8Array;
    if(!bg||bg.length!==src.length||dst.length!==src.length)
      return done('background output buffer mismatch');
    let lo=255,hi=0;
    for(let i=0;i<src.length;i++){
      const b=bg[i];
      if(b<lo)lo=b;if(b>hi)hi=b;
      dst[i]=dividePaperPixel(src[i],b);
    }
    details.paperMin=lo;details.paperMax=hi;
    details.correctedPixels=src.length;
    const normalized=result;result=null;
    return done('ok',normalized);
  }catch(error){return done('OpenCV illumination normalization unavailable: '+String(error));}
  finally{
    for(const v of [small,closed,background,fullBackground,kernel,result])
      try{v?.delete?.();}catch{}
  }
}
