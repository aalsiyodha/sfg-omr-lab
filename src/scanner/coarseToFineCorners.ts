/** Two-resolution corner registration for photographed A4 sheets.
 * Discover on a small binary image, then refine each marker centre inside a
 * short, full-resolution ROI. Never classify bubbles on the downsampled image.
 * Every proposed geometry still needs the normal QR + timing verification.
 */
import type {MarkerDetectionResult} from '../types';
import {detectMarkers} from './markerDetector';
declare const cv:any;
type Point={x:number;y:number};
export interface CoarseGeometryResult{
 markers:MarkerDetectionResult;
 stats:{used:boolean;coarseWidth:number;coarseHeight:number;discoveryMs:number;
   refinementMs:number;refined:number;reason:string};
}
export function detectCoarseToFineCorners(binary:any,width:number,height:number,targetWidth=720):CoarseGeometryResult{
 const started=performance.now();
 const fallback:MarkerDetectionResult={found:false,count:0,validGeometry:false,
   error:'Coarse-to-fine corner discovery could not verify four independent printed corners'};
 const stats={used:false,coarseWidth:width,coarseHeight:height,
   discoveryMs:0,refinementMs:0,refined:0,reason:''};
 if(width<=targetWidth*1.08||height<350){
   stats.reason='Already small; prefer original full-resolution marker finder';
   return {markers:fallback,stats};
 }
 const scale=targetWidth/width;
 const small=new cv.Mat(),clean=new cv.Mat();
 try{
   const cw=Math.round(width*scale),ch=Math.round(height*scale);
   stats.coarseWidth=cw;stats.coarseHeight=ch;
   cv.resize(binary,small,new cv.Size(cw,ch),0,0,cv.INTER_AREA);
   cv.threshold(small,clean,127,255,cv.THRESH_BINARY);
   const proposed=detectMarkers(clean,cw,ch);
   stats.discoveryMs=Math.round(performance.now()-started);
   if(!proposed.found||!proposed.topLeft||!proposed.topRight||
      !proposed.bottomLeft||!proposed.bottomRight){
     stats.reason='Four coarse geometric candidates not found';
     return {markers:fallback,stats};
   }
   const t=performance.now();
   const sizePx=Math.sqrt(width*height*49/(210*297));
   const radius=Math.max(12,Math.round(sizePx*1.65));
   const refine=(p:Point):Point|null=>{
     const x0=p.x/scale,y0=p.y/scale;
     const left=Math.max(0,Math.floor(x0-radius)),top=Math.max(0,Math.floor(y0-radius));
     const w=Math.min(width-left,2*radius+1),h=Math.min(height-top,2*radius+1);
     if(w<8||h<8)return null;
     let roi:any=null,contours:any=null,hierarchy:any=null;
     try{
       roi=binary.roi(new cv.Rect(left,top,w,h));
       contours=new cv.MatVector();hierarchy=new cv.Mat();
       cv.findContours(roi,contours,hierarchy,cv.RETR_LIST,cv.CHAIN_APPROX_SIMPLE);
       let best:Point|null=null,bestCost=Infinity;
       for(let i=0;i<contours.size();i++){
         const c=contours.get(i);
         try{
           const a=cv.contourArea(c),rect=cv.boundingRect(c);
           const projected=sizePx*sizePx;
           if(a<projected*.12||a>projected*6)continue;
           if(Math.abs(rect.width/Math.max(rect.height,1)-1)>.48)continue;
           if(a/(rect.width*rect.height)<.5)continue;
           const cx=left+rect.x+rect.width/2,cy=top+rect.y+rect.height/2;
           const distance=Math.hypot(cx-x0,cy-y0);
           const cost=distance/Math.max(sizePx,1)+.4*Math.abs(Math.log(Math.max(a,1)/projected));
           if(cost<bestCost){bestCost=cost;best={x:cx,y:cy};}
         }finally{c.delete();}
       }
       return best;
     }finally{roi?.delete?.();contours?.delete?.();hierarchy?.delete?.();}
   };
   const tl=refine(proposed.topLeft),tr=refine(proposed.topRight);
   const bl=refine(proposed.bottomLeft),br=refine(proposed.bottomRight);
   stats.refinementMs=Math.round(performance.now()-t);
   stats.refined=[tl,tr,bl,br].filter(Boolean).length;
   if(!tl||!tr||!bl||!br){
     stats.reason='Refinement did not find all four full-resolution markers';
     return {markers:fallback,stats};
   }
   stats.used=true;stats.reason='Four coarse candidates independently refined in local full-resolution ROIs';
   return {markers:{found:true,count:4,validGeometry:true,topLeft:tl,
     topRight:tr,bottomLeft:bl,bottomRight:br},stats};
 }finally{small.delete();clean.delete();}
}
