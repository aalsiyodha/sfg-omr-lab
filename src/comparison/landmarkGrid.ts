/**
 * Local-Grid v4: optical registration and spatial ink-morphology research.
 *
 * Uses optical corner squares + *independently decoded* bottom ArUco IDs
 * from an earlier optical scanner's failed/successful trace. Four known
 * template anchors define an initial projective warp. On that warp, find
 * left/right printed timing bars independently for each of the 25 rows;
 * sample only rows supported by local timing anchors, adjusting each
 * column separately. No QR, AI, scoring, or automatic acceptance.
 *
 * This does not prove identity or actual bubble correctness. Even a full
 * row extraction is always an unverified research result.
 */
import {OMR_LAYOUT,getBubbleCentre} from '../config/omrLayout';
import {decodeQRFromRegion} from '../scanner/qrDecoder';
import type {EngineDefinition,EngineResult,Point} from './engines';

type Evidence={source:string;imageAnchors:Point[];templateAnchorsMm:Point[]};
type Trace=EngineResult['traces'][number];
type Track={row:number;x:number;y:number;dx:number;dy:number;contrast:number};
const MM=4; // 4 output pixels/mm (840x1188, ≈102dpi)
const W=210*MM,H=297*MM,OPTIONS='ABCD';
function solve(matrix:number[][]):number[]|null{
  const a=matrix.map(v=>[...v]),n=8;
  for(let i=0;i<n;i++){
    let k=i;
    for(let j=i+1;j<n;j++)if(Math.abs(a[j][i])>Math.abs(a[k][i]))k=j;
    if(Math.abs(a[k][i])<1e-9)return null;
    [a[i],a[k]]=[a[k],a[i]];
    const d=a[i][i];
    for(let c=i;c<=n;c++)a[i][c]/=d;
    for(let j=0;j<n;j++)if(j!==i){
      const scale=a[j][i];
      for(let c=i;c<=n;c++)a[j][c]-=scale*a[i][c];
    }
  }
  return a.map(row=>row[n]);
}
function homography(src:Point[],dst:Point[]):number[]|null{
  if(src.length!==4||dst.length!==4)return null;
  const matrix:number[][]=[];
  for(let i=0;i<4;i++){
    const {x,y}=src[i],p=dst[i];
    matrix.push([x,y,1,0,0,0,-p.x*x,-p.x*y,p.x]);
    matrix.push([0,0,0,x,y,1,-p.y*x,-p.y*y,p.y]);
  }
  return solve(matrix);
}
function project(Hm:number[],x:number,y:number):Point{
  const d=Hm[6]*x+Hm[7]*y+1;
  return {x:(Hm[0]*x+Hm[1]*y+Hm[2])/d,
    y:(Hm[3]*x+Hm[4]*y+Hm[5])/d};
}
function grayscaleWarp(image:ImageData,anchors:Point[],mmAnchors:Point[]):Uint8Array|null{
  // Inverse mapping: destination template px -> source photograph pixels.
  const inverse=homography(mmAnchors.map(p=>({x:p.x*MM,y:p.y*MM})),anchors);
  if(!inverse)return null;
  const result=new Uint8Array(W*H);
  const src=image.data,sw=image.width,sh=image.height;
  let valid=0;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const p=project(inverse,x,y),xx=Math.round(p.x),yy=Math.round(p.y),i=y*W+x;
    if(xx<0||xx>=sw||yy<0||yy>=sh){result[i]=255;continue;}
    const off=(yy*sw+xx)*4;
    result[i]=Math.round(.2126*src[off]+.7152*src[off+1]+.0722*src[off+2]);
    valid++;
  }
  return valid>W*H*.72?result:null;
}
function pixel(g:Uint8Array,x:number,y:number):number{
  return x>=0&&x<W&&y>=0&&y<H?g[Math.round(y)*W+Math.round(x)]:255;
}
function meanRect(g:Uint8Array,x:number,y:number,rx:number,ry:number):number{
  let n=0,sum=0;
  for(let yy=Math.round(y-ry);yy<=Math.round(y+ry);yy++)
    for(let xx=Math.round(x-rx);xx<=Math.round(x+rx);xx++){
      sum+=pixel(g,xx,yy);n++;
    }
  return n?sum/n:255;
}
function scanTrack(g:Uint8Array,side:'left'|'right'):Track[]{
  const xNom=(side==='left'?13.3:196.7)*MM;
  const output:Track[]=[];
  for(let row=0;row<25;row++){
    const yNom=(OMR_LAYOUT.answers.rowStartY+row*OMR_LAYOUT.answers.rowSpacingY)*MM;
    let best:{x:number;y:number;contrast:number;score:number}|null=null;
    // Full ±6mm x, ±3mm y around nominal timing bar. This recovers local
    // side displacement without demanding a corrected bottom-right corner.
    for(let dy=-12;dy<=12;dy+=2)for(let dx=-24;dx<=24;dx+=2){
      const x=Math.round(xNom+dx),y=Math.round(yNom+dy);
      if(x<10||x>W-10||y<10||y>H-10)continue;
      const dark=meanRect(g,x,y,3,2);
      const paper=(meanRect(g,x,y-9,3,2)+meanRect(g,x,y+9,3,2))/2;
      const contrast=paper-dark;
      // Penalize displacement to limit chasing printed text / bubble marks.
      const score=contrast-.12*Math.abs(dx)-.24*Math.abs(dy);
      if(!best||score>best.score)best={x,y,contrast,score};
    }
    if(best&&best.contrast>=48&&best.score>=42&&
      meanRect(g,best.x,best.y,3,2)<145){
      output.push({row,x:best.x,y:best.y,dx:best.x-xNom,
        dy:best.y-yNom,contrast:best.contrast});
    }
  }
  return output;
}
function rowDrift(track:Track[],row:number):{dx:number;dy:number;source:'measured'|'interpolated'}|null{
  const direct=track.find(t=>t.row===row);
  if(direct)return {dx:direct.dx,dy:direct.dy,source:'measured'};
  const before=[...track].reverse().find(t=>t.row<row);
  const after=track.find(t=>t.row>row);
  if(!before||!after||after.row-before.row>4)return null;
  const t=(row-before.row)/(after.row-before.row);
  return {dx:before.dx+(after.dx-before.dx)*t,
    dy:before.dy+(after.dy-before.dy)*t,source:'interpolated'};
}
/**
 * Reject isolated timing bars that jump to nearby text or an adjacent row.
 * A count of 25/25 is not evidence that each timing anchor is correct.
 * A local disagreement must become unobserved, never a shifted answer.
 */
