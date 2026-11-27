/**
 * 3.8.0 geometry-only, correspondence-free *local* template alignment.
 *
 * Works on a ROUGHLY RECTIFIED A4 canvas. Printed answer circles are present
 * even when blank; student answers are never the objective. Fit every other
 * question's printed annulus, verify on withheld questions. The bounded
 * affine correction is only a proposal; final QR + bilateral timing still gate.
 * This is NOT full ECC, dense elastic matching, or QR-less identity recovery.
 */
import {getBubbleCentre,mmToPx,OMR_LAYOUT} from '../config/omrLayout';
declare const cv:any;
type Pose={dx:number;dy:number;sx:number;sy:number};
export type TemplateRefinement={canvas:HTMLCanvasElement|null;
  evidence:{supported:boolean;reason:string;fitBaseline:number;fitBest:number;
    heldoutBaseline:number;heldoutBest:number;
    strongHeldout:number;dx:number;dy:number;sx:number;sy:number;
    candidates:number;elapsedMs:number}};
const r=(x:number)=>Math.round(x*100)/100;
export function refineGeometryOnlyRings(source:HTMLCanvasElement,dpi:number):TemplateRefinement{
  const start=Date.now();
  const empty=(reason:string):TemplateRefinement=>({canvas:null,evidence:{
    supported:false,reason,fitBaseline:0,fitBest:0,heldoutBaseline:0,
    heldoutBest:0,strongHeldout:0,dx:0,dy:0,sx:1,sy:1,candidates:0,elapsedMs:Date.now()-start}});
  let rgba:any=null,gray:any=null,affine:any=null,warped:any=null;
  try{
    rgba=cv.imread(source);gray=new cv.Mat();
    cv.cvtColor(rgba,gray,cv.COLOR_RGBA2GRAY);
    const pixels:Uint8Array=gray.data;
    if(!(pixels instanceof Uint8Array)||pixels.length<gray.cols*gray.rows)
      return empty('contiguous-grayscale-required');
    const width=gray.cols,height=gray.rows;
    const sample=(x:number,y:number)=>{
      const ix=Math.round(x),iy=Math.round(y);
      return ix>=0&&iy>=0&&ix<width&&iy<height?pixels[iy*width+ix]:null;
    };
    const cx=width/2,cy=height/2;
    const radius=mmToPx(OMR_LAYOUT.answers.bubbleDiamMm/2,dpi);
    const anchors=Array.from({length:50},(_,i)=>{
      const question=i+1;
      const option=(i*3)%4 as 0|1|2|3;
      const pos=getBubbleCentre(question,option);
      return {x:mmToPx(pos.xMm,dpi),y:mmToPx(pos.yMm,dpi),question};
    });
    const contrast=(x:number,y:number)=>{
      const core=sample(x,y);
      if(core===null)return 0;
      let sum=0,n=0;
      for(let k=0;k<16;k++){
        const angle=2*Math.PI*k/16;
        const v=sample(x+radius*Math.cos(angle),y+radius*Math.sin(angle));
        if(v!==null){sum+=v;n++;}
      }
      return n>=12?Math.max(0,core-sum/n):0;
    };
    const score=(pose:Pose,withheld:boolean)=>{
      const values:number[]=[];
      for(const a of anchors){
        if((a.question%2===1)!==withheld)continue;
        const x=cx+(a.x-cx)*pose.sx+pose.dx;
        const y=cy+(a.y-cy)*pose.sy+pose.dy;
        values.push(contrast(x,y));
      }
      // Trim the darkest 30% to avoid the one student-filled ring in each row.
      values.sort((a,b)=>a-b);
      const good=values.slice(Math.floor(values.length*.30));
      return good.reduce((sum,v)=>sum+v,0)/Math.max(1,good.length);
    };
    const baseline={dx:0,dy:0,sx:1,sy:1};
    const fitBaseline=score(baseline,false);
    const heldoutBaseline=score(baseline,true);
    let best={...baseline,fit:fitBaseline};
    let candidates=0;
    // No lattice-pitch aliases: bound x/y displacement to < half a row pitch.
    for(const sy of [.94,1,1.06])
      for(const sx of [.94,1,1.06])
        for(const dy of [-18,-9,0,9,18])
          for(const dx of [-18,-9,0,9,18]){
            candidates++;
            const fit=score({dx,dy,sx,sy},false)-.005*Math.hypot(dx,dy);
            if(fit>best.fit)best={dx,dy,sx,sy,fit};
          }
    const coarse={...best};
    for(const sy of [coarse.sy-.015,coarse.sy,coarse.sy+.015])
      for(const sx of [coarse.sx-.015,coarse.sx,coarse.sx+.015])
        for(const dy of [coarse.dy-4,coarse.dy,coarse.dy+4])
          for(const dx of [coarse.dx-4,coarse.dx,coarse.dx+4]){
            candidates++;
            const fit=score({dx,dy,sx,sy},false)-.005*Math.hypot(dx,dy);
            if(fit>best.fit)best={dx,dy,sx,sy,fit};
          }
    const heldoutBest=score(best,true);
    let strongHeldout=0;
    for(const a of anchors.filter(a=>a.question%2===1)){
      const x=cx+(a.x-cx)*best.sx+best.dx;
      const y=cy+(a.y-cy)*best.sy+best.dy;
      if(contrast(x,y)>10)strongHeldout++;
    }
    const evidence={supported:false,reason:'not-proven',fitBaseline:r(fitBaseline),
      fitBest:r(best.fit),heldoutBaseline:r(heldoutBaseline),
      heldoutBest:r(heldoutBest),strongHeldout,
      dx:best.dx,dy:best.dy,sx:r(best.sx),sy:r(best.sy),
      candidates,elapsedMs:Date.now()-start};
    const improved=best.fit>fitBaseline+3&&heldoutBest>heldoutBaseline+3&&
      strongHeldout>=10&&heldoutBest>=8;
    if(!improved)return {canvas:null,evidence:{...evidence,
      reason:'independent-printed-rings-did-not-support-correction'}};
    affine=cv.matFromArray(2,3,cv.CV_64FC1,[
      1/best.sx,0,(cx*(best.sx-1)-best.dx)/best.sx,
      0,1/best.sy,(cy*(best.sy-1)-best.dy)/best.sy
    ]);
    warped=new cv.Mat();
    cv.warpAffine(rgba,warped,affine,new cv.Size(width,height),
      cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar(255,255,255,255));
    const canvas=document.createElement('canvas');
    canvas.width=width;canvas.height=height;
    cv.imshow(canvas,warped);
    return {canvas,evidence:{...evidence,supported:true,
      reason:'fit-and-independent-heldout-rings-support-affine-proposal',
      elapsedMs:Date.now()-start}};
  }catch(error){return empty('template-refinement-error:'+String(error));}
  finally{for(const m of [warped,affine,gray,rgba])try{m?.delete?.();}catch{}}
}
