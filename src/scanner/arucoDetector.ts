/**
 * OMR 2.1: browser-safe ArUco DICT_4X4_50 (printed IDs 0..3) decoder.
 * Uses ordinary OpenCV.js contours/perspective sampling: does NOT require
 * optional cv.aruco module in the browser WASM distribution.
 * All four independently identified markers are required for rescue.
 */
import {refineMarkerQuad} from './subpixelMarkerCorners';
declare const cv: any;
export interface ImagePoint { x:number; y:number }
export interface ArucoRegistration {
  found:boolean;
  count:number;
  points: Record<number,ImagePoint>;
  /** Four ordered marker corners in printed-marker TL/TR/BR/BL orientation. */
  corners?: Record<number,[ImagePoint,ImagePoint,ImagePoint,ImagePoint]>;
  /** Number of mismatched ArUco cells (including border) for each ID. */
  errors?: Record<number,number>;
  /** Whether native cornerSubPix was used for each retained marker. */
  refinement?: Record<number,string>;
  error?:string;
}
export const ARUCO_MARKERS_MM = [
  {id:0,x:83.5,y:10.0},
  {id:1,x:151.5,y:10.0},
  {id:2,x:51.5,y:287.0},
  {id:3,x:117.5,y:287.0},
] as const;
// Expected border-inclusive six-by-six matrices from the supplied JSON.
// These were independently checked against OpenCV DICT_4X4_50.
export const ARUCO_BITS = [
  ['######','#.#..#','##.#.#','###..#','###.##','######'],
  ['######','######','#....#','#.##.#','#.#.##','######'],
  ['######','###..#','###..#','###.##','#..#.#','######'],
  ['######','#.##.#','#.##.#','##.###','##..##','######'],
] as const;
function rotate(bits:number[][]):number[][]{
  const n=bits.length;
  return Array.from({length:n},(_,y)=>
    Array.from({length:n},(_,x)=>bits[n-1-x][y]));
}
/** Check all four orientations and avoid accepting a near-match to two IDs. */
export function decodeArucoCells(bits:number[][]):{id:number;errors:number}|null{
  if(bits.length!==6||bits.some(row=>row.length!==6))return null;
  let borderErrors=0;
  for(let y=0;y<6;y++)for(let x=0;x<6;x++)
    if((x===0||y===0||x===5||y===5)&&bits[y][x]!==1)borderErrors++;
  if(borderErrors>1)return null;
  let best:{id:number;errors:number}|null=null;
  let ambiguous=false;
  let current=bits;
  for(let turn=0;turn<4;turn++){
    for(let id=0;id<4;id++){
      let errors=borderErrors;
      for(let y=1;y<5;y++)for(let x=1;x<5;x++)
        if(current[y][x] !== (ARUCO_BITS[id][y][x]==='#'?1:0))errors++;
      if(!best||errors<best.errors){best={id,errors};ambiguous=false;}
      else if(errors===best.errors && best.id!==id)ambiguous=true;
    }
    current=rotate(current);
  }
  return best && best.errors<=1 && !ambiguous?best:null;
}
function orderCorners(pts:ImagePoint[]):ImagePoint[]{
  // Centroid-angle ordering avoids duplicated vertices at 45-degree roll.
  if(pts.length!==4)throw new Error('Expected exactly four marker vertices');
  const cx=pts.reduce((s,p)=>s+p.x,0)/4;
  const cy=pts.reduce((s,p)=>s+p.y,0)/4;
  const ordered=[...pts].sort((a,b)=>Math.atan2(a.y-cy,a.x-cx)-Math.atan2(b.y-cy,b.x-cx));
  const start=ordered.reduce((best,p,i)=>p.x+p.y<ordered[best].x+ordered[best].y?i:best,0);
  return [...ordered.slice(start),...ordered.slice(0,start)];
}
function readCandidate(gray:any,pts:ImagePoint[]):{
  id:number;errors:number;corners:[ImagePoint,ImagePoint,ImagePoint,ImagePoint]
}|null{
  let src:any=null,dst:any=null,H:any=null,patch:any=null;
  try{
    const p=orderCorners(pts);
    src=cv.matFromArray(4,1,cv.CV_32FC2,p.flatMap(v=>[v.x,v.y]));
    dst=cv.matFromArray(4,1,cv.CV_32FC2,[0,0,119,0,119,119,0,119]);
    H=cv.getPerspectiveTransform(src,dst);
    patch=new cv.Mat();
    cv.warpPerspective(gray,patch,H,new cv.Size(120,120));
    const values:number[][]=[];
    const flat:number[]=[];
    for(let y=0;y<6;y++){
      const row:number[]=[];
      for(let x=0;x<6;x++){
        // Interior-only samples reduce module edge interpolation.
        const probes:number[]=[];
        for(const dy of [-2,0,2])for(const dx of [-2,0,2])
          probes.push(patch.ucharPtr(y*20+10+dy,x*20+10+dx)[0]);
        probes.sort((a,b)=>a-b);
        row.push(probes[4]);
        flat.push(probes[4]);
      }
      values.push(row);
    }
    const sorted=[...flat].sort((a,b)=>a-b);
    const dark=sorted[7],light=sorted[29];
    if(light-dark<35)return null;
    const threshold=(dark+light)/2;
    const bits=values.map(row=>row.map(v=>v<threshold?1:0));
    // Preserve the rotational phase. Marker corners alone are not labelled
    // correspondences until the ArUco payload establishes their orientation.
    const decoded=decodeArucoCells(bits);
    if(!decoded)return null;
    let current:number[][]=bits,turn=-1;
    for(let t=0;t<4;t++){
      let errors=0;
      const expected=ARUCO_BITS[decoded.id];
      for(let y=0;y<6;y++)for(let x=0;x<6;x++)
        if(current[y][x] !== (expected[y][x]==='#'?1:0))errors++;
      if(errors===decoded.errors){turn=t;break;}
      current=rotate(current);
    }
    if(turn<0)return null;
    const canonical=Array.from({length:4},(_,i)=>p[(4-turn+i)%4]) as
      [ImagePoint,ImagePoint,ImagePoint,ImagePoint];
    return {...decoded,corners:canonical};
  }catch{return null;}finally{
    for(const v of [src,dst,H,patch]){try{v?.delete?.();}catch{/* WASM cleanup */}}
  }
}
export function detectArucoMarkers(gray:any,thresholded:any):ArucoRegistration{
  const points:Record<number,ImagePoint>={};
  const corners:Record<number,[ImagePoint,ImagePoint,ImagePoint,ImagePoint]>={};
  const errors:Record<number,number>={};
  const refinement:Record<number,string>={};
  const missed=(reason:string):ArucoRegistration=>({
    found:false,count:Object.keys(points).length,points,corners,errors,refinement,error:reason,
  });
  if(!gray||!thresholded||!gray.cols||!gray.rows)
    return missed('No grayscale or thresholded image');
  const contours=new cv.MatVector(),hierarchy=new cv.Mat();
  const strengths:Record<number,number>={};
  try{
    cv.findContours(thresholded,contours,hierarchy,cv.RETR_LIST,cv.CHAIN_APPROX_SIMPLE);
    const page=gray.cols*gray.rows;
    const expected=page*(49/(210*297));
    let candidates=0;
    for(let i=0;i<contours.size();i++){
      const contour=contours.get(i);
      let approx:any=null;
      try{
        const area=cv.contourArea(contour);
        if(area<Math.max(45,expected*.20)||area>expected*4)continue;
        const rect=cv.boundingRect(contour);
        if(rect.width<13||rect.height<13)continue;
        // Do not filter by portrait-only y position. A sideways (90/270°)
        // photograph moves the printed top/bottom ArUco IDs into the
        // middle image band. The ID decoder itself validates the pattern.
        if(Math.abs(rect.width/rect.height-1)>.7)continue;
        approx=new cv.Mat();
        cv.approxPolyDP(contour,approx,cv.arcLength(contour,true)*.045,true);
        if(approx.rows!==4||!cv.isContourConvex(approx))continue;
        const p:ImagePoint[]=[];
        const a=approx.data32S;
        for(let j=0;j<4;j++)p.push({x:a[j*2],y:a[j*2+1]});
        // The decoded ID is established from the original contour first.
        // Only then attempt bounded subpixel vertex optimisation; never
        // accept a different ID solely because corner refinement moved it.
        const initial=readCandidate(gray,p);
        if(!initial)continue;
        const refined=refineMarkerQuad(gray,p);
        const reconsidered=refined.method==='cornerSubPix-bounded'
          ?readCandidate(gray,refined.points):null;
        const result=reconsidered?.id===initial.id&&
          reconsidered.errors<=initial.errors?reconsidered:initial;
        if(!result)continue;
        candidates++;
        const id=result.id;
        const score=1-result.errors*.25;
        if(strengths[id]!==undefined&&strengths[id]>=score)continue;
        strengths[id]=score;
        corners[id]=result.corners;
        errors[id]=result.errors;
        refinement[id]=result===reconsidered?'subpixel-refined':refined.method;
        points[id]={
          x:p.reduce((s,v)=>s+v.x,0)/4,
          y:p.reduce((s,v)=>s+v.y,0)/4,
        };
      }finally{approx?.delete?.();contour.delete();}
    }
    const count=Object.keys(points).length;
    return {found:count===4,count,points,corners,errors,refinement,
      error:count===4?undefined:`Decoded ${count}/4 ArUco IDs; full four-marker rescue unavailable (${candidates} candidates)`};
  }catch(e){
    return missed('ArUco identification failed: '+String(e));
  }finally{contours.delete();hierarchy.delete();}
}