function guardedRowDrift(track:Track[],row:number){
  const direct=track.find(t=>t.row===row);
  if(!direct)return rowDrift(track,row);
  const before=track.find(t=>t.row===row-1);
  const after=track.find(t=>t.row===row+1);
  if(before&&after){
    const expectedDx=(before.dx+after.dx)/2;
    const expectedDy=(before.dy+after.dy)/2;
    if(Math.hypot(direct.dx-expectedDx,direct.dy-expectedDy)>5.5)return null;
  }
  return rowDrift(track,row);
}
function timingLatticeDiagnostics(track:Track[]){
  const out:Array<{row:number;dx:number;dy:number;contrast:number;
    neighborResidualPx:number|null;outlier:boolean}>=[];
  for(const t of track){
    const before=track.find(v=>v.row===t.row-1);
    const after=track.find(v=>v.row===t.row+1);
    const residual=before&&after?Math.hypot(t.dx-(before.dx+after.dx)/2,
      t.dy-(before.dy+after.dy)/2):null;
    out.push({row:t.row+1,dx:t.dx,dy:t.dy,contrast:+t.contrast.toFixed(1),
      neighborResidualPx:residual===null?null:+residual.toFixed(2),
      outlier:residual!==null&&residual>5.5});
  }
  return out;
}
/** Hold out every other observed timing bar and interpolate from its
 * neighbors. Low residual is evidence against chasing unrelated print.
 * A detection count by itself is not proof of a coherent timing lattice.
 */
