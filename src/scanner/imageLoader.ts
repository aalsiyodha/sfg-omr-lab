// src/scanner/imageLoader.ts

export interface LoadedImage {
  element: HTMLImageElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  dataUrl: string;
}

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

export interface FileDecodeOptions { compact?: boolean }

/** Browser-native bitmap decode avoids a multi-megabyte base64 FileReader
 * string plus a second HTMLImage decoder. In multi-photo mode, never JPEG-
 * serialize the normalized source again merely for an unused preview.
 */
/** Read only the JPEG APP1 header: EXIF orientation determines whether the
 * decoded bitmap is portrait. No full-size bitmap is ever allocated here.
 * A rotated phone JPEG commonly stores landscape pixels with orientation 6.
 */
export async function jpegIsExifPortrait(file:File):Promise<boolean>{
  if(!/image\/jpe?g/.test(file.type))return false;
  try{
    const bytes=new DataView(await file.slice(0,131072).arrayBuffer());
    if(bytes.byteLength<16||bytes.getUint16(0)!==0xffd8)return false;
    let i=2;
    while(i+4<bytes.byteLength){
      if(bytes.getUint8(i)!==0xff){i++;continue;}
      const tag=bytes.getUint8(i+1);
      if(tag===0xda||tag===0xd9)break;
      if(tag===0xff||tag===0x00){i++;continue;}
      const length=bytes.getUint16(i+2);
      if(length<2||i+2+length>bytes.byteLength)break;
      if(tag===0xe1&&length>=16&&bytes.getUint32(i+4)===0x45786966){
        const tiff=i+10;
        const little=bytes.getUint16(tiff)===0x4949;
        if(!little&&bytes.getUint16(tiff)!==0x4d4d)return false;
        const ifd=tiff+bytes.getUint32(tiff+4,little);
        if(ifd+2>=bytes.byteLength)return false;
        const count=bytes.getUint16(ifd,little);
        for(let n=0;n<Math.min(count,128);n++){
          const off=ifd+2+n*12;
          if(off+12>bytes.byteLength)break;
          if(bytes.getUint16(off,little)!==0x0112)continue;
          const value=bytes.getUint16(off+8,little);
          return value===5||value===6||value===7||value===8;
        }
      }
      i+=2+length;
    }
  }catch{/* malformed EXIF: standard decoder fallback */}
  return false;
}

export async function loadImageFromFile(
  file: File, options: FileDecodeOptions = {}
): Promise<LoadedImage> {
  if (!['image/jpeg','image/jpg','image/png','image/webp'].includes(file.type))
    throw new Error('Unsupported image format. Use JPG, PNG or WebP.');
  if (file.size > 25 * 1024 * 1024)
    throw new Error('Image exceeds 25 MB; use a smaller image.');

  // The bounded decode prevents a 12–48MP phone photo from allocating a
  // full-resolution canvas before the 1600px scanner normalization.
  const maxWidth = 1600;
  let timeoutId:ReturnType<typeof setTimeout>|undefined;
  let timedOut=false;
  const timeout = new Promise<never>((_,reject)=>{
    timeoutId=setTimeout(()=>{
      timedOut=true;
      reject(new Error('Image decoding took too long. Try JPG/PNG or a smaller photo.'))
    },18000);
  });
  let bitmap:ImageBitmap|null=null;
  try {
    const portraitExif=await jpegIsExifPortrait(file);
    // The bitmap decoder honors EXIF. Resize its LONG side, not its raw
    // landscape width, to avoid a second interpolation of portrait photos.
    bitmap=await Promise.race([
      createImageBitmap(file,portraitExif
        ?{resizeHeight:maxWidth,resizeQuality:'high'}
        :{resizeWidth:maxWidth,resizeQuality:'high'}),
      timeout
    ]);
    if(timedOut)throw new Error('Image decoding timed out');
    if(!bitmap.width||!bitmap.height)throw new Error('Image has invalid dimensions');
    let w=bitmap.width,h=bitmap.height;
    // resizeWidth can increase smaller input files. Cap the actual working
    // dimension and never feed oversized images to OpenCV.
    if(Math.max(w,h)>1600){
      const scale=1600/Math.max(w,h);
      w=Math.max(1,Math.round(w*scale));
      h=Math.max(1,Math.round(h*scale));
    }
    const canvas=document.createElement('canvas');
    canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d');
    if(!ctx)throw new Error('Could not create the image canvas');
    ctx.drawImage(bitmap,0,0,w,h);
    return {element:new Image(),canvas,ctx,width:w,height:h,
      dataUrl:options.compact?'':canvas.toDataURL('image/jpeg',.90)};
  }catch(error){
    throw error instanceof Error?error:new Error('Unable to decode image');
  }finally{
    if(timeoutId!==undefined)clearTimeout(timeoutId);
    bitmap?.close();
  }
}

export async function loadImageFromDataUrl(dataUrl: string): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const MAX_DIM = 1600;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (Math.max(w, h) > MAX_DIM) {
        const scale = MAX_DIM / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      const normalizedDataUrl = canvas.toDataURL('image/jpeg', 0.92);
      resolve({ element: img, canvas, ctx, width: w, height: h, dataUrl: normalizedDataUrl });
    };
    img.onerror = () => reject(new Error('Failed to load image from dataUrl'));
    img.src = dataUrl;
  });
}

export function validateImage(img: LoadedImage): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const { width, height } = img;

  // The scanner rectifies to 150 DPI. Upscaling cannot recover lost mark
  // topology from tiny source images; reject before scanning the paper.
  if (Math.min(width,height) < 650 || Math.max(width,height) < 1000) {
    errors.push(`Image resolution too low for reliable mark-shape analysis: ${width}×${height}px. Use a photo at least 650px on the short side and 1000px on the long side.`);
  } else if (Math.min(width,height) < 850) {
    warnings.push(`Image resolution (${width}×${height}px) is near the lower recommended limit. A higher-resolution photo may improve mark recognition.`);
  }

  // Aspect ratio check: standard A4 is ~1.41 (portrait)
  const ratio = height / width;
  if (ratio < 0.9 || ratio > 2.2) {
    warnings.push(`Unusual image aspect ratio (${ratio.toFixed(2)}). Expected ~1.41 for A4 portrait.`);
  }

  // Max size warning
  if (width > 6000 || height > 8000) {
    warnings.push(`Very large image (${width}×${height}px). Processing may take slightly longer.`);
  }

  return { valid: errors.length === 0, warnings, errors };
}
