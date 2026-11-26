import type { LoadedImage } from './imageLoader';
import { locateQRInPhoto } from './qrDecoder';

/** Select a cheap 90° normalization only when a sheet is photographed sideways.
 * Source QR detection is an orientation hint, not identity or scoring approval.
 * Full registered QR+timing verification is always performed by the scanner.
 */
export function landscapeRotation(
 width:number,height:number,center:{x:number;y:number}|null
):'cw'|'ccw'|'none' {
  if(width<=height*1.12)return 'none';
  if(center){
    const x=center.x/width,y=center.y/height;
    if(x<.50&&y<.50)return 'cw';   // sheet QR is upper-left in sideways shot
    if(x>.50&&y>.50)return 'ccw';  // sheet QR is lower-right in sideways shot
    // Upper-right may be an upright sheet photographed with a wide camera.
    if(x>.50&&y<.50)return 'none';
  }
  // If the QR is too small to decode, try the common sideways capture
  // orientation before expensive fiducial fallback; still fail closed.
  return 'cw';
}
export function orientLandscapePhoto(loaded:LoadedImage):{
 rotation:'cw'|'ccw'|'none';qrFound:boolean;qrValid:boolean;
 qrAttempts:number;initialSize:[number,number];resultSize:[number,number];
}{
  const initialSize:[number,number]=[loaded.width,loaded.height];
  if(loaded.width<=loaded.height*1.12)return {
    rotation:'none',qrFound:false,qrValid:false,qrAttempts:0,
    initialSize,resultSize:initialSize
  };
  const located=locateQRInPhoto(loaded.canvas);
  const rotation=landscapeRotation(loaded.width,loaded.height,
    located.found?located.center:null);
  if(rotation==='none')return {rotation,qrFound:located.found,
    qrValid:located.valid,qrAttempts:located.attempts,initialSize,resultSize:initialSize};
  const rotated=document.createElement('canvas');
  rotated.width=loaded.height;
  rotated.height=loaded.width;
  const ctx=rotated.getContext('2d');
  if(!ctx)throw new Error('Could not normalize landscape OMR photo');
  if(rotation==='cw'){ctx.translate(rotated.width,0);ctx.rotate(Math.PI/2);}
  else{ctx.translate(0,rotated.height);ctx.rotate(-Math.PI/2);}
  ctx.drawImage(loaded.canvas,0,0);
  loaded.canvas=rotated;
  loaded.ctx=ctx;
  loaded.width=rotated.width;
  loaded.height=rotated.height;
  // Avoid creating a duplicate full-frame JPEG data URL. The small first
  // orientation guide is logged, while the original is retained as source.
  return {rotation,qrFound:located.found,qrValid:located.valid,
    qrAttempts:located.attempts,initialSize,
    resultSize:[loaded.width,loaded.height]};
}
