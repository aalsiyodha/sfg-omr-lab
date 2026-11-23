/** Runs an isolated historical or current scanner inside a same-origin iframe.
 * Version-specific bundles retain their original decoding and bubble-reading code.
 * Only metadata and results cross the postMessage bridge; photographs never leave the browser.
 */
import { runFullScan } from './scanner/scanOrchestrator';
const CHANNEL='sfg-omr-lab-compare-v1';
function enabled():boolean{
  return new URLSearchParams(location.search).get('compareBridge')==='1' &&
    window.parent!==window;
}
if(enabled()){
  const origin=location.origin;
  const ready=()=>{
    window.parent.postMessage({channel:CHANNEL,type:'ready',protocol:1},origin);
  };
  if((window as Window & {opencvReady?:boolean}).opencvReady)ready();
  else {
    window.addEventListener('opencv-ready',ready,{once:true});
    window.addEventListener('opencv-error',()=>{
      window.parent.postMessage({channel:CHANNEL,type:'startup-error',reason:'OpenCV failed to load'},origin);
    },{once:true});
  }
  let running=false;
  window.addEventListener('message',async event=>{
    if(event.origin!==origin || event.source!==window.parent)return;
    const data=event.data as {
      channel?:string;type?:string;requestId?:string;
      bytes?:ArrayBuffer;name?:string;mime?:string
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
      const {result}=await runFullScan(file);
      window.parent.postMessage({channel:CHANNEL,type:'result',requestId,
        result},origin);
    }catch(e){
      window.parent.postMessage({channel:CHANNEL,type:'result',requestId,
        error:String(e)},origin);
    }finally{running=false;}
  });
}