/**
 * Geometric midpoint predictions from the four independent ArUco IDs.
 * Bilinear interpolation/extrapolation is used ONLY to select a nearby
 * printed 4mm square; final registration still uses its measured centre
 * and must pass QR plus 50-row timing verification.
 */
export function predictMidpointsFromArucos(markers:ArucoRegistration):{
  top:ImagePoint;bottom:ImagePoint;left:ImagePoint;right:ImagePoint
}|null{
  if(!markers.found||[0,1,2,3].some(id=>!markers.points[id]))return null;
  const upper=(x:number):ImagePoint=>{
    const t=(x-83.5)/(151.5-83.5),a=markers.points[0],b=markers.points[1];
    return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
  };
  const lower=(x:number):ImagePoint=>{
    const t=(x-51.5)/(117.5-51.5),a=markers.points[2],b=markers.points[3];
    return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
  };
  const at=(x:number,y:number):ImagePoint=>{
    const a=upper(x),b=lower(x),t=(y-10)/(287-10);
    return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
  };
  return {top:at(105,8),bottom:at(105,289),
    left:at(8,148.5),right:at(202,148.5)};
}


/** Draw the actual detected ArUco IDs in the Reference Markers tab. */
export function generateArucoOverlay(
  src:HTMLCanvasElement,markers:ArucoRegistration,
  selectedMethod:string|null=null,timingMatched:number|null=null,
  selectedMidpoints?:{top:ImagePoint|null;right:ImagePoint|null;bottom:ImagePoint|null;left:ImagePoint|null},
):string{
  const canvas=document.createElement('canvas');
  canvas.width=src.width;canvas.height=src.height;
  const ctx=canvas.getContext('2d');
  if(!ctx)return '';
  ctx.drawImage(src,0,0);
  const radius=Math.max(11,Math.round(Math.min(src.width,src.height)*.022));
  ctx.lineWidth=3;
  ctx.font='bold 15px sans-serif';
  for(const id of [0,1,2,3]){
    const p=markers.points[id];
    if(!p)continue;
    ctx.strokeStyle='#2dd4bf';ctx.fillStyle='#0f766e';
    ctx.beginPath();ctx.arc(p.x,p.y,radius,0,Math.PI*2);ctx.stroke();
    ctx.fillText('ARUCO '+id,Math.min(src.width-95,p.x+radius+4),Math.max(18,p.y-10));
  }
  if(selectedMidpoints){
    ctx.strokeStyle='#f59e0b';ctx.fillStyle='#92400e';
    for(const key of ['top','right','bottom','left'] as const){
      const p=selectedMidpoints[key];if(!p)continue;
      ctx.beginPath();ctx.arc(p.x,p.y,Math.max(7,radius*.6),0,Math.PI*2);ctx.stroke();
      ctx.fillText(key.toUpperCase(),Math.min(src.width-70,p.x+13),p.y+18);
    }
  }
  ctx.fillStyle='#111827';
  ctx.fillRect(0,0,src.width,31);
  ctx.font='bold 14px sans-serif';ctx.fillStyle='#f9fafb';
  const status=selectedMethod??'Registration failed / not selected';
  const timing=timingMatched===null?'':(' | timing '+timingMatched+'/50');
  ctx.fillText('ArUco IDs '+markers.count+'/4 | '+status+timing,12,21,src.width-20);
  return canvas.toDataURL('image/png');
}
