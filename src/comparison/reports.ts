import {cornersNormalized} from './engines';
import type {EngineResult,EngineDefinition,Point,ImageSpace} from './engines';
export type ReportMode='compact'|'differences'|'full';
const important=(s:string)=>/QR-less provisional geometry evidence|AI candidate verification result|scanic-variant|raw-model-corners|AI last-resort summary|Selected .+ registration|Registration performance summary|timing marks \d+\/50|QR missing|calibration/i.test(s);
function failures(r:EngineResult):string[]{
 return r.traces.filter(x=>x.level==='ERROR'||x.level==='WARNING'||important(x.message))
 .slice(-18).map(x=>x.message+(x.data?' '+JSON.stringify(x.data):''));
}
function round(x:number|null|undefined,digits=1):string{
 return x===null||x===undefined?'—':Number(x.toFixed(digits)).toString();
}
function quadDistance(a:Point[],b:Point[]):number|null{
 if(a.length!==4||b.length!==4)return null;
 const dist=(x:Point,y:Point)=>Math.hypot(x.x-y.x,x.y-y.y);
 return a.reduce((sum,p,i)=>sum+dist(p,b[i]),0)/4;
}
export function buildCompareReport(params:{
 fileName:string;hash:string;fileBytes:number;
 selected:EngineDefinition[];results:EngineResult[];mode:ReportMode;
 reference?:Point[];referenceSpace?:ImageSpace;
}):string{
 const {results,selected,mode,reference,referenceSpace}=params;
 const lines=[
   'SFG OMR LAB v2.4 — UNIVERSAL COMPARISON',
   'Image SHA-256='+params.hash,
   'File='+params.fileName+' | bytes='+params.fileBytes,
   'Generated='+new Date().toISOString(),
   'Engines requested='+selected.map(e=>e.id+'@'+e.version).join(', '),
   'IMPORTANT: detector-only AI results are NOT scored OMR scans.',
   'Engine | type | outcome | milliseconds | QR | timing | bubbles | confidence',
 ];
 for(const e of selected){
   const r=results.find(z=>z.id===e.id);
   if(!r){lines.push(e.id+' | '+e.kind+' | NOT-RUN');continue;}
   lines.push([e.id,e.kind,r.outcome,r.elapsedMs,
     r.qrValid===null?'n/a':r.qrValid?'valid':'invalid',
     r.timing===null?'n/a':r.timing+'/50',
     r.kind==='detector'?'n/a':r.kind==='bubble'?
       r.answers.length+' experimental rows / 0 verified':r.answers.length+'/50',
     round(r.confidence,4)].join(' | '));
 }
 const fail=results.filter(r=>r.outcome!=='verified');
 lines.push('Primary findings:');
 if(!results.length)lines.push('  No results generated.');
 for(const r of fail)lines.push('  '+r.id+': '+r.outcome+' — '+r.reason);
 const scanners=results.filter(r=>r.kind==='scanner'&&r.answers.length===50);
 const differences:number[]=[];
 if(scanners.length>=2){
   for(let q=1;q<=50;q++){
     const options=scanners.map(r=>r.answers.find(a=>a.q===q)?.answer??'-');
     if(new Set(options).size>1)differences.push(q);
   }
 }
 lines.push(scanners.length<2?'Complete-answer scanner disagreements=NOT COMPARABLE (fewer than two scanners analyzed 50 rows)':
   'Complete-answer scanner disagreements='+differences.length+
   (differences.length?' | rows='+differences.join(','):''));
 // Only compare independent corner detections in a common normalized space.
 // Bubble AI inherits Scanic corners; repeating it would fabricate an extra vote.
 const cornered=results.filter(r=>r.kind!=='bubble'&&cornersNormalized(r)!==null);
 const cornerPairs=cornered.map(r=>({r,n:cornersNormalized(r)!}));
 if(reference?.length===4&&referenceSpace?.width&&referenceSpace.height){
   const target=reference.map(p=>({x:p.x/referenceSpace.width,y:p.y/referenceSpace.height}));
   lines.push('MANUALLY CONFIRMED paper corners='+JSON.stringify(reference)+
     ' | coordinateSpace='+referenceSpace.width+'x'+referenceSpace.height);
   lines.push('Page-corner error vs manual reference (pixels in uploaded-image space):');
   for(const {r,n} of cornerPairs){
     const d=n.reduce((total,p,i)=>total+Math.hypot(
       (p.x-target[i].x)*referenceSpace.width,(p.y-target[i].y)*referenceSpace.height),0)/4;
     lines.push('  '+r.id+': '+round(d,2)+' px');
   }
 }
 if(cornerPairs.length>=2){
   lines.push('Independent page-corner disagreement (percent of image diagonal; normalized coordinates):');
   for(let i=0;i<cornerPairs.length;i++)for(let j=i+1;j<cornerPairs.length;j++){
     const a=cornerPairs[i],b=cornerPairs[j];
     // Compare in the actual input photo's pixel aspect ratio.
     const w=referenceSpace?.width??1,h=referenceSpace?.height??1;
     const distance=a.n.reduce((sum,p,k)=>sum+Math.hypot(
       (p.x-b.n[k].x)*w,(p.y-b.n[k].y)*h),0)/4;
     lines.push('  '+a.r.id+' vs '+b.r.id+': '+round(
       distance/Math.hypot(w,h)*100,2)+'% image diagonal');
   }
 }
 if(mode==='compact'){
   lines.push('Next: inspect full or differences report only if registration or bubbles disagree.');
   lines.push('Image pixels not embedded. Attach original photo separately for visual diagnosis.');
   return lines.join('\n');
 }
 lines.push('ENGINE INVESTIGATIONS:');
 for(const r of results){
   lines.push('--- '+r.id+' / '+r.version+' ---');
   lines.push('Status: '+r.outcome+' | Reason: '+r.reason);
   lines.push('Corners: '+JSON.stringify(r.corners.map(p=>({x:+p.x.toFixed(2),y:+p.y.toFixed(2)})))+
     ' | nativeSpace='+JSON.stringify(r.imageSpace));
   lines.push('Timing: '+(r.timing??'n/a')+' | left='+(r.timingLeft??'n/a')+
     ' right='+(r.timingRight??'n/a')+' | QR='+(r.qrValid??'n/a'));
   if(mode==='full'){
     lines.push(r.kind==='bubble'?'Experimental AI estimates (not optical answers): '+JSON.stringify(r.answers):
       'Answers: '+JSON.stringify(r.answers));
     lines.push('Full stage logs ('+r.traces.length+'):');
     for(const log of r.traces)lines.push('  '+log.stage+' '+log.message+
       (log.data?' '+JSON.stringify(log.data):''));
   }else{
     lines.push('Relevant stage evidence:');
     for(const line of failures(r))lines.push('  '+line);
     if(r.answers.length===50&&differences.length)
       lines.push('Disagreeing answers: '+JSON.stringify(
         r.answers.filter(a=>differences.includes(a.q))));
   }
 }
 lines.push('Do not treat unverified/provisional detections as official grades.');
 return lines.join('\n');
}
export function downloadText(name:string,value:string){
 const url=URL.createObjectURL(new Blob([value],{type:'text/plain;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download=name;a.click();
 window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function downloadJson(name:string,meta:unknown,results:EngineResult[]){
 const url=URL.createObjectURL(new Blob([JSON.stringify({schema:'sfg-comparison/v1',meta,
   results:results.map(({alignedImage,...safe})=>safe)},null,2)],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download=name;a.click();
 window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
