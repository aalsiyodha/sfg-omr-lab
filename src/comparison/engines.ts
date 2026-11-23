import type { ScanResult } from '../types';
import { recoverPageWithScanic } from '../scanner/scanicPageRescue';
import { recoverPageWithAI } from '../scanner/aiPageRescue';
import { runBubbleAi } from './bubbleAi';
import { runLandmarkGrid,evaluateResearchCanvas } from './landmarkGrid';
import {compareAnswers} from './answerComparison';
import { runDenseResearch } from './denseResearch';

export type EngineId='current'|'v2345'|'v226'|'v224'|'scanic'|'lcnet'|'fastvit'|'bubblecnn'|'landmark'|'sa24'|'uvdoc'|'deeplab';
export type Outcome='verified'|'partial'|'provisional'|'failed'|'detected'|'rejected'|'error';
export interface Point {x:number;y:number}
export interface ImageSpace {width:number;height:number}
/** Convert source-native corner coordinates to normalized fractions; do not compare raw pixels from differently resized scans. */
export function cornersNormalized(r:Pick<EngineResult,'corners'|'imageSpace'>):Point[]|null{
  const {imageSpace}=r;
  if(!imageSpace||imageSpace.width<=0||imageSpace.height<=0||r.corners.length!==4)return null;
  return r.corners.map(p=>({x:p.x/imageSpace.width,y:p.y/imageSpace.height}));
}
export interface EngineDefinition{
  id:EngineId;name:string;kind:'scanner'|'detector'|'bubble'|'landmark';details:string;
  version:string;assetPath?:string;sizeNote?:string;
}
export const ENGINES:EngineDefinition[]=[
  {id:'current',name:'Current v2.4.618',kind:'scanner',version:'2.4.618',details:'Official scanner, independent QR/timing verification',assetPath:''},
  {id:'v2345',name:'OpenCV v2.3.45',kind:'scanner',version:'2.3.45',details:'Independent archived hybrid registration',assetPath:'v2.3.45/'},
  {id:'v226',name:'OpenCV v2.2.6 Lite',kind:'scanner',version:'2.2.6-lite.2',details:'Historical lightweight optical engine',assetPath:'versions/v2.2.6/'},
  {id:'v224',name:'OpenCV v2.2.4',kind:'scanner',version:'2.2.4',details:'Earlier strict geometry scanner',assetPath:'versions/v2.2.4/'},
  {id:'landmark',name:'Optical Local-Grid v5',kind:'landmark',version:'2.4.618-exp9',details:'Optical independent warp, QR and held-out timing verification, row-wise timing corrections and center/quadrant bubble morphology, including partial-mark uncertainty. Not a grading authority.'},
  {id:'scanic',name:'Scanic DocCornerNet',kind:'detector',version:'1.8.0 / model 0.2.0',details:'SimCC page-corner predictions; not a bubble scanner',sizeNote:'~1.9 MB model'},
  {id:'lcnet',name:'DocAligner LCNet-100',kind:'detector',version:'Quadscan 1.0.0',details:'Lightweight heatmap corner detector',sizeNote:'~4.8 MB model'},
  {id:'fastvit',name:'DocAligner FastViT-T8',kind:'detector',version:'Quadscan 1.0.0',details:'Larger 13 MB corner detector; download on selection',sizeNote:'~13 MB model'},
  {id:'sa24',name:'DocAligner FastViT-SA24 (large)',kind:'detector',version:'DocAligner / SA24',details:'Large 83 MB document-corner ONNX model (separate from T8); optional and not a scored OMR scanner.',sizeNote:'~83 MB model · may be slow on phones'},
  {id:'uvdoc',name:'UVDoc Neural Unwarping Grid',kind:'detector',version:'UVDoc 2023 / ONNX 2026-01-12',details:'Dense 45×31 deformation grid; exports research-only unwarped view. Grid is not OMR-verified.',sizeNote:'~30 MB ONNX + external weight file · Apache-2.0'},
  {id:'deeplab',name:'DeepLabV3-MobileNetV3 Document Mask',kind:'detector',version:'Pagescan legacy / update date unverified',details:'Optional third-party document mask from Hugging Face; weights load remotely, upstream redistribution license unconfirmed. Experimental overlay only.',sizeNote:'~44 MB external weight fetch · internet/CORS required'},
  {id:'bubblecnn',name:'SmallOMRNet Bubble AI',kind:'bubble',version:'hermitkk / AGPL-3.0',details:'Experimental filled/empty checkbox classifier on aligned bubble crops. NOT scoring.',sizeNote:'~148 KB model'},
];
export interface EngineResult {
  id:EngineId;name:string;kind:'scanner'|'detector'|'bubble'|'landmark';version:string;
  outcome:Outcome;elapsedMs:number;reason:string;
  corners:Point[];confidence:number|null;
  /** Native pixels of the canvas in which the returned corners were predicted. */
  imageSpace:ImageSpace|null;
  qrValid:boolean|null;alignmentVerified:boolean|null;
  timing:number|null;timingLeft:number|null;timingRight:number|null;
  markerCount:number|null;calibration:string|null;testId:number|null;
  answers:Array<{q:number;answer:string|null;status:string;confidence:number}>;
  traces:Array<{stage:string;message:string;data?:unknown;level?:string}>;
  raw?:ScanResult;
  /** Internal browser-only image for aligned bubble benchmarking; omitted from exports. */
  alignedImage?:string;
  /** Independent research visualization only; never interpreted as an aligned scoring sheet. */
  researchImage?:string;
}
const CHANNEL='sfg-omr-lab-compare-v1';
const MAX_FILE=25*1024*1024;
const ENGINE_TIMEOUT_MS=120000;
const base=import.meta.env.BASE_URL;
function convertScan(def:EngineDefinition,scan:ScanResult,elapsedMs:number):EngineResult {
  const verified=scan.alignmentVerified===true&&scan.qrValid===true;
  const outcome:Outcome=verified?(scan.overallStatus==='success'?'verified':'partial'):
    scan.provisional?'provisional':'failed';
  const foundAi=(scan.stageLogs??[]).find(l=>l.message==='AI document boundary recovery'&&
    Array.isArray(l.data?.corners));
  const corners=Array.isArray(foundAi?.data?.corners)?
    (foundAi.data.corners as Point[]):[];
  const confid=foundAi?.data?.confidence;
  const imageLoaded=(scan.stageLogs??[]).find(l=>l.message.startsWith('Image loaded:'));
  const dimensions=imageLoaded?.message.match(/Image loaded:\s*(\d+)\s*[×x]\s*(\d+)/);
  const imageSpace=dimensions?{width:Number(dimensions[1]),height:Number(dimensions[2])}:null;
  // The preliminary 24/50 timing result can be followed by a validated
  // refinement to 50/50. The previous report mixed those pre-refinement
  // left/right counts with the final verified total.
  const evidence=(scan.stageLogs??[]).filter(l=>
    /alignment candidate verified|timing-assisted refinement|timing marks \d+\/50/.test(l.message) &&
    typeof l.data?.left==='number'&&typeof l.data?.right==='number'
  ).map(l=>l.data).at(-1);
  return {
    id:def.id,name:def.name,kind:'scanner',version:def.version,outcome,elapsedMs,
    reason:scan.errors?.[0]||scan.warnings?.[0]||
      (verified?'QR and timing verification passed':'Registration not verified'),
    corners,confidence:typeof confid==='number'?confid:null,imageSpace,
    qrValid:scan.qrValid,alignmentVerified:scan.alignmentVerified??false,
    timing:scan.alignmentMatched??0,
    timingLeft:typeof evidence?.left==='number'?evidence.left:null,
    timingRight:typeof evidence?.right==='number'?evidence.right:null,
    markerCount:scan.markerCount??null,
    calibration:scan.grayCalibration?.status??null,
    testId:scan.testId,
    answers:(scan.answers??[]).map(q=>({
      q:q.question,answer:q.detectedAnswer||null,status:q.status,confidence:q.confidence
    })),
    traces:(scan.stageLogs??[]).map(l=>({stage:l.stage,message:l.message,
      data:l.data,level:l.level})),raw:scan
  };
}
function empty(def:EngineDefinition,reason:string,elapsedMs:number):EngineResult{
  return {id:def.id,name:def.name,kind:def.kind,version:def.version,
    outcome:'error',elapsedMs,reason,corners:[],confidence:null,imageSpace:null,
    qrValid:null,alignmentVerified:null,timing:null,timingLeft:null,timingRight:null,
    markerCount:null,calibration:null,testId:null,answers:[],traces:[]};
}
/** A fresh, hidden same-origin iframe isolates the legacy OpenCV globals and scanner code.
 * Each iframe handles exactly one photo and is torn down after its result.
 */
