/**
 * ttop32/opencv-js-wasm 4.8.1 — isolated browser benchmark.
 *
 * This package's index.mjs explicitly rejects browser ESM initialization.
 * Its documented browser integration is the standalone embedded-WASM
 * opencv.js script. We run it in its OWN hidden iframe to protect window.cv,
 * window.Module, heap and the existing scoring engine from interference.
 * The iframe measures actual RGBA->gray, binary threshold and identity
 * perspective warp on the same uploaded pixels. Never grades OMR answers.
 */
export interface ForkBench {
  engine:'ttop32/opencv-js-wasm@4.8.1';
  available:boolean;
  coldStartMs:number;
  imageTransferMs:number;
  rgbaToGrayMs:number|null;
  thresholdMs:number|null;
  identityWarpMs:number|null;
  sampleMean:number|null;
  sampleHash:number|null;
  width:number;
  height:number;
  error?:string;
}
interface ForkReply {
  scope:'sfg-ttop32-bench';
  nonce:string;
  event:'ready'|'result'|'error';
  payload?:Record<string,unknown>;
  message?:string;
}
let pending:Promise<{frame:HTMLIFrameElement,nonce:string,coldStartMs:number}>|null=null;
const scriptUrl=import.meta.env.BASE_URL+'cv-engines/ttop32/opencv.js';
function boot(){
  if(pending)return pending;
  pending=new Promise((resolve,reject)=>{
    const nonce='omr'+Math.random().toString(36).slice(2);
    const frame=document.createElement('iframe');
    frame.hidden=true;frame.style.display='none';frame.title='Isolated OpenCV 4.8.1 WASM benchmark';
    // Dedicated origin-separated realm: same parent controls message source,
    // and the fork NEVER writes to the parent document's global cv/Module.
    frame.setAttribute('sandbox','allow-scripts');
    let completed=false;
    const start=performance.now();
    const cleanup=()=>{
      window.removeEventListener('message',onMessage);
      window.clearTimeout(timeout);
    };
    const fail=(message:string)=>{
      if(completed)return;completed=true;cleanup();frame.remove();pending=null;
      reject(new Error(message));
    };
    const onMessage=(evt:MessageEvent<ForkReply>)=>{
      const data=evt.data;
      if(evt.source!==frame.contentWindow||!data||
        data.scope!=='sfg-ttop32-bench'||data.nonce!==nonce)return;
      if(data.event==='error')fail(data.message??'Fork runtime failed');
      if(data.event==='ready'&&!completed){
        completed=true;cleanup();
        resolve({frame,nonce,coldStartMs:Math.round(performance.now()-start)});
      }
    };
    const timeout=window.setTimeout(()=>fail('OpenCV 4.8.1 fork failed to load within 20 seconds'),20000);
    window.addEventListener('message',onMessage);
    const code=`
      'use strict';
      const scope='sfg-ttop32-bench',nonce=${JSON.stringify(nonce)};
      let cv=null;
      const send=(event,payload,message)=>parent.postMessage({scope,nonce,event,payload,message},'*');
      window.Module={
        onRuntimeInitialized(){
          cv=window.Module;
          if(typeof cv.Mat!=='function'||typeof cv.cvtColor!=='function'){
            send('error',null,'Runtime initialized without Mat/cvtColor');return;
          }
          send('ready',null,null);
        },
        onAbort(e){send('error',null,'WASM aborted: '+String(e));}
      };
      const loader=document.createElement('script');
      loader.src=${JSON.stringify(scriptUrl)};
      loader.onerror=()=>send('error',null,'Unable to fetch ttop32 embedded WASM asset');
      document.head.appendChild(loader);
      addEventListener('message',e=>{
        if(e.data?.scope!==scope||e.data?.nonce!==nonce||
            e.data?.event!=='run'||!cv)return;
        const {width,height,pixels}=e.data;
        const begin=performance.now();
        let src=null,gray=null,binary=null,warped=null,transform=null;
        try{
          src=new cv.Mat(height,width,cv.CV_8UC4);
          src.data.set(new Uint8Array(pixels));
          const readMs=Math.round(performance.now()-begin);
          gray=new cv.Mat();let t=performance.now();
          cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);
          const grayMs=performance.now()-t;
          binary=new cv.Mat();t=performance.now();
          cv.threshold(gray,binary,128,255,cv.THRESH_BINARY);
          const thresholdMs=performance.now()-t;
          const data=gray.data;
          let hash=2166136261>>>0,sum=0,n=0;
          const step=Math.max(1,Math.floor(data.length/512));
          for(let i=0;i<data.length;i+=step){
            hash=Math.imul(hash^data[i],16777619)>>>0;sum+=data[i];n++;
          }
          let warpMs=null;
          if(typeof cv.warpPerspective==='function'&&
            typeof cv.matFromArray==='function'){
            transform=cv.matFromArray(3,3,cv.CV_64FC1,[1,0,0,0,1,0,0,0,1]);
            warped=new cv.Mat();t=performance.now();
            cv.warpPerspective(gray,warped,transform,new cv.Size(width,height));
            warpMs=performance.now()-t;
          }
          send('result',{readMs,rgbaToGrayMs:Math.round(grayMs*100)/100,
            thresholdMs:Math.round(thresholdMs*100)/100,
            identityWarpMs:warpMs===null?null:Math.round(warpMs*100)/100,
            sampleHash:hash,sampleMean:Math.round(sum/Math.max(n,1)*100)/100,
            width,height},null);
        }catch(error){send('error',null,'Fork operation: '+String(error));}
        finally{
          for(const mat of [src,gray,binary,warped,transform])
            try{mat?.delete?.();}catch{}
        }
      });
    `;
    frame.srcdoc='<!doctype html><html><head></head><body><script>'+code+'</'+'script></body></html>';
    document.body.appendChild(frame);
  });
  return pending;
}
export async function measureTtop32Fork(canvas:HTMLCanvasElement):Promise<ForkBench>{
  const base:ForkBench={engine:'ttop32/opencv-js-wasm@4.8.1',
    available:false,coldStartMs:0,imageTransferMs:0,
    rgbaToGrayMs:null,thresholdMs:null,identityWarpMs:null,sampleMean:null,
    sampleHash:null,width:canvas.width,height:canvas.height};
  try{
    const {frame,nonce,coldStartMs}=await boot();
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    if(!ctx)throw new Error('Canvas 2D pixel access unavailable');
    const started=performance.now();
    const data=ctx.getImageData(0,0,canvas.width,canvas.height);
    const payload=data.data.buffer;
    const imageTransferMs=Math.round(performance.now()-started);
    const result=await new Promise<ForkBench>((resolve,reject)=>{
      let done=false;
      const cleanup=()=>{window.clearTimeout(timer);window.removeEventListener('message',onMessage);};
      const onMessage=(evt:MessageEvent<ForkReply>)=>{
        const m=evt.data;
        if(evt.source!==frame.contentWindow||m?.scope!=='sfg-ttop32-bench'||
          m.nonce!==nonce||m.event==='ready')return;
        if(done)return;done=true;cleanup();
        if(m.event==='error'){reject(new Error(m.message));return;}
        const p=m.payload??{};
        resolve({...base,available:true,coldStartMs,imageTransferMs,
          rgbaToGrayMs:Number(p.rgbaToGrayMs),
          thresholdMs:Number(p.thresholdMs),
          identityWarpMs:p.identityWarpMs==null?null:Number(p.identityWarpMs),
          sampleMean:Number(p.sampleMean),sampleHash:Number(p.sampleHash)});
      };
      const timer=window.setTimeout(()=>{
        if(done)return;done=true;cleanup();reject(new Error('Fork operation timed out after 15 seconds'));
      },15000);
      window.addEventListener('message',onMessage);
      frame.contentWindow?.postMessage({scope:'sfg-ttop32-bench',nonce,event:'run',
        width:canvas.width,height:canvas.height,pixels:payload},'*',[payload]);
    });
    return result;
  }catch(e){
    return {...base,error:String(e)};
  }
}
