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

export async function loadImageFromFile(file: File): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.type)) {
      reject(new Error(`Unsupported file type: ${file.type}. Please upload JPG, PNG, or WebP. HEIC/HEIF must first be converted to JPEG/PNG in a supported app.`));
      return;
    }
    // Blob URLs avoid creating a massive base64 copy of a full-resolution phone photo.
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX_DIM = 1600;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (Math.max(w, h) > MAX_DIM) {
        const scale = MAX_DIM / Math.max(w, h);
        w = Math.max(1,Math.round(w*scale));
        h = Math.max(1,Math.round(h*scale));
      }
      try {
        const canvas = document.createElement('canvas');
        canvas.width=w; canvas.height=h;
        const ctx=canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas could not be initialized on this device.');
        ctx.drawImage(img,0,0,w,h);
        const normalizedDataUrl = canvas.toDataURL('image/jpeg',0.92);
        resolve({element:img,canvas,ctx,width:w,height:h,dataUrl:normalizedDataUrl});
      } catch(error){reject(error);}
    };
    img.onerror = () => {URL.revokeObjectURL(url);reject(new Error('Could not decode this image. Try JPEG, PNG or WebP.'));};
    img.src=url;
  });
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
