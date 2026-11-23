/** Runs an isolated historical or current scanner inside a same-origin iframe.
 * Version-specific bundles retain their original decoding and bubble-reading code.
 * Only metadata and results cross the postMessage bridge; photographs never leave the browser.
 */
import { runFullScan } from './scanner/scanOrchestrator';
import { checkOpenCV } from './scanner/imagePreprocessor';
const CHANNEL='sfg-omr-lab-compare-v1';
function enabled():boolean{
  return new URLSearchParams(location.search).get('compareBridge')==='1' &&
    window.parent!==window;
}
if(enabled()){
  const origin=location.origin;
  // The script "onload" event fires before some OpenCV.js WebAssembly
  // initialization paths finish. Never advertise ready until cv.Mat exists.
  // The previous optimistic window.opencvReady flag caused an 841ms failure.
  let announced=false;
  let stopped=false;
  let ticker:number|undefined;
  let watchdog:number|undefined;
  const stopChecking=()=>{
    stopped=true;
    if(ticker!==undefined)window.clearInterval(ticker);
    if(watchdog!==undefined)window.clearTimeout(watchdog);
    window.removeEventListener('opencv-ready',probe);
    window.removeEventListener('opencv-error',onError);
  };
  const probe=()=>{
    if(announced||stopped)return;
    const runtime=(window as typeof window & {cv?:{
      Mat?:new(rows?:number,cols?:number,type?:number)=>{delete:()=>void};
      CV_8UC1?:number
    }}).cv;
    if(checkOpenCV()&&typeof runtime?.Mat==='function'){
      // Some OpenCV.js builds expose Mat before WASM constructors are callable.
      // A real allocate/free round-trip must succeed before accepting requests.
      try{
        const probeMat=new runtime.Mat(1,1,runtime.CV_8UC1??0);
        probeMat.delete();
      }catch{return;}
      announced=true;
      stopChecking();
      window.parent.postMessage({channel:CHANNEL,type:'ready',protocol:1,
        cvInitialized:true},origin);
    }
  };
  const onError=()=>{
    if(announced||stopped)return;
    stopChecking();
    window.parent.postMessage({channel:CHANNEL,type:'startup-error',
      reason:'OpenCV script failed to load'},origin);
  };
  window.addEventListener('opencv-ready',probe);
  window.addEventListener('opencv-error',onError);
  ticker=window.setInterval(probe,100);
  watchdog=window.setTimeout(()=>{
    if(announced||stopped)return;
    stopChecking();
    window.parent.postMessage({channel:CHANNEL,type:'startup-error',
      reason:'OpenCV WebAssembly initialization exceeded 45 seconds'},origin);
  },45000);
  probe();
  let running=false;
  window.addEventListener('message',async event=>{
    if(event.origin!==origin || event.source!==window.parent)return;
    const data=event.data as {
      channel?:string;type?:string;requestId?:string;
      bytes?:ArrayBuffer;name?:string;mime?:string;wantAlignedImage?:boolean
    };
    if(data?.channel!==CHANNEL||data.type!=='scan'||typeof data.requestId!=='string')return;
    const requestId=data.requestId;
    if(running || !(data.bytes instanceof ArrayBuffer)||data.bytes.byteLength<1 ||
      data.bytes.byteLength>25*1024*1024){
      window.parent.postMessage({channel:CHANNEL,type:'result',requestId,
        error:'Engine busy, image missing, or image exceeds 25MB'},origin);
      return;
    }
    running=true;
    try{
      const file=new File([data.bytes],data.name||'omr-photo.jpeg',
        {type:data.mime||'image/jpeg'});
      window.parent.postMessage({channel:CHANNEL,type:'scan-progress',requestId,
        stage:'Scanner initialized; image processing starting',percent:0},origin);
      const {result,images}=await runFullScan(file,(p)=>{
        window.parent.postMessage({channel:CHANNEL,type:'scan-progress',requestId,
          stage:p.stage,percent:p.percent},origin);
      });
      window.parent.postMessage({channel:CHANNEL,type:'result',requestId,
        result,alignedImage:data.wantAlignedImage && result.perspectiveCorrected ? images.perspectiveCorrected??null : null},origin);
    }catch(e){
      window.parent.postMessage({channel:CHANNEL,type:'result',requestId,
        error:String(e)},origin);
    }finally{running=false;}
  });
}