function timingCoherence(track:Track[]){
  const errors:number[]=[];
  for(let i=1;i<track.length-1;i++){
    const target=track[i],lo=track[i-1],hi=track[i+1];
    if(target.row%2!==1||target.row-lo.row>3||hi.row-target.row>3)continue;
    const t=(target.row-lo.row)/(hi.row-lo.row);
    const dx=lo.dx+(hi.dx-lo.dx)*t,dy=lo.dy+(hi.dy-lo.dy)*t;
    errors.push(Math.hypot(target.dx-dx,target.dy-dy));
  }
  const mean=errors.length?errors.reduce((a,b)=>a+b,0)/errors.length:null;
  return {heldOut:errors.length,meanResidualPx:mean===null?null:+mean.toFixed(2),
    coherent:errors.length>=5&&mean!==null&&mean<=4.5};
}
interface BubbleEvidence {fill:number;background:number;centerFill:number;
  quadrantMinimum:number;quadrantMaximum:number;solid:boolean}
/** Inner-disk density alone accepts crescents. Evaluate center and all four
 * quadrants independently, excluding the printed ring and option letters.
 * Thresholds are conservative research heuristics, not official UPSC rules.
 */
function bubbleFill(g:Uint8Array,x:number,y:number):BubbleEvidence{
  const radius=MM*.95,ring:number[]=[];
  const cx=Math.round(x),cy=Math.round(y);
  let dark=0,total=0,centerDark=0,centerTotal=0;
  const quadrants=[0,0,0,0],quadrantTotals=[0,0,0,0];
  for(let dy=-11;dy<=11;dy++)for(let dx=-11;dx<=11;dx++){
    const d=Math.hypot(dx,dy);
    if(d>=8.3&&d<=10.5&&dx<=2)ring.push(pixel(g,cx+dx,cy+dy));
  }
  ring.sort((a,b)=>a-b);
  const paper=ring.length?ring[Math.floor(ring.length/2)]:240;
  const threshold=Math.min(155,paper-34);
  for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){
    const d=Math.hypot(dx,dy);
    if(d>radius)continue;
    const isDark=pixel(g,cx+dx,cy+dy)<threshold;
    total++;if(isDark)dark++;
    if(d<=MM*.48){centerTotal++;if(isDark)centerDark++;}
    const q=(dy>=0?2:0)+(dx>=0?1:0);
    quadrantTotals[q]++;if(isDark)quadrants[q]++;
  }
  const qFill=quadrants.map((n,i)=>n/Math.max(1,quadrantTotals[i]));
  const fill=dark/Math.max(1,total);
  const centerFill=centerDark/Math.max(1,centerTotal);
  const quadrantMinimum=Math.min(...qFill),quadrantMaximum=Math.max(...qFill);
  // Require central coverage and distributed ink, not just a dark crescent.
  const solid=fill>=.80&&centerFill>=.68&&quadrantMinimum>=.54&&
    quadrantMaximum-quadrantMinimum<=.42;
  return {fill,background:paper,centerFill,quadrantMinimum,quadrantMaximum,solid};
}
/** Circular OMR decisions: keep blank, multiple and uncertainty distinct.
 * Returning a question status does not establish registration or grading.
 */
