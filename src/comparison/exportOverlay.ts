/**
 * Export exactly the image-space geometry displayed by ComparePage.
 * All drawing is performed in the browser on the user's original photograph.
 * No image pixels or reference annotations are transmitted to a server.
 */
import {cornersNormalized} from './engines';
import type {EngineResult,Point} from './engines';

export interface OverlayExportOptions {
  file:File;
  hash:string;
  results:EngineResult[];
  reference:Point[];
  referenceConfirmed:boolean;
  showModels:boolean;
  colors:string[];
  version:string;
}
const LABELS=['TL','TR','BR','BL'];

function drawVertex(ctx:CanvasRenderingContext2D,p:Point,color:string,radius:number,label:string){
  ctx.beginPath();
  ctx.arc(p.x,p.y,radius,0,Math.PI*2);
  ctx.fillStyle=color;ctx.fill();
  ctx.lineWidth=Math.max(2,radius*.3);ctx.strokeStyle='#111827';ctx.stroke();
  ctx.font='bold '+Math.round(radius*1.6)+'px system-ui, sans-serif';
  ctx.lineWidth=Math.max(2,radius*.35);
  ctx.strokeStyle='#111827';
  ctx.strokeText(label,p.x+radius*1.35,p.y-radius*1.35);
  ctx.fillStyle='#ffffff';
  ctx.fillText(label,p.x+radius*1.35,p.y-radius*1.35);
}
function drawQuad(ctx:CanvasRenderingContext2D,corners:Point[],color:string,
  lineWidth:number,radius:number,dashed=false){
  if(corners.length!==4)return;
  ctx.save();
  ctx.strokeStyle=color;
  ctx.lineWidth=lineWidth;
  ctx.lineJoin='round';
  ctx.setLineDash(dashed?[lineWidth*3,lineWidth*2]:[]);
  ctx.beginPath();
  corners.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  corners.forEach((p,i)=>drawVertex(ctx,p,color,radius,LABELS[i]));
  ctx.restore();
}
function canvasPng(canvas:HTMLCanvasElement):Promise<Blob>{
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>
    blob?resolve(blob):reject(new Error('Could not encode PNG overlay.')), 'image/png'));
}
async function decodeFile(file:File):Promise<ImageBitmap|HTMLImageElement>{
  if(typeof createImageBitmap==='function')return createImageBitmap(file);
  const url=URL.createObjectURL(file);
  try{
    return await new Promise<HTMLImageElement>((resolve,reject)=>{
      const img=new Image();
      img.onload=()=>resolve(img);
      img.onerror=()=>reject(new Error('Could not decode original photograph.'));
      img.src=url;
    });
  }finally{URL.revokeObjectURL(url);}
}
export async function exportCornerOverlay(options:OverlayExportOptions):Promise<void>{
  const {file,results,reference,referenceConfirmed,showModels,colors,hash,version}=options;
  const image=await decodeFile(file);
  try{
    const width=image.width,height=image.height;
    if(width<1||height<1)throw new Error('Invalid photograph dimensions.');
    const scale=Math.max(1,width/1100);
    const font=Math.max(15,Math.round(18*scale));
    const lineHeight=Math.round(font*1.9);
    const models=showModels?results.filter(r=>r.kind!=='bubble'&&cornersNormalized(r)!==null):[];
    const legendLines=models.length+(reference.length?1:0)+2;
    const footerHeight=Math.max(Math.round(90*scale),lineHeight*(legendLines+2));
    const canvas=document.createElement('canvas');
    canvas.width=width;canvas.height=height+footerHeight;
    const ctx=canvas.getContext('2d');
    if(!ctx)throw new Error('Canvas rendering unavailable.');
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(image,0,0,width,height);
    const stroke=Math.max(2,width/260),radius=Math.max(4,width/190);
    for(const r of models){
      const index=results.filter(x=>x.kind!=='bubble'&&cornersNormalized(x)!==null)
        .findIndex(x=>x.id===r.id);
      const points=cornersNormalized(r)!.map(p=>({x:p.x*width,y:p.y*height}));
      drawQuad(ctx,points,colors[index%colors.length]||'#10b981',stroke,radius);
    }
    if(reference.length===4){
      drawQuad(ctx,reference,'#facc15',stroke*1.3,radius*1.25,true);
    }else{
      reference.forEach((p,i)=>drawVertex(ctx,p,'#facc15',radius*1.25,LABELS[i]));
    }
    // Footer is outside the photograph, keeping all document pixels visible.
    ctx.fillStyle='#111827';ctx.fillRect(0,height,width,footerHeight);
    ctx.textBaseline='middle';
    ctx.font='bold '+Math.round(font*1.12)+'px system-ui, sans-serif';
    ctx.fillStyle='#ffffff';
    let y=height+lineHeight;
    ctx.fillText('SFG OMR LAB '+version+' | Corner overlay',Math.round(18*scale),y);
    ctx.font=font+'px system-ui, sans-serif';
    y+=lineHeight;
    for(const r of models){
      const index=results.filter(x=>x.kind!=='bubble'&&cornersNormalized(x)!==null)
        .findIndex(x=>x.id===r.id);
      const color=colors[index%colors.length]||'#10b981';
      ctx.fillStyle=color;ctx.fillRect(Math.round(18*scale),y-font*.4,
        Math.round(font*.8),Math.round(font*.8));
      ctx.fillStyle='#ffffff';
      ctx.fillText(r.name+' ('+r.outcome+')',Math.round(40*scale),y);
      y+=lineHeight;
    }
    if(reference.length){
      ctx.fillStyle='#facc15';
      ctx.fillRect(Math.round(18*scale),y-font*.4,Math.round(font*.8),Math.round(font*.8));
      ctx.fillStyle='#ffffff';
      ctx.fillText('Manual reference: '+(referenceConfirmed&&reference.length===4?
        'confirmed':'not confirmed ('+reference.length+'/4 points)'),Math.round(40*scale),y);
      y+=lineHeight;
    }
    ctx.fillStyle='#d1d5db';
    ctx.font=Math.round(font*.8)+'px monospace';
    ctx.fillText('SHA256: '+(hash||'pending'),Math.round(18*scale),y);
    y+=lineHeight;
    ctx.fillText('Predictions are not ground truth. Unverified scans cannot be graded.',
      Math.round(18*scale),y);
    const png=await canvasPng(canvas);
    const url=URL.createObjectURL(png);
    try{
      const anchor=document.createElement('a');
      anchor.href=url;
      const base=file.name.replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9_-]+/g,'_').slice(0,70);
      anchor.download=(base||'omr')+'-corner-overlay-'+version+'.png';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }finally{
      window.setTimeout(()=>URL.revokeObjectURL(url),15000);
    }
  }finally{
    if('close' in image&&typeof image.close==='function')image.close();
  }
}
