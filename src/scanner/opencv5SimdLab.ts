/** Isolated OpenCV 5 / SIMD execution laboratory.
 * @banou/opencv-wasm has a different API from global OpenCV.js and MUST
 * NOT replace it by assignment to window.cv. This opt-in real grayscale
 * operation measures its startup and execution without altering OMR decisions.
 * The package requires native WebAssembly SIMD in the browser.
 */
declare const cv:any;
export interface SimdProbeResult{
  available:boolean;engine:string;loadMs:number;grayscaleMs:number;
  width:number;height:number;sampleMean:number|null;reason:string;
  inputExtractionMs?:number;legacyGrayMs?:number;maxSampleDifference?:number;
}
let initialized:Promise<typeof import('@banou/opencv-wasm')>|null=null;
async function loadSimd(){
  if(!initialized)initialized=(async()=>{
    const [cv,wasm]=await Promise.all([
      import('@banou/opencv-wasm'),
      import('@banou/opencv-wasm/opencv_js.wasm?url')
    ]);
    await cv.initOpenCV({wasmUrl:wasm.default});
    return cv;
  })().catch(error=>{initialized=null;throw error;});
  return initialized;
}
export async function measureOpenCv5Simd(canvas:HTMLCanvasElement):Promise<SimdProbeResult>{
 const begin=performance.now();
 const base={available:false,engine:'OpenCV 5.0.0 @banou/opencv-wasm 0.0.6 (SIMD)',
   loadMs:0,grayscaleMs:0,width:canvas.width,height:canvas.height,
   sampleMean:null as number|null,reason:''};
 try{
   const simd=await loadSimd();
   const loadMs=Math.round(performance.now()-begin);
   const ctx=canvas.getContext('2d',{willReadFrequently:true});
   if(!ctx)return {...base,loadMs,reason:'Unable to read photo pixels'};
   const pixelsStart=performance.now();
   const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
   const inputExtractionMs=Math.round(performance.now()-pixelsStart);
   const src=simd.matFromImageData(pixels);
   const gray=new simd.Mat();
   try{
     const operationStart=performance.now();
     simd.cvtColor(src,gray,simd.COLOR_RGBA2GRAY);
     const grayscaleMs=Math.round(performance.now()-operationStart);
     const data=gray.data;
     const stride=Math.max(1,Math.floor(data.length/512));
     let n=0,sum=0;
     for(let i=0;i<data.length;i+=stride){sum+=data[i];n++;}
     // Compare the same grayscale operation with our existing OpenCV.js,
     // including actual pixel parity. Conversion costs remain separately timed.
     let legacySrc:any=null,legacyGray:any=null;
     let legacyGrayMs: number|undefined,maxSampleDifference:number|undefined;
     try{
       legacySrc=cv.imread(canvas);legacyGray=new cv.Mat();
       const t=performance.now();
       cv.cvtColor(legacySrc,legacyGray,cv.COLOR_RGBA2GRAY);
       legacyGrayMs=Math.round(performance.now()-t);
       const old=legacyGray.data;
       if(old.length===data.length){
         let max=0;
         for(let i=0;i<data.length;i+=stride)
           max=Math.max(max,Math.abs(data[i]-old[i]));
         maxSampleDifference=max;
       }
     }catch{/* Legacy grayscale is informative only; main scanner remains unchanged. */}
     finally{legacyGray?.delete?.();legacySrc?.delete?.();}
     return {...base,available:true,loadMs,grayscaleMs,inputExtractionMs,
       legacyGrayMs,maxSampleDifference,
       sampleMean:n?Math.round(100*sum/n)/100:null,
       reason:'Real SIMD grayscale compared with legacy OpenCV.js on same pixels; independent scoring unchanged'};
   }finally{gray.delete();src.delete();}
 }catch(error){
   return {...base,loadMs:Math.round(performance.now()-begin),
     reason:'SIMD unavailable or module failed: '+String(error)};
 }
}
