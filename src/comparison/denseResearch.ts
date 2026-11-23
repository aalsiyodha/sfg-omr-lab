/** Research-only dense geometry models. No scoring, QR authority, or automatic grading.
 * UVDoc: Apache-2.0 grid model (Jan 12 2026 ONNX revision).
 * DeepLab: external third-party document mask weights, licensing unconfirmed.
 * User-initiated selection only; photographs never leave the browser.
 */
import type {EngineDefinition,EngineResult} from './engines';
const BASE=import.meta.env.BASE_URL;
const URL_UVDOC=BASE+'ai-model/uvdoc/UVDoc_grid.onnx';
const URL_UVDOC_DATA=BASE+'ai-model/uvdoc/UVDoc_grid.onnx.data';
const URL_DEEPLAB='https://huggingface.co/7rplus/pagescan-weights/resolve/6ffde6ba734b1036b3f2a88deae76324fcd7e01b/deeplabv3_mbv3_docseg.onnx?download=true';
type Tensor={data:Float32Array|number[];dims:readonly number[]};
type Session={inputNames:string[];run:(feeds:Record<string,unknown>)=>Promise<Record<string,Tensor>>};
type Ort={env:{wasm:{wasmPaths:string;numThreads:number}};
  Tensor:new(type:'float32',data:Float32Array,dims:number[])=>unknown;
  InferenceSession:{create:(data:Uint8Array,opts:Record<string,unknown>)=>Promise<Session>}};
