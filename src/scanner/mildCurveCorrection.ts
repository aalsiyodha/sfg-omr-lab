/**
 * Local OpenCV recovery for QR-verified, timing-rejected Lite registrations.
 * Track the actual timing rectangles along both edges, rather than searching
 * ±1–2 mm around each expected position. Estimate a bounded smooth warp from
 * odd row numbers only; even row numbers remain independent validation.
 *
 * IMPORTANT: this never accepts alignment. The caller rechecks the SAME QR,
 * all 50 exact timing positions, and the withheld timing rows before grading.
 */
import { OMR_LAYOUT, mmToPx } from '../config/omrLayout';
import { computeAdaptiveDarkThreshold } from './bubbleDetector';
declare const cv:any;

type Side='left'|'right';
export interface Drift {row:number;dx:number;dy:number}
export interface TimingCandidate {x:number;y:number;area:number;w:number;h:number}
export interface MeshAttemptEvidence {
  reason:string;
  candidates:{left:number;right:number};
  assigned:{left:number;right:number};
  controls:{left:number;right:number};
  maxAbsShiftPx?:number;
  details?:string;
}
export interface MeshEvidence {
  sampled:{left:number;right:number};
  controls:{left:Drift[];right:Drift[]};
  maxAbsShiftPx:number;
  holdoutRows:number[];
  candidateCount:{left:number;right:number};
  assignedCount:{left:number;right:number};
}
const empty=(reason:string):MeshAttemptEvidence=>({
  reason,candidates:{left:0,right:0},assigned:{left:0,right:0},controls:{left:0,right:0}
});

/** Linear interpolation, with bounded constant extrapolation at the endpoints. */
export const smoothDrift=(control:Drift[],row:number):{dx:number;dy:number}=>{
  if(!control.length)return {dx:0,dy:0};
  const a=[...control].sort((x,y)=>x.row-y.row);
  if(row<=a[0].row)return {dx:a[0].dx,dy:a[0].dy};
  if(row>=a[a.length-1].row)return {dx:a[a.length-1].dx,dy:a[a.length-1].dy};
  for(let i=1;i<a.length;i++)if(row<=a[i].row){
    const t=(row-a[i-1].row)/(a[i].row-a[i-1].row);
    return {dx:a[i-1].dx+(a[i].dx-a[i-1].dx)*t,
      dy:a[i-1].dy+(a[i].dy-a[i-1].dy)*t};
  }
  return {dx:0,dy:0};
};
/** Reject corrections that are implausibly large or change too fast.
 * This is not a validation of registration, just a safety bound. */
