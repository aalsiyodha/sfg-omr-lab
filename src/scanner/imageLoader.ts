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
    bitmap=await Promise.race([
      createImageBitmap(file,{resizeWidth:maxWidth,resizeQuality:'high'}),
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