let ortPromise:Promise<Ort>|null=null;
async function runtime(){
  if(!ortPromise)ortPromise=(async()=>{
    const ort=await import(/* @vite-ignore */ BASE+'ai-runtime/ort.wasm.min.mjs') as unknown as Ort;
    ort.env.wasm.wasmPaths=BASE+'ai-runtime/';
    ort.env.wasm.numThreads=1;
    return ort;
  })().catch(e=>{ortPromise=null;throw e;});
  return ortPromise;
}
async function bytes(url:string){
  const response=await fetch(url);
  if(!response.ok)throw Error('Model download failed HTTP '+response.status+' '+url);
  return new Uint8Array(await response.arrayBuffer());
}
async function source(file:File,maxSide:number){
  const bitmap=await createImageBitmap(file);
  try{
    const k=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.round(bitmap.width*k);canvas.height=Math.round(bitmap.height*k);
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    if(!ctx)throw Error('Canvas unavailable');
    ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    return canvas;
  }finally{bitmap.close();}
}
function chw(canvas:HTMLCanvasElement,w:number,h:number,mode:'uvdoc'|'imagenet'){
  const temporary=document.createElement('canvas');
  temporary.width=w;temporary.height=h;
  const ctx=temporary.getContext('2d',{willReadFrequently:true});
  if(!ctx)throw Error('Image preprocessing unavailable');
  ctx.drawImage(canvas,0,0,w,h);
  const rgba=ctx.getImageData(0,0,w,h).data;
  const result=new Float32Array(3*w*h);
  const means=[.485,.456,.406],std=[.229,.224,.225];
  for(let i=0;i<w*h;i++)for(let c=0;c<3;c++){
    const v=rgba[i*4+c]/255;
    result[c*w*h+i]=mode==='uvdoc'?v:(v-means[c])/std[c];
  }
  return result;
}
function sample(im:Uint8ClampedArray,w:number,h:number,x:number,y:number,out:Uint8ClampedArray,idx:number){
  x=Math.max(0,Math.min(w-1,x));y=Math.max(0,Math.min(h-1,y));
  const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1);
  const fx=x-x0,fy=y-y0;
  const a=(y0*w+x0)*4,b=(y0*w+x1)*4,c=(y1*w+x0)*4,d=(y1*w+x1)*4;
  for(let i=0;i<3;i++)out[idx+i]=Math.round(im[a+i]*(1-fx)*(1-fy)+
    im[b+i]*fx*(1-fy)+im[c+i]*(1-fx)*fy+im[d+i]*fx*fy);
  out[idx+3]=255;
}
function gridSample(values:Float32Array|number[],channel:number,u:number,v:number,gw:number,gh:number){
  const x=u*(gw-1),y=v*(gh-1),x0=Math.floor(x),y0=Math.floor(y);
  const x1=Math.min(gw-1,x0+1),y1=Math.min(gh-1,y0+1),fx=x-x0,fy=y-y0;
  const off=channel*gw*gh;
  const at=(xx:number,yy:number)=>Number(values[off+yy*gw+xx]);
  return (1-fy)*((1-fx)*at(x0,y0)+fx*at(x1,y0))+
    fy*((1-fx)*at(x0,y1)+fx*at(x1,y1));
}
function fail(def:EngineDefinition,start:number,reason:string,traces:EngineResult['traces']=[]):EngineResult{
  return {id:def.id,name:def.name,kind:'detector',version:def.version,outcome:'error',
    elapsedMs:Math.round(performance.now()-start),reason,
    corners:[],confidence:null,imageSpace:null,qrValid:null,
    alignmentVerified:false,timing:null,timingLeft:null,timingRight:null,
    markerCount:null,calibration:null,testId:null,answers:[],traces};
}
function visualizeMask(im:HTMLCanvasElement,probabilities:Float32Array|number[],dims:readonly number[]){
  if(dims.length!==4)throw Error('Unsupported DeepLab output tensor shape '+JSON.stringify(dims));
  const channels=dims[1],h=dims[2],w=dims[3];
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<8||h<8||channels<1||channels>4)
    throw Error('Unsupported DeepLab output dimensions '+JSON.stringify(dims));
  const n=w*h;
  const low=document.createElement('canvas');low.width=w;low.height=h;
  const cx=low.getContext('2d');
  if(!cx)throw Error('Mask canvas unavailable');
  const img=cx.createImageData(w,h);
  let positive=0;
  for(let i=0;i<n;i++){
    const v=channels===1?Number(probabilities[i]):
      Number(probabilities[n+i])-Number(probabilities[i]);
    const p=v>=0?1/(1+Math.exp(-v)):Math.exp(v)/(1+Math.exp(v));
    const active=p>=.5;
    if(active)positive++;
    img.data[i*4]=active?20:220;img.data[i*4+1]=active?210:30;
    img.data[i*4+2]=active?90:30;img.data[i*4+3]=140;
  }
  cx.putImageData(img,0,0);
  const canvas=document.createElement('canvas');
  canvas.width=im.width;canvas.height=im.height;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Output canvas unavailable');
  ctx.drawImage(im,0,0);ctx.drawImage(low,0,0,im.width,im.height);
  return {image:canvas.toDataURL('image/png'),fraction:positive/n,dims:[...dims]};
}
export async function runDenseResearch(def:EngineDefinition,file:File):Promise<EngineResult>{
  const start=performance.now(),traces:EngineResult['traces']=[];
  try{
    const ort=await runtime();
    const isUv=def.id==='uvdoc';
    const model=await bytes(isUv?URL_UVDOC:URL_DEEPLAB);
    const opts:Record<string,unknown>={executionProviders:['wasm'],graphOptimizationLevel:'all'};
    if(isUv){
      // UVDoc ONNX uses external tensor data; both files must be provided.
      opts.externalData=[{path:'UVDoc_grid.onnx.data',data:await bytes(URL_UVDOC_DATA)}];
    }
    const session=await ort.InferenceSession.create(model,opts);
    const canvas=await source(file,1600);
    // The pinned document-mask ONNX declares a fixed [1,3,384,384] input.
    // Using 512px caused OrtRun invalid-dimensions on real photographs.
    const w=isUv?496:384,h=isUv?720:384;
    const input=chw(canvas,w,h,isUv?'uvdoc':'imagenet');
    const result=await session.run({[session.inputNames[0]]:
      new ort.Tensor('float32',input,[1,3,h,w])});
    const output=Object.values(result)[0];
    if(!output)throw Error('No model output');
    traces.push({stage:'dense',message:'model-output-evidence',data:{
      input:[1,3,h,w],output:[...output.dims],
      modelBytes:model.byteLength,model:isUv?'UVDoc grid':'DeepLabV3 document mask',
      modelRelease:isUv?'2026-01-12':'not reliably dated',
      documentGeometryOnly:true,neverGrade:true}});
    if(isUv){
      const [batch,channels,gh,gw]=output.dims;
      if(batch!==1||channels!==2||gh!==45||gw!==31)
        throw Error('Unexpected UVDoc grid '+JSON.stringify(output.dims));
      const out=document.createElement('canvas');out.width=840;out.height=1188;
      const context=out.getContext('2d');
      if(!context)throw Error('Warp canvas unavailable');
      const raster=context.createImageData(out.width,out.height);
      const original=canvas.getContext('2d',{willReadFrequently:true})!
        .getImageData(0,0,canvas.width,canvas.height).data;
      let inBounds=0;
      for(let y=0;y<out.height;y++)for(let x=0;x<out.width;x++){
        const u=x/(out.width-1),v=y/(out.height-1);
        const gx=gridSample(output.data,0,u,v,gw,gh);
        const gy=gridSample(output.data,1,u,v,gw,gh);
        if(Number.isFinite(gx)&&Number.isFinite(gy)&&Math.abs(gx)<=1&&Math.abs(gy)<=1)inBounds++;
        sample(original,canvas.width,canvas.height,
          ((gx+1)/2)*(canvas.width-1),((gy+1)/2)*(canvas.height-1),
          raster.data,(y*out.width+x)*4);
      }
      context.putImageData(raster,0,0);
      traces.push({stage:'dense',message:'UVDoc grid coverage',data:{
        inBoundsFraction:+(inBounds/(out.width*out.height)).toFixed(4),
        note:'Unwarped image is NOT a verified A4 OMR grid; evaluate printed landmarks independently'}});
      return {...fail(def,start,'UNVERIFIED UVDoc deformation grid; inspect exported unwarped image',traces),
        outcome:'detected',researchImage:out.toDataURL('image/png'),
        elapsedMs:Math.round(performance.now()-start),imageSpace:{width:canvas.width,height:canvas.height}};
    }
    const mask=visualizeMask(canvas,output.data,output.dims);
    traces.push({stage:'dense',message:'DeepLab mask coverage',data:{
      documentFraction:+mask.fraction.toFixed(4),outputDimensions:mask.dims,
      note:'Mask is not a verified paper outline; external model has unconfirmed upstream license'}});
    return {...fail(def,start,'UNVERIFIED external DeepLab document segmentation; inspect mask',traces),
      outcome:'detected',researchImage:mask.image,
      elapsedMs:Math.round(performance.now()-start),
      imageSpace:{width:canvas.width,height:canvas.height}};
  }catch(error){
    traces.push({stage:'dense',message:'research-inference-error',level:'ERROR',
      data:{reason:String(error)}});
    return fail(def,start,String(error),traces);
  }
}