async function runIframe(def:EngineDefinition,file:File):Promise<EngineResult>{
  if(file.size>MAX_FILE)throw Error('Maximum supported file size: 25 MB');
  const bytes=await file.arrayBuffer();
  const iframe=document.createElement('iframe');
  iframe.setAttribute('aria-hidden','true');
  iframe.tabIndex=-1;
  iframe.style.cssText='position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;border:0';
  const requestId=def.id+'-'+Date.now().toString(36);
  const started=performance.now();
  return await new Promise<EngineResult>((resolve,reject)=>{
    let settled=false;
    let timer:number|undefined;
    let scanRequested=false;
    let lastStage='Waiting for isolated OpenCV initialization';
    let lastPercent=0;
    const milestones:Array<{stage:string;percent:number;elapsedMs:number}>=[];
    const diagnostic=(message:string)=>({
      ...empty(def,message,Math.round(performance.now()-started)),
      traces:[{stage:'comparison',message:'last-stage',level:'WARNING',
        data:{lastStage,lastPercent,milestones}}]
    });
    const cleanup=()=>{
      if(timer!==undefined)window.clearTimeout(timer);
      window.removeEventListener('message',handle);
      iframe.remove();
    };
    const finish=(result?:EngineResult,error?:Error)=>{
      if(settled)return;settled=true;cleanup();
      if(error)resolve(diagnostic(String(error)));else if(result)resolve(result);
    };
    const handle=(event:MessageEvent)=>{
      if(event.origin!==location.origin||event.source!==iframe.contentWindow)return;
      const msg=event.data as {
        channel?:string;type?:string;protocol?:number;
        requestId?:string;result?:ScanResult;error?:string;reason?:string;
        alignedImage?:string|null;stage?:string;percent?:number;
      };
      if(msg?.channel!==CHANNEL)return;
      if(msg.type==='ready'&&msg.protocol===1&&!scanRequested){
        scanRequested=true;
        lastStage='OpenCV initialized; scan request sent';
        milestones.push({stage:lastStage,percent:0,elapsedMs:Math.round(performance.now()-started)});
        iframe.contentWindow?.postMessage({channel:CHANNEL,type:'scan',requestId,
          name:file.name,mime:file.type,bytes,wantAlignedImage:def.id==='current'},location.origin);
      }else if(msg.type==='scan-progress'&&msg.requestId===requestId){
        lastStage=msg.stage||lastStage;
        lastPercent=typeof msg.percent==='number'?msg.percent:lastPercent;
        milestones.push({stage:lastStage,percent:lastPercent,elapsedMs:Math.round(performance.now()-started)});
      }else if(msg.type==='startup-error'){
        finish(undefined,Error(msg.reason||'OpenCV startup failed'));
      }else if(msg.type==='result'&&msg.requestId===requestId){
        if(msg.error)finish(undefined,Error(msg.error));
        else if(msg.result&&Array.isArray(msg.result.answers))
          finish({...convertScan(def,msg.result,Math.round(performance.now()-started)),
            alignedImage:def.id==='current'?msg.alignedImage??undefined:undefined});
        else finish(undefined,Error('Invalid scanner bridge response'));
      }
    };
    window.addEventListener('message',handle);
    iframe.onerror=()=>finish(undefined,Error('Legacy engine failed to load'));
    timer=window.setTimeout(()=>finish(diagnostic('Engine timed out after 120 seconds; last stage: '+
      lastStage+' ('+lastPercent+'%)')),ENGINE_TIMEOUT_MS);
    iframe.src=base+(def.assetPath??'')+'?compareBridge=1#/scan';
    document.body.appendChild(iframe);
  });
}
async function canvasFor(file:File):Promise<HTMLCanvasElement>{
  const bitmap=await createImageBitmap(file);
  try{
    const canvas=document.createElement('canvas');
    canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d');
    if(!ctx)throw Error('Canvas unavailable');
    ctx.drawImage(bitmap,0,0);
    return canvas;
  }finally{bitmap.close();}
}
async function runDetector(def:EngineDefinition,file:File):Promise<EngineResult>{
  const started=performance.now();
  const traces:EngineResult['traces']=[];
  const trace=(event:string,data:Record<string,unknown>)=>traces.push({
    stage:'AI',message:event,data,level:'INFO'
  });
  try{
    const canvas=await canvasFor(file);
    const result=def.id==='scanic'?
      await recoverPageWithScanic(canvas,trace):
      await recoverPageWithAI(canvas,trace,def.id==='fastvit'?'fastvit':def.id==='sa24'?'sa24':'lcnet');
    const rawCorn=traces.findLast(t=>t.message==='raw-model-corners')?.data;
    const raw=rawCorn&&typeof rawCorn==='object'?rawCorn as {
      corners?:Point[];confidence?:number
    }:null;
    const confidence=result?.confidence??raw?.confidence??null;
    const corners=result?.corners??raw?.corners??[];
    // AI boundary is NOT independently validated. Export a warped image only
    // to the research-only bubble model, never to official scanner grading.
    const alignedImage=def.id==='scanic' && result ? result.canvas.toDataURL('image/png') : undefined;
    const readout=result?evaluateResearchCanvas(result.canvas):null;
    if(readout)traces.push({stage:'research',message:'AI geometry to optical timing, QR and bubble trial',data:{
      qrFound:readout.qrFound,qrValid:readout.qrValid,qrRaw:readout.qrRaw,
      timingLeft:readout.left,timingRight:readout.right,
      grayReference:readout.grayscale,experimentalRows:readout.answers.length,
      candidateMarks:readout.answers.filter(a=>a.answer).length,
      beforeOpticalCorrection:readout.unrefined.map(a=>({q:a.q,answer:a.answer,status:a.status})),
      afterOpticalCorrection:readout.answers.map(a=>({q:a.q,answer:a.answer,status:a.status})),
      changedByOpticalCorrection:readout.correctionChangedRows,
      scoringAllowed:false,notGroundTruth:true}});
    return {...empty(def,result?'Page-corner candidate predicted':'No acceptable page-corner candidate',
      Math.round(performance.now()-started)),outcome:result?'detected':'rejected',
      confidence,corners,traces,alignedImage,imageSpace:{width:canvas.width,height:canvas.height},
      researchImage:result?.canvas.toDataURL('image/png'),
      qrValid:readout?.qrValid??null,alignmentVerified:false,
      timing:readout?readout.left+readout.right:null,
      timingLeft:readout?.left??null,timingRight:readout?.right??null,
      calibration:readout?.grayscale.usable?'ok':'unverified',
      answers:readout?.answers??[],
      reason:result?'AI page candidate; independent experimental QR/timing/bubble readout (not verified, never grade)':
        'Model returned no accepted geometry (inspect per-view diagnostics)'};
  }catch(error){
    const message=String(error);
    const invalidQuad=/DegenerateQuadError|Could not assign all four corners/i.test(message);
    traces.push({stage:'AI',message:invalidQuad?'geometry-rejected':'model-error',
      data:{reason:message},level:invalidQuad?'WARNING':'ERROR'});
    return {...empty(def,message,Math.round(performance.now()-started)),
      outcome:invalidQuad?'rejected':'error',traces};
  }
}
export async function runEngine(def:EngineDefinition,file:File,previous:EngineResult[]=[]):Promise<EngineResult>{
  const t=performance.now();
  try{
    const result=def.kind==='scanner'?await runIframe(def,file):
      def.kind==='landmark'?await runLandmarkGrid(def,file,previous):
      def.id==='uvdoc'||def.id==='deeplab'?await runDenseResearch(def,file):
      def.kind==='bubble'?await runBubbleAi(def,
        previous.find(x=>x.id==='current'&&Boolean(x.alignedImage))??
        previous.find(x=>x.id==='scanic'&&Boolean(x.alignedImage))):
      await runDetector(def,file);
    // One consistent question-by-question comparison across all models.
    // Do not count uncertain samples as confirmed blanks.
    const reference=previous.find(x=>x.kind==='scanner'&&x.alignmentVerified===true
      &&x.qrValid===true&&x.answers.length===50);
    if(reference&&result.id!==reference.id){
      const c=compareAnswers(reference,result);
      result.traces.push({stage:'research',message:'50-question independent engine comparison',
        data:{reference:c.referenceId,observed:c.coverage,comparable:c.comparable,
          exact:c.exactMatches,wrongOptions:c.optionErrors,extraMarks:c.extraMarks,
          missedMarks:c.missedMarks,statusMismatches:c.statusErrors,
          unresolved:c.unresolved,notGroundTruth:true,scoringAllowed:false}});
      // Before/after metrics isolate whether optical timing correction helps
      // a neural page warp; both comparisons use the same optical reference.
      const correction=result.traces.find(t=>t.message==='AI geometry to optical timing, QR and bubble trial');
      const evidence=correction?.data as {beforeOpticalCorrection?:EngineResult['answers']}|undefined;
      if(evidence?.beforeOpticalCorrection){
        const raw=compareAnswers(reference,{...result,answers:evidence.beforeOpticalCorrection});
        result.traces.push({stage:'research',message:'AI geometry before-versus-after optical refinement',
          data:{reference:reference.id,raw:{exact:raw.exactMatches,comparable:raw.comparable,
            extra:raw.extraMarks,missed:raw.missedMarks,unresolved:raw.unresolved},
            refined:{exact:c.exactMatches,comparable:c.comparable,
              extra:c.extraMarks,missed:c.missedMarks,unresolved:c.unresolved},
            notGroundTruth:true,scoringAllowed:false}});
      }
    }
    return result;
  }catch(error){return empty(def,String(error),Math.round(performance.now()-t));}
}
export async function imageSha256(file:File):Promise<string>{
  const bytes=await file.arrayBuffer();
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('');
}
