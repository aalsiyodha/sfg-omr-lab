/** Experimental ONNX classifier for 200 individual bubble crops.
 * hermitkk/omr-checkbox-classifier (SmallOMRNet) AGPL-3.0.
 * Trained on synthetic square checkboxes, not calibrated for SFG round bubbles.
 * NEVER used for official scoring. Requires a separately aligned scanner image.
 */
import {getBubbleCentre,mmToPx} from '../config/omrLayout';
import type {EngineResult,EngineDefinition} from './engines';

type OrtTensor={data:Float32Array|number[];dims:readonly number[]};
type OrtSession={
  inputNames:string[];
  run:(feeds:Record<string,unknown>)=>Promise<Record<string,OrtTensor>>;
};
type OrtRuntime={
  env:{wasm:{wasmPaths:string;numThreads:number}};
  Tensor:new(type:'float32',data:Float32Array,dims:number[])=>unknown;
  InferenceSession:{create:(model:Uint8Array,options:{
    executionProviders:['wasm'];graphOptimizationLevel:'all'
  })=>Promise<OrtSession>};
};
const base=import.meta.env.BASE_URL;
const runtimeUrl=base+'ai-runtime/ort.wasm.min.mjs';
const modelUrl=base+'ai-model/bubble/omr_model.onnx';
let loader:Promise<{ort:OrtRuntime;session:OrtSession}>|null=null;
async function sessionReady(){
 if(!loader)loader=(async()=>{
   const ort=await import(/* @vite-ignore */ runtimeUrl) as unknown as OrtRuntime;
   ort.env.wasm.wasmPaths=base+'ai-runtime/';
   ort.env.wasm.numThreads=1;
   const resp=await fetch(modelUrl);
   if(!resp.ok)throw Error('Bubble model download failed: HTTP '+resp.status);
   const model=new Uint8Array(await resp.arrayBuffer());
   const session=await ort.InferenceSession.create(model,{
     executionProviders:['wasm'],graphOptimizationLevel:'all'
   });
   return {ort,session};
 })().catch(e=>{loader=null;throw e;});
 return await loader;
}
async function alignedCanvas(dataUrl:string){
 if(!dataUrl.startsWith('data:image/'))throw Error('Aligned image must be a local image data URL');
 const image=new Image();
 await new Promise<void>((resolve,reject)=>{
   image.onload=()=>resolve();image.onerror=()=>reject(Error('Invalid aligned image'));
   image.src=dataUrl;
 });
 const canvas=document.createElement('canvas');
 canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});
 if(!ctx)throw Error('No image canvas available');
 ctx.drawImage(image,0,0);
 return canvas;
}
function bubbleTensor(image:HTMLCanvasElement,cx:number,cy:number,diameter:number){
 const roi=document.createElement('canvas');roi.width=64;roi.height=64;
 const ctx=roi.getContext('2d',{willReadFrequently:true});
 if(!ctx)throw Error('Crop canvas not available');
 // 35% padding around nominal bubble radius, per model training documentation.
 const side=diameter*1.7;
 ctx.drawImage(image,cx-side/2,cy-side/2,side,side,0,0,64,64);
 const rgba=ctx.getImageData(0,0,64,64).data;
 const out=new Float32Array(4096);
 for(let i=0,j=0;i<rgba.length;i+=4,j++){
   const v=.2126*rgba[i]+.7152*rgba[i+1]+.0722*rgba[i+2];
   out[j]=(v/255-.5)/.5;
 }
 return out;
}
export async function runBubbleAi(def:EngineDefinition,
  source?:EngineResult):Promise<EngineResult>{
 const start=performance.now();
 const failed=(reason:string):EngineResult=>({
   id:def.id,name:def.name,kind:'bubble',version:def.version,
   outcome:'error',elapsedMs:Math.round(performance.now()-start),reason,
   corners:[],confidence:null,qrValid:null,alignmentVerified:null,
   timing:null,timingLeft:null,timingRight:null,markerCount:null,
   calibration:null,testId:null,answers:[],traces:[]
 });
 if(!source || !source.alignedImage){
   return failed('No source warp available; select the current scanner or Scanic corner detector.');
 }
 // Scanic geometry is AI-only: samples are exploratory, unverified and must
 // never be interpreted as student answers or compared as verified scores.
 const sourceVerified=source.kind==='scanner'&&source.alignmentVerified===true;
 const provenance=source.kind==='detector'?'AI-predicted unverified Scanic page':
   sourceVerified?'independently verified optical registration':'provisional optical registration';
 const traces:EngineResult['traces']=[];
 try{
   const t=performance.now();
   const {ort,session}=await sessionReady();
   traces.push({stage:'bubbleAI',message:'runtime-initialized',data:{
     loadMs:Math.round(performance.now()-t),modelUrl,runtimeUrl,
     model:'SmallOMRNet',license:'AGPL-3.0',training:'synthetic checkbox crops',
     modelInput:[1,1,64,64],notCalibratedFor:'SFG circular answer bubbles',
     source:source.id,provenance,sourceVerified
   }});
   const image=await alignedCanvas(source.alignedImage);
   // Use rendered page geometry instead of assuming source camera pixels.
   const dpi=image.width/210*25.4;
   const yDpi=image.height/297*25.4;
   const scores:number[][]=[];
   const rawValues:number[][]=[];
   for(let q=1;q<=50;q++){
     const row:number[]=[];
     const rawRow:number[]=[];
     for(let a=0;a<4;a++){
       const p=getBubbleCentre(q,a as 0|1|2|3);
       const pixels=bubbleTensor(image,mmToPx(p.xMm,dpi),
         mmToPx(p.yMm,yDpi),mmToPx(3.4,dpi));
       const tensor=new ort.Tensor('float32',pixels,[1,1,64,64]);
       const output=await session.run({[session.inputNames[0]]:tensor});
       const first=Object.values(output)[0];
       const value=Number(first?.data?.[0]);
       if(!Number.isFinite(value))throw Error('Model returned non-finite output for Q'+q);
       rawRow.push(value);
       // The upstream ONNX example calls this a logit and applies sigmoid.
       // No calibration or score guarantee is inferred from this conversion.
       const pFilled=1/(1+Math.exp(-value));
       row.push(pFilled);
     }
     scores.push(row);rawValues.push(rawRow);
     if(q%5===0){
       traces.push({stage:'bubbleAI',message:'classification-progress',
         data:{questions:q,elapsedMs:Math.round(performance.now()-t)}});
       await new Promise<void>(resolve=>window.setTimeout(resolve,0));
     }
   }
   const answers:EngineResult['answers']=[];
   let agreements=0,disagreements=0,unresolved=0;
   for(let q=1;q<=50;q++){
     const row=scores[q-1];
     const sorted=row.map((p,i)=>({p,i})).sort((a,b)=>b.p-a.p);
     const decisive=sorted[0].p>=.75&&sorted[0].p-sorted[1].p>=.20;
     const choice=decisive?'ABCD'[sorted[0].i]:null;
     const optical=source.answers.find(a=>a.q===q);
     if(!decisive)unresolved++;
     else if(!sourceVerified || !optical)unresolved++;
     else if(optical.answer===choice)agreements++;
     else disagreements++;
     answers.push({q,answer:choice,status:decisive?'experimental':'uncertain',
       confidence:sorted[0].p});
   }
   traces.push({stage:'bubbleAI',message:'bubble-classifier-summary',
     data:{agreement:agreements,disagreement:disagreements,unresolved,
       noGroundTruth:true,confidenceCalibrated:false,
       source:source.id,provenance,sourceVerified,
       scores:scores.map((row,i)=>({q:i+1,
         filledProbabilities:row.map(v=>+v.toFixed(4)),
         raw:rawValues[i].map(v=>+v.toFixed(4))}))}});
   return {...failed('Experimental checkbox classifier; never used for scoring'),
     outcome:'provisional',elapsedMs:Math.round(performance.now()-start),
     qrValid:source.qrValid,alignmentVerified:false,timing:source.timing,
     timingLeft:source.timingLeft,timingRight:source.timingRight,
     corners:source.corners,testId:source.testId,
     answers,confidence:null,traces,
     reason:'UNVERIFIED experimental bubble predictions from '+provenance+
       '; '+(sourceVerified?agreements+' optical matches, '+disagreements+' disagreements, ':'optical comparison unavailable; ')+
       unresolved+' unverified/uncertain rows; NEVER for grading'};
 }catch(error){return {...failed(String(error)),traces};}
}
