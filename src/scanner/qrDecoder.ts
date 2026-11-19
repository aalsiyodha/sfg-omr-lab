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

// Try decoding from a region of the corrected image
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
      return decodeQR(fullCanvas);
    }

    const regionCanvas = document.createElement('canvas');
    regionCanvas.width = size;
    regionCanvas.height = size;
    const ctx = regionCanvas.getContext('2d');
    if (!ctx) return decodeQR(fullCanvas);

    ctx.drawImage(fullCanvas, x, y, size, size, 0, 0, size, size);
    const result = decodeQR(regionCanvas);
    if (result.found) return result;

    return decodeQR(fullCanvas);
  } catch (err) {
    return decodeQR(fullCanvas);
  }
}