export function isPlausibleDrift(control:Drift[],maxDx:number,maxDy:number):boolean{
  if(control.length<7||control[control.length-1].row-control[0].row<16)return false;
  for(let i=0;i<control.length;i++){
    if(Math.abs(control[i].dx)>maxDx||Math.abs(control[i].dy)>maxDy)return false;
    if(i>0){
      const gap=Math.max(1,control[i].row-control[i-1].row);
      if(Math.abs(control[i].dx-control[i-1].dx)/gap>9 ||
         Math.abs(control[i].dy-control[i-1].dy)/gap>5)return false;
    }
  }
  return true;
}
function detectTimingCandidates(gray:any,side:Side,dpi:number,threshold:number):TimingCandidate[]{
  const scale=(mm:number)=>mmToPx(mm,dpi);
  const nominalWidth=scale(2.2),nominalHeight=scale(1.6);
  const xTarget=scale(side==='left'?13.3:196.7);
  const topTarget=scale(OMR_LAYOUT.answers.rowStartY);
  const bottomTarget=scale(OMR_LAYOUT.answers.rowStartY+
    (OMR_LAYOUT.answers.questionsPerCol-1)*OMR_LAYOUT.answers.rowSpacingY);
  // Wider in X to accommodate curved/keystoned edges, but only around
  // printed timing bands, not the answer bubble and question-number regions.
  const x1=Math.max(0,Math.floor(xTarget-scale(9.0)));
  const x2=Math.min(gray.cols,Math.ceil(xTarget+scale(9.0)));
  const y1=Math.max(0,Math.floor(topTarget-scale(6.0)));
  const y2=Math.min(gray.rows,Math.ceil(bottomTarget+scale(6.0)));
  if(x2-x1<20||y2-y1<60)return [];
  let roi:any=null,binary:any=null,contours:any=null,hierarchy:any=null;
  try{
    roi=gray.roi(new cv.Rect(x1,y1,x2-x1,y2-y1));
    binary=new cv.Mat();
    cv.threshold(roi,binary,threshold,255,cv.THRESH_BINARY_INV);
    contours=new cv.MatVector();hierarchy=new cv.Mat();
    cv.findContours(binary,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
    const out:TimingCandidate[]=[];
    for(let i=0;i<contours.size();i++){
      const contour=contours.get(i);
      try{
        const rect=cv.boundingRect(contour);
        const area=cv.contourArea(contour);
        const aspect=rect.width/Math.max(1,rect.height);
        const density=area/Math.max(1,rect.width*rect.height);
        // The 4x4mm central fiducials, text, lines, QR fragments, and
        // isolated ink must NOT be mistaken for ~2.2x1.6mm timing bars.
        if(rect.width<nominalWidth*.45||rect.width>nominalWidth*1.85||
           rect.height<nominalHeight*.48||rect.height>nominalHeight*2.1||
           aspect<.58||aspect>2.65||
           area<nominalWidth*nominalHeight*.20||
           area>nominalWidth*nominalHeight*2.8||density<.48)continue;
        out.push({x:x1+rect.x+rect.width/2,
          y:y1+rect.y+rect.height/2,
          area,w:rect.width,h:rect.height});
      }finally{contour.delete();}
    }
    return out.sort((a,b)=>a.y-b.y);
  }catch{return [];}finally{
    for(const m of [roi,binary,contours,hierarchy])try{m?.delete?.();}catch{/* cleanup */}
  }
}

/** Associate printed timing bars with template rows monotonically.
 * Search near the previously tracked drift, not near an erroneous initial
 * global warp. Each component is used at most once.
 */
export function assignTimingRows(candidates:TimingCandidate[],side:Side,dpi:number):Drift[]{
  const targetX=mmToPx(side==='left'?13.3:196.7,dpi);
  const startY=mmToPx(OMR_LAYOUT.answers.rowStartY,dpi);
  const spacing=mmToPx(OMR_LAYOUT.answers.rowSpacingY,dpi);
  const n=OMR_LAYOUT.answers.questionsPerCol;
  const maxX=mmToPx(8.8,dpi),maxY=Math.min(mmToPx(4.4,dpi),spacing*.61);
  const used=new Set<number>(),out:Drift[]=[];
  let prior:Drift|null=null;
  for(let row=0;row<n;row++){
    const targetY=startY+row*spacing;
    const predX=targetX+(prior?.dx??0),predY=targetY+(prior?.dy??0);
    const since=prior?row-prior.row:1;
    const allowedY=prior?Math.min(24,12+since*5):maxY;
    const allowedX=prior?Math.min(maxX,10+since*5):maxX;
    let best:{i:number;score:number;dx:number;dy:number}|null=null;
    for(let i=0;i<candidates.length;i++){
      if(used.has(i))continue;
      const p=candidates[i],dx=p.x-targetX,dy=p.y-targetY;
      if(Math.abs(dx)>maxX||Math.abs(dy)>maxY||
         Math.abs(p.y-predY)>allowedY||
         Math.abs(p.x-predX)>allowedX)continue;
      const nominal=mmToPx(2.2,dpi)*mmToPx(1.6,dpi);
      const score=1.6*Math.abs(p.y-predY)+.7*Math.abs(p.x-predX)+
        3*Math.abs(Math.log(Math.max(1,p.area)/nominal));
      if(!best||score<best.score)best={i,score,dx,dy};
    }
    if(best){
      used.add(best.i);
      const found={row,dx:best.dx,dy:best.dy};
      out.push(found);prior=found;
    }
  }
  return out;
}
function gentlySmooth(control:Drift[]):Drift[]{
  // Mild noise rejection: blend neighboring *control* points only.
  return control.map((p,i)=>{
    if(i===0||i===control.length-1)return {...p};
    const prev=control[i-1],next=control[i+1];
    if(next.row-prev.row>7)return {...p};
    return {row:p.row,dx:.2*prev.dx+.6*p.dx+.2*next.dx,
      dy:.2*prev.dy+.6*p.dy+.2*next.dy};
  });
}
/** Called only for QR-verified, timing-rejected geometry, once per scan. */
export function correctMildPageWarp(rectified:any,dpi:number,
  onDiagnostic?:(e:MeshAttemptEvidence)=>void):
  {corrected:any;evidence:MeshEvidence}|null {
  let gray:any=null,mapX:any=null,mapY:any=null,corrected:any=null;
  const stats=empty('not-run');
  const report=(reason:string,details?:string)=>{
    stats.reason=reason;stats.details=details;
    onDiagnostic?.({...stats});
  };
  try{
    gray=new cv.Mat();cv.cvtColor(rectified,gray,cv.COLOR_RGBA2GRAY);
    const threshold=Math.min(180,computeAdaptiveDarkThreshold(gray)+8);
    const left=detectTimingCandidates(gray,'left',dpi,threshold);
    const right=detectTimingCandidates(gray,'right',dpi,threshold);
    stats.candidates={left:left.length,right:right.length};
    const rows={left:assignTimingRows(left,'left',dpi),
      right:assignTimingRows(right,'right',dpi)};
    stats.assigned={left:rows.left.length,right:rows.right.length};
    // Odd-numbered printed rows (0,2,...24) are fit points.
    // Even-numbered printed rows remain withheld for independent checks.
    const controls={left:gentlySmooth(rows.left.filter(p=>p.row%2===0)),
      right:gentlySmooth(rows.right.filter(p=>p.row%2===0))};
    stats.controls={left:controls.left.length,right:controls.right.length};
    if(rows.left.length<20||rows.right.length<20){
      report('insufficient-timing-track', 'Need at least 20/25 detected rows on both sides');
      return null;
    }
    if(controls.left.length<10||controls.right.length<10||
       controls.left[0]?.row>2||controls.right[0]?.row>2||
       controls.left[controls.left.length-1]?.row<22||
       controls.right[controls.right.length-1]?.row<22){
      report('insufficient-spread-controls','Need ten or more alternating-row anchors spanning first and last rows on each side');
      return null;
    }
    const maxDx=mmToPx(8.8,dpi),maxDy=mmToPx(4.4,dpi);
    if(!isPlausibleDrift(controls.left,maxDx,maxDy)||
       !isPlausibleDrift(controls.right,maxDx,maxDy)){
      report('implausible-or-abrupt-drift','Outside displacement or smoothness limits');
      return null;
    }
    const maxAbs=[...controls.left,...controls.right]
      .reduce((v,p)=>Math.max(v,Math.abs(p.dx),Math.abs(p.dy)),0);
    stats.maxAbsShiftPx=maxAbs;
    // Skip an expensive full-image remap if there is no meaningful drift.
    if(maxAbs<1.5){report('no-measurable-drift');return null;}
    mapX=new cv.Mat(rectified.rows,rectified.cols,cv.CV_32FC1);
    mapY=new cv.Mat(rectified.rows,rectified.cols,cv.CV_32FC1);
    const mx:Float32Array=mapX.data32F,my:Float32Array=mapY.data32F;
    const xL=mmToPx(13.3,dpi),xR=mmToPx(196.7,dpi);
    const firstY=mmToPx(OMR_LAYOUT.answers.rowStartY,dpi);
    const lastY=mmToPx(OMR_LAYOUT.answers.rowStartY+
      24*OMR_LAYOUT.answers.rowSpacingY,dpi);
    const fadeTop=firstY-mmToPx(18,dpi),fadeBottom=lastY+mmToPx(18,dpi);
    for(let y=0;y<rectified.rows;y++){
      const row=(y/mmToPx(1,dpi)-OMR_LAYOUT.answers.rowStartY)/
        OMR_LAYOUT.answers.rowSpacingY;
      const l=smoothDrift(controls.left,row),r=smoothDrift(controls.right,row);
      const fade=y<firstY?Math.max(0,Math.min(1,(y-fadeTop)/(firstY-fadeTop))):
        y>lastY?Math.max(0,Math.min(1,(fadeBottom-y)/(fadeBottom-lastY))):1;
      for(let x=0;x<rectified.cols;x++){
        const t=Math.max(0,Math.min(1,(x-xL)/(xR-xL)));
        const dx=(l.dx+(r.dx-l.dx)*t)*fade;
        const dy=(l.dy+(r.dy-l.dy)*t)*fade;
        const k=y*rectified.cols+x;
        mx[k]=x+dx;my[k]=y+dy;
      }
    }
    corrected=new cv.Mat();
    cv.remap(rectified,corrected,mapX,mapY,cv.INTER_LINEAR,cv.BORDER_CONSTANT,
      new cv.Scalar(255,255,255,255));
    const out=corrected;corrected=null;
    report('candidate-warp-created','Must independently reverify QR and withheld rows');
    return {corrected:out,evidence:{
      sampled:stats.controls,controls,maxAbsShiftPx:maxAbs,
      candidateCount:stats.candidates,assignedCount:stats.assigned,
      holdoutRows:Array.from({length:12},(_,i)=>2*i+2)
    }};
  }catch(e){
    report('opencv-exception',String(e));return null;
  }finally{
    for(const m of [gray,mapX,mapY,corrected])try{m?.delete?.();}catch{/* cleanup */}
  }
}

/** Count withheld even-numbered printed rows, not used to fit the warp.
 * A dark point is not enough by itself: caller also runs verifyTimingMarks
 * for all 50 positions and rechecks the original QR payload.
 */
export function countHeldOutTimingMarks(gray:any,dpi:number):{left:number;right:number}{
  const threshold=computeAdaptiveDarkThreshold(gray);
  const radius=Math.max(1,Math.round(mmToPx(.35,dpi)));
  const pixels:Uint8Array|undefined=gray.data;
  const stride=typeof gray.step==='number'?gray.step:gray.cols;
  const pixel=(y:number,x:number)=>pixels?pixels[y*stride+x]:gray.ucharPtr(y,x)[0];
  const result={left:0,right:0};
  for(let row=1;row<OMR_LAYOUT.answers.questionsPerCol;row+=2){
    const y=Math.round(mmToPx(OMR_LAYOUT.answers.rowStartY+
      row*OMR_LAYOUT.answers.rowSpacingY,dpi));
    for(const [side,xMm] of [['left',13.3],['right',196.7]] as const){
      const x=Math.round(mmToPx(xMm,dpi));
      if(x-radius<0||y-radius<0||x+radius>=gray.cols||y+radius>=gray.rows)continue;
      let dark=0,n=0;
      for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
        n++;if(pixel(y+dy,x+dx)<threshold)dark++;
      }
      if(dark/n>=.4)result[side]++;
    }
  }
  return result;
}
