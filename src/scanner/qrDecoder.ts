// src/scanner/qrDecoder.ts
import jsQR from 'jsqr';

export const QR_EXPECTED_PREFIX = 'SFGOMR1:';

export interface QRResult {
  found: boolean;
  raw: string | null;
  valid: boolean;
  studentId: string | null;
  error?: string;
}

const getJsQR = (): typeof jsQR => {
  return typeof jsQR === 'function' ? jsQR : (jsQR as any).default || jsQR;
};

export function decodeQR(canvas: HTMLCanvasElement): QRResult {
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) return { found: false, raw: null, valid: false, studentId: null, error: 'No canvas context' };

    const { width, height } = canvas;
    if (width <= 0 || height <= 0) {
      return { found: false, raw: null, valid: false, studentId: null, error: 'Invalid canvas dimensions' };
    }

    const imageData = ctx.getImageData(0, 0, width, height);
    const decoder = getJsQR();

    let code = null;
    try {
      code = decoder(imageData.data, width, height, { inversionAttempts: 'dontInvert' });
    } catch (e) {
      // jsQR can throw on partially matched patterns
      code = null;
    }

    if (!code) {
      try {
        code = decoder(imageData.data, width, height, { inversionAttempts: 'onlyInvert' });
      } catch (e) {
        code = null;
      }
    }

    if (!code) {
      return {
        found: false,
        raw: null,
        valid: false,
        studentId: null,
        error: 'QR code not detected. Ensure the QR code is visible and not blurry.',
      };
    }

    return parseQRData(code.data);
  } catch (err: any) {
    return {
      found: false,
      raw: null,
      valid: false,
      studentId: null,
      error: `QR decode error: ${err.message || 'unknown'}`,
    };
  }
}

function parseQRData(raw: string): QRResult {
  if (!raw.startsWith(QR_EXPECTED_PREFIX)) {
    return {
      found: true,
      raw,
      valid: false,
      studentId: null,
      error: `Invalid QR format. Expected prefix "${QR_EXPECTED_PREFIX}", got: "${raw.substring(0, 20)}"`,
    };
  }
  const studentId = raw.substring(QR_EXPECTED_PREFIX.length).trim();
  return { found: true, raw, valid: true, studentId };
}

// Strict region-only decoding. Never search the full sheet here: doing so hides 180° rotation.
export function decodeQRFromRegion(
  fullCanvas: HTMLCanvasElement,
  xMm: number,
  yMm: number,
  sizeMm: number,
  dpi: number
): QRResult {
  try {
    const scale = dpi / 25.4;
    // Add 15% padding around the QR code area for tolerance
    const padMm = 2;
    const x = Math.max(0, Math.round((xMm - padMm) * scale));
    const y = Math.max(0, Math.round((yMm - padMm) * scale));
    const size = Math.round((sizeMm + padMm * 2) * scale);

    if (x + size > fullCanvas.width || y + size > fullCanvas.height) {
      return { found: false, raw: null, valid: false, studentId: null, error: 'QR region outside corrected page' };
    }

    const regionCanvas = document.createElement('canvas');
    regionCanvas.width = size;
    regionCanvas.height = size;
    const ctx = regionCanvas.getContext('2d');
    if (!ctx) return { found: false, raw: null, valid: false, studentId: null, error: 'No regional QR canvas context' };

    ctx.drawImage(fullCanvas, x, y, size, size, 0, 0, size, size);
    const result = decodeQR(regionCanvas);
    if (result.found) return result;

    return result;
  } catch (err) {
    return { found: false, raw: null, valid: false, studentId: null, error: 'Could not decode regional QR' };
  }
}

/** Failure-only independent QR locator. The QR is a geometric landmark,
 * not permission to read bubbles without full-sheet timing verification.
 * Downsample to cap CPU cost on large phone photographs.
 */
export function locateQRInPhoto(source:HTMLCanvasElement):{
  found:boolean;valid:boolean;raw:string|null;center:{x:number;y:number}|null;
  corners:{x:number;y:number}[];attempts:number;error?:string
}{
  const absent=(error:string,attempts=0)=>({
    found:false,valid:false,raw:null,center:null,corners:[],attempts,error
  });
  try{
    const scale=Math.min(1,900/Math.max(source.width,source.height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(source.width*scale));
    canvas.height=Math.max(1,Math.round(source.height*scale));
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    if(!ctx)return absent('no-context');
    ctx.drawImage(source,0,0,canvas.width,canvas.height);
    const data=ctx.getImageData(0,0,canvas.width,canvas.height);
    const decoder=getJsQR();
    let code:ReturnType<typeof jsQR>=null;
    let attempts=0;
    for(const mode of ['dontInvert','onlyInvert'] as const){
      attempts++;
      try{code=decoder(data.data,data.width,data.height,{inversionAttempts:mode});}
      catch{code=null;}
      if(code)break;
    }
    if(!code)return absent('not-decoded-in-full-photo',attempts);
    const coords=[code.location.topLeftCorner,code.location.topRightCorner,
      code.location.bottomRightCorner,code.location.bottomLeftCorner]
      .map(p=>({x:Number((p.x/scale).toFixed(1)),y:Number((p.y/scale).toFixed(1))}));
    const parsed=parseQRData(code.data);
    return {found:true,valid:parsed.valid,raw:parsed.raw,
      center:{x:Number((coords.reduce((sum,p)=>sum+p.x,0)/4).toFixed(1)),
        y:Number((coords.reduce((sum,p)=>sum+p.y,0)/4).toFixed(1))},
      corners:coords,attempts};
  }catch(error){return absent('locator-error: '+String(error));}
}
