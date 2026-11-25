/** Isolated OpenCV 5 / SIMD execution laboratory.
 * @banou/opencv-wasm has a different API from global OpenCV.js and MUST
 * NOT replace it by assignment to window.cv. This opt-in real grayscale
 * operation measures its startup and execution without altering OMR decisions.
 * The package requires native WebAssembly SIMD in the browser.
 */
export interface SimdProbeResult{
  available:boolean;engine:string;loadMs:number;grayscaleMs:number;
  width:number;height:number;sampleMean:number|null;reason:string;
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
   const cv=await loadSimd();
   const loadMs=Math.round(performance.now()-begin);
   const ctx=canvas.getContext('2d',{willReadFrequently:true});
   if(!ctx)return {...base,loadMs,reason:'Unable to read photo pixels'};
   const src=cv.matFromImageData(ctx.getImageData(0,0,canvas.width,canvas.height));
   const gray=new cv.Mat();
   try{
     const operationStart=performance.now();
     cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);
     const grayscaleMs=Math.round(performance.now()-operationStart);
     const data=gray.data;
     const stride=Math.max(1,Math.floor(data.length/512));
     let n=0,sum=0;
     for(let i=0;i<data.length;i+=stride){sum+=data[i];n++;}
     return {...base,available:true,loadMs,grayscaleMs,
       sampleMean:n?Math.round(100*sum/n)/100:null,
       reason:'Real OpenCV 5 SIMD grayscale completed; legacy scoring engine preserved'};
   }finally{gray.delete();src.delete();}
 }catch(error){
   return {...base,loadMs:Math.round(performance.now()-begin),
     reason:'SIMD unavailable or module failed: '+String(error)};
 }
}
