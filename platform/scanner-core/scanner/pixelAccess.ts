/** Guarded CV_8UC1 pixel reader; respects ROI row strides and fake test Mats. */
export interface GrayPixels {
  rows:number; cols:number;
  ucharPtr(y:number,x:number):ArrayLike<number>;
  data?:Uint8Array|Uint8ClampedArray;
  step?:number;
  channels?:()=>number;
}
export function grayReader(mat:GrayPixels):(y:number,x:number)=>number {
  const bytes=mat.data;
  const step=typeof mat.step==='number'?mat.step:mat.cols;
  const channels=typeof mat.channels==='function'?mat.channels():1;
  if((bytes instanceof Uint8Array||bytes instanceof Uint8ClampedArray)&&
    channels===1 && Number.isSafeInteger(step) && step>=mat.cols &&
    bytes.length>=step*(mat.rows-1)+mat.cols) {
    return (y,x)=>bytes[y*step+x];
  }
  return (y,x)=>mat.ucharPtr(y,x)[0];
}
