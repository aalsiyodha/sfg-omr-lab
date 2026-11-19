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
    if (!['image/jpeg', 'image/jpg', 'image/png'].includes(file.type)) {
      reject(new Error(`Unsupported file type: ${file.type}. Please upload a JPG or PNG image.`));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        // Standardize high-res phone captures (e.g. 12MP/48MP) to 1600px max dimension.
        // This ensures OpenCV adaptive-threshold kernels match the physical marker size (7mm ~ 35-40px).
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
      img.onerror = () => reject(new Error('Failed to decode image data'));
      img.src = dataUrl;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
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

  // Lenient minimum resolution: only reject if extremely small (<400px)
  if (width < 400 || height < 400) {
    errors.push(`Image resolution too low: ${width}×${height}px. Minimum 400×400px required.`);
  } else if (width < 800 || height < 800) {
    warnings.push(`Image resolution (${width}×${height}px) is moderate. Processing will upscale to 150 DPI.`);
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
