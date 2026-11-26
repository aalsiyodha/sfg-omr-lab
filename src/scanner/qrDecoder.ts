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

    // Failure-only QR rescue. The printed QR can occupy only ~20mm and camera
    // resampling may leave each module near one working-image pixel. Try
    // enlargements and contrast normalization on this SAME expected QR region.
    // Do not widen the search beyond the registered QR position or change
    // the strict SFGOMR1 identity prefix and independent timing policy.
    for (const sizeScale of [2,3]) {
      const enlarged = document.createElement('canvas');
      enlarged.width = regionCanvas.width * sizeScale;
      enlarged.height = regionCanvas.height * sizeScale;
      const ec = enlarged.getContext('2d',{willReadFrequently:true});
      if(!ec)continue;
      ec.imageSmoothingEnabled=false;
      ec.drawImage(regionCanvas,0,0,enlarged.width,enlarged.height);
      const nearest=decodeQR(enlarged);
      if(nearest.found)return nearest;
      // Normalize luminance using 5th and 95th percentile; shadows and
      // nonuniform light can hide finder modules from the raw decoder.
      const image=ec.getImageData(0,0,enlarged.width,enlarged.height);
      const hist=new Uint32Array(256);
      const data=image.data;
      for(let i=0;i<data.length;i+=4)
        hist[Math.round(.299*data[i]+.587*data[i+1]+.114*data[i+2])]++;
      const total=enlarged.width*enlarged.height;
      let lo=0,hi=255,cumulative=0;
      for(let v=0;v<256;v++){
        cumulative+=hist[v];
        if(cumulative>=total*.05){lo=v;break;}
      }
      cumulative=0;
      for(let v=0;v<256;v++){
        cumulative+=hist[v];
        if(cumulative>=total*.95){hi=v;break;}
      }
      if(hi-lo<20)continue;
      const gain=255/(hi-lo);
      for(let i=0;i<data.length;i+=4){
        const gray=Math.max(0,Math.min(255,Math.round(
          (.299*data[i]+.587*data[i+1]+.114*data[i+2]-lo)*gain)));
        data[i]=gray;data[i+1]=gray;data[i+2]=gray;
      }
      ec.putImageData(image,0,0);
      const normalized=decodeQR(enlarged);
      if(normalized.found)return normalized;
    }
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
    const decoder=getJsQR();
    let attempts=0;
    let invalidCandidate:ReturnType<typeof locateQRInPhoto>|null=null;
    // A QR can occupy <1% of a photograph. Downsampling the entire image
    // destroys its modules; keep native pixels when searching likely areas.
    // These are discovery-only crops, NEVER a substitute for page verification.
    const W=source.width,H=source.height;
    const regions=[
      {x:0,y:0,w:W,h:H,max:900,label:'full-downsampled'},
      {x:Math.floor(W*.42),y:0,w:Math.ceil(W*.58),h:Math.ceil(H*.47),max:1400,label:'upper-right-native'},
      {x:0,y:0,w:Math.ceil(W*.58),h:Math.ceil(H*.55),max:1400,label:'upper-left-native'},
      {x:Math.floor(W*.42),y:Math.floor(H*.45),w:Math.ceil(W*.58),h:Math.ceil(H*.55),max:1400,label:'lower-right-native'},
      {x:0,y:Math.floor(H*.45),w:Math.ceil(W*.58),h:Math.ceil(H*.55),max:1400,label:'lower-left-native'},
      {x:0,y:0,w:W,h:Math.ceil(H*.45),max:1600,label:'upper-strip-native'},
      {x:0,y:0,w:W,h:H,max:1600,label:'full-native'},
    ];
    for(const area of regions){
      const scale=Math.min(1,area.max/Math.max(area.w,area.h));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(area.w*scale));
      canvas.height=Math.max(1,Math.round(area.h*scale));
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      if(!ctx)continue;
      ctx.drawImage(source,area.x,area.y,area.w,area.h,0,0,canvas.width,canvas.height);
      const data=ctx.getImageData(0,0,canvas.width,canvas.height);
      for(const mode of ['dontInvert','onlyInvert'] as const){
        attempts++;
        let code:ReturnType<typeof jsQR>=null;
        try{code=decoder(data.data,data.width,data.height,{inversionAttempts:mode});}
        catch{code=null;}
        if(!code)continue;
        const coords=[code.location.topLeftCorner,code.location.topRightCorner,
          code.location.bottomRightCorner,code.location.bottomLeftCorner]
          .map(p=>({x:Number((area.x+p.x/scale).toFixed(1)),
            y:Number((area.y+p.y/scale).toFixed(1))}));
        const parsed=parseQRData(code.data);
        const discovered={found:true,valid:parsed.valid,raw:parsed.raw,
          center:{x:Number((coords.reduce((sum,p)=>sum+p.x,0)/4).toFixed(1)),
            y:Number((coords.reduce((sum,p)=>sum+p.y,0)/4).toFixed(1))},
          corners:coords,attempts};
        // Background QR codes cannot override the expected student identity.
        if(parsed.valid)return discovered;
        invalidCandidate??={...discovered,error:'decoded-unexpected-qr-prefix'};
      }
    }
    return invalidCandidate??absent('not-decoded-in-full-or-targeted-photo-regions',attempts);
  }catch(error){return absent('locator-error: '+String(error));}
}