function classifyFills(evidence:BubbleEvidence[]):{answer:string|null;status:string;confidence:number}{
  const ranks=evidence.map((b,i)=>({...b,i})).sort((a,b)=>b.fill-a.fill);
  const valid=ranks.filter(r=>r.solid);
  const separation=ranks[0].fill-ranks[1].fill;
  if(valid.length>=2)return {answer:null,status:'multiple',
    confidence:Math.round(100*Math.min(1,valid[1].fill))};
  if(valid.length===1&&separation>=.25)return {
    answer:OPTIONS[valid[0].i],status:'detected',confidence:Math.round(separation*100)};
  if(ranks[0].fill<=.25)return {answer:null,status:'blank',
    confidence:Math.round((1-ranks[0].fill)*100)};
  // Partially dark / crescent shapes must not silently become blanks.
  return {answer:null,status:'uncertain',confidence:Math.round(separation*100)};
}
function strip(g:Uint8Array){
  const values=[132,141,150,159,168,177,186].map(x=>meanRect(g,x*MM,286.5*MM,4,4));
  const ordered=values.slice(1).every((v,i)=>v+11>=values[i]);
  return {values:values.map(x=>Math.round(x)),contrast:Math.round(values[6]-values[0]),
    ordered,usable:ordered&&values[6]-values[0]>=80&&values[0]<135};
}
function extractEvidence(results:EngineResult[]):Array<{e:Evidence;from:string;native:{width:number;height:number}}>{
  // Unlike v1, also accept complete optical square/ArUco hypotheses from
  // successful registrations. The QR-gated failure-only hybrid is absent
  // precisely on those easy sheets, and must not be a prerequisite here.
  const out:Array<{e:Evidence;from:string;native:{width:number;height:number}}>=[];

  const centres={
    topLeft:{x:9.5,y:9.5},topRight:{x:200.5,y:9.5},
    bottomRight:{x:200.5,y:287.5},bottomLeft:{x:9.5,y:287.5}
  };
  const arucoMm=[
    {x:83.5,y:10},{x:151.5,y:10},
    {x:117.5,y:287},{x:51.5,y:287}
  ];
  const point=(v:unknown):v is Point=>{
    if(!v||typeof v!=='object')return false;
    const p=v as Partial<Point>;
    return typeof p.x==='number'&&Number.isFinite(p.x)&&
      typeof p.y==='number'&&Number.isFinite(p.y);
  };
  const push=(r:EngineResult,source:string,pixels:unknown[],template:Point[])=>{
    if(!r.imageSpace||pixels.length!==4||!pixels.every(point))return;
    const pts=pixels as Point[];
    const cross=(a:Point,b:Point,c:Point)=>
      (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    // Geometric plausibility only. Verification still requires actual timing.
    if(!pts.every((p,i)=>cross(p,pts[(i+1)%4],pts[(i+2)%4])>0))return;
    const poly=pts.reduce((sum,p,i)=>{
      const q=pts[(i+1)%4];return sum+p.x*q.y-p.y*q.x;
    },0)/2;
    if(poly<1000)return;
    out.push({e:{source,imageAnchors:pts,templateAnchorsMm:template},
      from:r.id,native:r.imageSpace});
  };
  for(const r of results){
    if(r.kind!=='scanner'||!r.imageSpace)continue;
    for(const log of r.traces){
      const d=log.data as Record<string,unknown>|undefined;
      if(!d)continue;
      if(log.message==='Hybrid cross-family recovery evidence'){
        const h=d as Partial<Evidence>;
        if(Array.isArray(h.imageAnchors)&&Array.isArray(h.templateAnchorsMm))
          push(r,'hybrid/'+String(h.source||'unknown'),h.imageAnchors,
            h.templateAnchorsMm as Point[]);
      }
      if(/^corner\/(adaptive|Otsu): candidate coordinates$/.test(log.message)){
        push(r,log.message.replace(': candidate coordinates',''),
          [d.topLeft,d.topRight,d.bottomRight,d.bottomLeft],
          [centres.topLeft,centres.topRight,centres.bottomRight,centres.bottomLeft]);
      }
      if(/^aruco\/(adaptive|Otsu): candidate coordinates$/.test(log.message)){
        const pts=d.points as Record<string,unknown>|undefined;
        if(pts)push(r,log.message.replace(': candidate coordinates',''),
          [pts['0'],pts['1'],pts['3'],pts['2']],arucoMm);
      }
    }
  }
  // Keep at least one candidate per landmark family. Do not allow
  // duplicates across archived scanner versions to exhaust the budget.
  const seen=new Set<string>();
  return out.filter(v=>{
    const key=v.e.source+'-'+JSON.stringify(v.e.imageAnchors.map(p=>[
      Math.round(p.x/v.native.width*150),Math.round(p.y/v.native.height*150)]));
    if(seen.has(key))return false;seen.add(key);return true;
  }).slice(0,8);
}

/** Analyze a rectified research-only A4 candidate produced by any AI engine.
 * Samples the actual 50 question positions and separately estimates 25
 * left/right timing bars. Never returns a verified/scorable ScanResult.
 * This is deliberately independent of the full production scanner.
 */
export function evaluateResearchCanvas(canvas:HTMLCanvasElement){
  const resized=document.createElement('canvas');
  resized.width=W;resized.height=H;
  const ctx=resized.getContext('2d',{willReadFrequently:true});
  if(!ctx)throw Error('Research alignment canvas unavailable');
  ctx.drawImage(canvas,0,0,W,H);
  const rgba=ctx.getImageData(0,0,W,H).data;
  const g=new Uint8Array(W*H);
  for(let i=0;i<g.length;i++){
    const off=i*4;g[i]=Math.round(.2126*rgba[off]+.7152*rgba[off+1]+.0722*rgba[off+2]);
  }
  const left=scanTrack(g,'left'),right=scanTrack(g,'right');
  const calibrated=strip(g);
  const lattice={left:timingLatticeDiagnostics(left),
    right:timingLatticeDiagnostics(right)};
  const qr=decodeQRFromRegion(resized,OMR_LAYOUT.qr.xMm,OMR_LAYOUT.qr.yMm,
    OMR_LAYOUT.qr.sizeMm,4*25.4);
  const sideGood=(track:Track[])=>track.length>=18&&
    track[0].row<=3&&track.at(-1)!.row>=21&&timingCoherence(track).coherent;
  const answers:EngineResult['answers']=[];
  const unrefined:EngineResult['answers']=[];
  for(const side of ['left','right'] as const){
    const track=side==='left'?left:right;
    if(!sideGood(track))continue;
    for(let row=0;row<25;row++){
      const shift=guardedRowDrift(track,row);
      if(!shift)continue;
      const q=row+1+(side==='right'?25:0);
      const fills=[0,1,2,3].map(option=>{
        const p=getBubbleCentre(q,option as 0|1|2|3);
        return bubbleFill(g,p.xMm*MM+shift.dx,p.yMm*MM+shift.dy);
      });
      const decision=classifyFills(fills);
      answers.push({q,...decision});
      // Counterfactual: identical AI warp without local timing-track correction.
      // This isolates the effect of our optical row-drift refinement.
      const rawFills=[0,1,2,3].map(option=>{
        const p=getBubbleCentre(q,option as 0|1|2|3);
        return bubbleFill(g,p.xMm*MM,p.yMm*MM);
      });
      unrefined.push({q,...classifyFills(rawFills)});
    }
  }
  return {left:left.length,right:right.length,
    leftCoherence:timingCoherence(left),rightCoherence:timingCoherence(right),qrValid:qr.valid,
    qrFound:qr.found,qrRaw:qr.raw,grayscale:calibrated,lattice,
    leftGood:sideGood(left),rightGood:sideGood(right),answers,unrefined,
    correctionChangedRows:answers.filter(a=>{
      const raw=unrefined.find(b=>b.q===a.q);
      return raw&&(raw.status!==a.status||raw.answer!==a.answer);
    }).map(a=>a.q),
    warning:'Research-only geometric sampling; never automatically grade'};
}

export async function runLandmarkGrid(def:EngineDefinition,file:File,
  previous:EngineResult[]):Promise<EngineResult>{
  const start=performance.now();
  const traces:Trace[]=[];
  const finish=(outcome:EngineResult['outcome'],reason:string,
    answers:EngineResult['answers']=[],left:number|null=null,right:number|null=null,
    calibration:string|null=null):EngineResult=>({
    id:def.id,name:def.name,version:def.version,kind:'landmark',outcome,
    reason,elapsedMs:Math.round(performance.now()-start),
    corners:[],confidence:null,imageSpace:null,qrValid:null,alignmentVerified:false,
    timing:left!==null&&right!==null?left+right:null,timingLeft:left,timingRight:right,
    markerCount:null,calibration,testId:null,answers,traces
  });
  const candidates=extractEvidence(previous);
  if(!candidates.length)return finish('rejected',
    'No usable four-point optical landmark evidence. Run at least one full scanner first.');
  try{
    const bitmap=await createImageBitmap(file);
    let source:ImageData;
    try{
      const canvas=document.createElement('canvas');
      // Avoid a 48 MB full-resolution canvas on Android: the model only
      // needs ~4px/mm after warping. Scale source and fiducials together.
      const downscale=Math.min(1,1800/Math.max(bitmap.width,bitmap.height));
      canvas.width=Math.max(1,Math.round(bitmap.width*downscale));
      canvas.height=Math.max(1,Math.round(bitmap.height*downscale));
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      if(!ctx)throw Error('Image canvas unavailable');
      ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      source=ctx.getImageData(0,0,canvas.width,canvas.height);
    }finally{bitmap.close();}
    let best:{g:Uint8Array;left:Track[];right:Track[];
      strip:ReturnType<typeof strip>;anchorSource:string;variant:string;quality:number}|null=null;
    for(const {e,from,native} of candidates){
      // Source photograph can be 3000x4000 while optical scanner downsized to
      // 1200x1600. Convert anchor coordinates BEFORE projective mapping.
      const anchors=e.imageAnchors.map(p=>({x:p.x*source.width/native.width,
        y:p.y*source.height/native.height}));
      const g=grayscaleWarp(source,anchors,e.templateAnchorsMm);
      if(!g){traces.push({stage:'landmark',message:'invalid-optical-warp',
        data:{source:from,variant:e.source}});continue;}
      const left=scanTrack(g,'left'),right=scanTrack(g,'right'),gray=strip(g);
      const quality=left.length+right.length+(gray.usable?5:0);
      traces.push({stage:'landmark',message:'optical-hybrid-timing-trial',
        data:{source:from,variant:e.source,left:left.length,right:right.length,
          grayscale:gray,quality,anchorsOriginal:anchors,anchorMm:e.templateAnchorsMm}});
      if(!best||quality>best.quality)
        best={g,left,right,strip:gray,anchorSource:from,variant:e.source,quality};
    }
    if(!best)return finish('rejected','All optical-hybrid warp candidates invalid.');
    const leftGood=best.left.length>=18&&best.left[0].row<=3&&best.left.at(-1)!.row>=21&&timingCoherence(best.left).coherent;
    const rightGood=best.right.length>=18&&best.right[0].row<=3&&best.right.at(-1)!.row>=21&&timingCoherence(best.right).coherent;
    traces.push({stage:'landmark',message:'independent-side-validation',
      data:{left:best.left.length,right:best.right.length,leftGood,rightGood,
        lattice:{left:timingLatticeDiagnostics(best.left),
          right:timingLatticeDiagnostics(best.right)},
        leftCoherence:timingCoherence(best.left),rightCoherence:timingCoherence(best.right),
        selected:best.variant,from:best.anchorSource,
        curveRecovery:'per-row independently interpolated timing-bar displacements',
        noQR:true,grayscale:best.strip,
        note:'Unverified landmark estimates only; no identity proof or grading'}});
    const qrCanvas=document.createElement('canvas');
    qrCanvas.width=W;qrCanvas.height=H;
    const qrContext=qrCanvas.getContext('2d');
    let observedQR:{found:boolean;valid:boolean;raw:string|null}={
      found:false,valid:false,raw:null};
    if(qrContext){
      const qrPixels=qrContext.createImageData(W,H);
      for(let i=0;i<best.g.length;i++){
        const j=i*4,v=best.g[i];
        qrPixels.data[j]=v;qrPixels.data[j+1]=v;
        qrPixels.data[j+2]=v;qrPixels.data[j+3]=255;
      }
      qrContext.putImageData(qrPixels,0,0);
      observedQR=decodeQRFromRegion(qrCanvas,OMR_LAYOUT.qr.xMm,
        OMR_LAYOUT.qr.yMm,OMR_LAYOUT.qr.sizeMm,4*25.4);
    }
    traces.push({stage:'landmark',message:'local-grid-v2-identity-observation',
      data:{qrFound:observedQR.found,qrValid:observedQR.valid,
        qrRaw:observedQR.raw,left:best.left.length,right:best.right.length,
        note:'QR observation does not authorize Local Grid scoring'}});
    const answers:EngineResult['answers']=[];
    // A side without a sufficiently long independently detected timing track
    // does not receive inferred answer classifications.
    for(const side of ['left','right'] as const){
      const good=side==='left'?leftGood:rightGood;
      if(!good)continue;
      const track=side==='left'?best.left:best.right;
      for(let row=0;row<25;row++){
        const shift=guardedRowDrift(track,row);
        if(!shift){
          const question=row+1+(side==='right'?25:0);
          answers.push({q:question,answer:null,status:'unobserved',confidence:0});
          traces.push({stage:'landmark',message:'row-rejected-inconsistent-timing',
            data:{side,question,reason:'Missing or locally inconsistent timing anchor'}});
          continue;
        }
        const question=row+1+(side==='right'?25:0);
        const values=[0,1,2,3].map(option=>{
          const pos=getBubbleCentre(question,option as 0|1|2|3);
          return bubbleFill(best!.g,pos.xMm*MM+shift.dx,pos.yMm*MM+shift.dy);
        });
        const ranks=values.map((b,i)=>({i,fill:b.fill,background:b.background}))
          .sort((a,b)=>b.fill-a.fill);
        // Raise the exploratory gate after v2.4.611 produced a Q25=C
        // false positive (0.711 fill) on a verified blank row. Still not
        // permission to score: a strong dark core can be a stray mark.
        const decision=classifyFills(values);
        const answer=decision.answer;
        answers.push({q:question,...decision});
        traces.push({stage:'landmark',
          message:'example-row-sample',data:{side,question,track:shift,
            fill:values.map(v=>Number(v.fill.toFixed(3))),
            background:values.map(v=>Math.round(v.background)),
            decisionStatus:decision.status,
            morphology:values.map(v=>({center:Number(v.centerFill.toFixed(2)),
              minQuadrant:Number(v.quadrantMinimum.toFixed(2)),solid:v.solid})),answer,
            noGroundTruth:true}});
      }
    }
    // Honest performance accounting: this engine consumes hypotheses produced
    // by other scanners. The sum is a conservative sequential dependency cost,
    // not a claim of independent end-to-end timing.
    const contributors=Array.from(new Set(candidates.map(c=>c.from)));
    const upstreamMs=previous.filter(p=>contributors.includes(p.id))
      .reduce((total,p)=>total+p.elapsedMs,0);
    traces.push({stage:'performance',message:'assisted-local-grid-dependency-cost',
      data:{contributors,upstreamMs,localMs:Math.round(performance.now()-start),
        combinedSequentialMs:upstreamMs+Math.round(performance.now()-start),
        independentEndToEnd:false}});
    const reference=previous.find(r=>r.kind==='scanner'&&r.alignmentVerified&&r.qrValid&&r.answers.length===50);
    if(reference){
      let matches=0,differences=0,falseMarks=0,missedMarks=0,
        unresolvedBlank=0,multiple=0;
      for(const a of answers){
        const b=reference.answers.find(q=>q.q===a.q);
        if(!b)continue;
        if(b.status==='multiple'){multiple++;if(a.answer)falseMarks++;continue;}
        if(b.status==='blank'){if(a.answer)falseMarks++;else unresolvedBlank++;continue;}
        if(b.status==='detected'){
          if(!a.answer)missedMarks++;
          else if(a.answer===b.answer)matches++;
          else differences++;
        }
      }
      traces.push({stage:'landmark',message:'optical-reference-agreement',
        data:{reference:reference.id,comparableMarkedRows:matches+differences,
          matches,differences,falseMarks,missedMarks,unresolvedBlank,multiple,
          notGroundTruth:true,neverForGrading:true}});
    }
    traces.push({stage:'landmark',message:'experimental-bubble-summary',
      data:{measured:answers.length,decisive:answers.filter(a=>a.answer).length,
        uncertain:answers.filter(a=>!a.answer).length,
        leftTrack:best.left.length,rightTrack:best.right.length,
        grayscale:best.strip,source:best.anchorSource,variant:best.variant,
        noTrustedResults:true}});
    const reason='Local-Grid independent optical analysis: '+best.variant+
      ', left '+best.left.length+'/25, right '+best.right.length+'/25; QR '+
      (observedQR.valid?'decoded at expected location':'not decoded')+
      '; '+answers.length+' row decisions ('+
      answers.filter(a=>a.status==='detected').length+' marked, '+
      answers.filter(a=>a.status==='multiple').length+' multiple, '+
      answers.filter(a=>a.status==='blank').length+' blank, '+
      answers.filter(a=>a.status==='uncertain').length+' uncertain). '+
      'Compare against a reference; not authorized for official grading.';
    const result=finish(answers.length?'provisional':'rejected',reason,answers,
      best.left.length,best.right.length,best.strip.usable?'ok':'unverified');
    result.qrValid=observedQR.valid;
    result.alignmentVerified=false; // Separate engine has no full independent registration approval.
    return result;
  }catch(error){
    traces.push({stage:'landmark',message:'engine-error',
      data:{error:String(error)},level:'ERROR'});
    return finish('error',String(error));
  }
}
