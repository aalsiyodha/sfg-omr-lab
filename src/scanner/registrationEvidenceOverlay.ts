import type { MarkerDetectionResult } from '../types';
import type { MidpointRegistration } from './midpointDetector';
import type { ArucoRegistration } from './arucoDetector';
import type { TimingBandProfile } from './timingDiagnostics';
import { OMR_LAYOUT, mmToPx } from '../config/omrLayout';

type Point={x:number;y:number};
export type RegistrationOverlayCandidate =
  | {name:string;kind:'corner';markers:MarkerDetectionResult}
  | {name:string;kind:'midpoint';markers:MidpointRegistration}
  | {name:string;kind:'aruco';markers:ArucoRegistration};

function ring(ctx:CanvasRenderingContext2D,p:Point,color:string,label:string){
  ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=3;
  ctx.beginPath();ctx.arc(p.x,p.y,9,0,Math.PI*2);ctx.stroke();
  ctx.fillStyle='#101827';ctx.fillRect(p.x+10,p.y-19,Math.max(54,label.length*7.2),20);
  ctx.fillStyle='#fff';ctx.font='bold 12px sans-serif';ctx.fillText(label,p.x+14,p.y-5);
}
/** All proposed anchor locations are unverified until independent QR/timing tests pass. */
export function drawRegistrationCandidateOverlay(
  source:HTMLCanvasElement,candidates:RegistrationOverlayCandidate[],
  aruco?:ArucoRegistration
):string{
  const canvas=document.createElement('canvas');
  canvas.width=source.width;canvas.height=source.height;
  const ctx=canvas.getContext('2d');
  if(!ctx)return '';
  ctx.drawImage(source,0,0);
  const colors={corner:'#ff9f1c',midpoint:'#00bcd4',aruco:'#a78bfa'};
  const familyCandidates=[
    candidates.find(c=>c.name==='corner/adaptive'),
    candidates.find(c=>c.name==='corner/Otsu'),
    candidates.find(c=>c.name==='midpoint/adaptive'),
    candidates.find(c=>c.name==='midpoint/aruco-guided'),
    candidates.find(c=>c.name==='midpoint/Otsu'),
    candidates.find(c=>c.name==='corner/aruco-guided')
  ].filter((c):c is RegistrationOverlayCandidate=>Boolean(c));
  for(const c of familyCandidates){
    let entries:[string,Point|null][]=[];
    if(c.kind==='corner')entries=[
      ['TL',c.markers.topLeft],['TR',c.markers.topRight],
      ['BL',c.markers.bottomLeft],['BR',c.markers.bottomRight]];
    if(c.kind==='midpoint')entries=[
      ['TOP',c.markers.top],['RIGHT',c.markers.right],
      ['BOTTOM',c.markers.bottom],['LEFT',c.markers.left]];
    const suffix=c.name.endsWith('Otsu')?' O':
      c.name.includes('guided')?' G':' A';
    for(const [name,p] of entries)if(p)ring(ctx,p,colors[c.kind],name+suffix);
  }
  if(aruco?.found)for(const [id,p] of Object.entries(aruco.points)){
    if(p)ring(ctx,p,colors.aruco,'ArUco '+id);
  }
  ctx.fillStyle='rgba(15,23,42,.9)';ctx.fillRect(0,0,canvas.width,34);
  ctx.fillStyle='#fff';ctx.font='bold 13px sans-serif';
  ctx.fillText('CANDIDATE MARKERS (UNVERIFIED)  orange:corners  cyan:midpoints  violet:ArUco',12,22);
  return canvas.toDataURL('image/png');
}
/** Draw the two expected timing columns on a rectified candidate, marking
 * matches in green and misses in red. Visual evidence, not a grading result.
 */
export function drawTimingFailureOverlay(
  rectified:HTMLCanvasElement,profile:TimingBandProfile,
  name:string,dpi:number,qrVerified:boolean
):string{
  const canvas=document.createElement('canvas');
  canvas.width=rectified.width;canvas.height=rectified.height;
  const ctx=canvas.getContext('2d');
  if(!ctx)return '';
  ctx.drawImage(rectified,0,0);
  const matched={left:new Set(profile.left),right:new Set(profile.right)};
  const rows=OMR_LAYOUT.answers.questionsPerCol;
  for(let i=0;i<rows;i++){
    const y=mmToPx(OMR_LAYOUT.answers.rowStartY+i*OMR_LAYOUT.answers.rowSpacingY,dpi);
    for(const [side,xMm] of [['left',13.3],['right',196.7]] as const){
      const x=mmToPx(xMm,dpi);
      const hit=matched[side].has(i+1);
      ctx.strokeStyle=hit?'#16a34a':'#ef4444';ctx.lineWidth=2;
      ctx.beginPath();ctx.arc(x,y,7,0,2*Math.PI);ctx.stroke();
      if(!hit){ctx.beginPath();ctx.moveTo(x-4,y-4);ctx.lineTo(x+4,y+4);
        ctx.moveTo(x-4,y+4);ctx.lineTo(x+4,y-4);ctx.stroke();}
    }
  }
  ctx.fillStyle='rgba(15,23,42,.94)';ctx.fillRect(0,0,canvas.width,67);
  ctx.fillStyle='#fff';ctx.font='bold 14px sans-serif';
  ctx.fillText(name+' | QR '+(qrVerified?'verified':'unverified')+
    ' | timing '+profile.matches+'/50',14,23);
  ctx.font='12px sans-serif';
  ctx.fillText('Green: timing sampled dark | Red: expected mark missed | NOT ACCEPTED',14,46);
  return canvas.toDataURL('image/png');
}
