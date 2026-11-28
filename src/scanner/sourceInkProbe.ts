/**
 * OMRLab 3.8.0 diagnostic comparison:
 * Query photometry in ORIGINAL camera image coordinates by projecting each
 * 1-mm template interior sample through inverse H. Does not warp the A4 page.
 *
 * Applies only when H maps original source canvas -> canonical page.
 * AI prewarps with chained transforms often have no such H; report skipped.
 * Never changes strict grading decisions until validated against ground truth.
 */
import {getBubbleCentre,mmToPx} from '../config/omrLayout';
type XY={dx:number;dy:number};
export type SourceInkProbe={
  supported:boolean;reason:string;
  sampled:number;valid:number;
  measurements:Array<{question:number;option:string;contrast:number;sampleCount:number;
    sourceX:number;sourceY:number}>;
};
const inverse=(a:ArrayLike<number>):number[]|null=>{
  if(a.length<9)return null;
  const [a0,b,c,d,e,f,g,h,i]=Array.from({length:9},(_,k)=>Number(a[k]));
  const A=e*i-f*h,B=f*g-d*i,C=d*h-e*g;
  const D=c*h-b*i,E=a0*i-c*g,F=b*g-a0*h;
  const G=b*f-c*e,H=c*d-a0*f,I=a0*e-b*d;
  const det=a0*A+b*B+c*C;
  if(!Number.isFinite(det)||Math.abs(det)<1e-8)return null;
  return [A,B,C,D,E,F,G,H,I].map(x=>x/det);
};
const map=(h:number[],x:number,y:number):{x:number;y:number}|null=>{
  const w=h[6]*x+h[7]*y+h[8];
  if(!Number.isFinite(w)||Math.abs(w)<1e-8)return null;
  const sx=(h[0]*x+h[1]*y+h[2])/w;
  const sy=(h[3]*x+h[4]*y+h[5])/w;
  return Number.isFinite(sx)&&Number.isFinite(sy)?{x:sx,y:sy}:null;
};
export function probeSourceInk(
  source:HTMLCanvasElement, transform:any,dpi:number,
  offsetFor:(question:number)=>XY
):SourceInkProbe {
  const missing=(reason:string):SourceInkProbe=>({supported:false,reason,
    sampled:0,valid:0,measurements:[]});
  if(!transform)return missing('no-source-to-template-homography');
  const values=transform.data64F?.length===9?transform.data64F:
    transform.data32F?.length===9?transform.data32F:null;
  if(!values)return missing('transform-matrix-not-available');
  const inv=inverse(values);if(!inv)return missing('singular-transform');
  const context=source.getContext('2d',{willReadFrequently:true});
  if(!context)return missing('original-canvas-pixels-unavailable');
  const data=context.getImageData(0,0,source.width,source.height).data;
  const luma=(x:number,y:number):number|null=>{
    if(x<0||y<0||x>=source.width-1||y>=source.height-1)return null;
    // 3.9: source-domain bilinear photometry avoids nearest-pixel aliasing
    // from a projective inverse map. Diagnostic-only, no grading changes.
    const x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0;
    const at=(xx:number,yy:number)=>{
      const k=(yy*source.width+xx)*4;
      return .299*data[k]+.587*data[k+1]+.114*data[k+2];
    };
    return (1-fy)*((1-fx)*at(x0,y0)+fx*at(x0+1,y0))+
      fy*((1-fx)*at(x0,y0+1)+fx*at(x0+1,y0+1));
  };
  const measurements:SourceInkProbe['measurements']=[];
  const scale=dpi/25.4;
  let sampled=0,valid=0;
  for(let q=1;q<=50;q++){
    const offset=offsetFor(q);
    for(let opt=0;opt<4;opt++){
      sampled++;
      const c=getBubbleCentre(q,opt as 0|1|2|3);
      const x=mmToPx(c.xMm,dpi)+offset.dx;
      const y=mmToPx(c.yMm,dpi)+offset.dy;
      const center=map(inv,x,y);if(!center)continue;
      let innerSum=0,innerN=0,paperSum=0,paperN=0;
      // Template coordinates are sampled individually from original pixels;
      // no global resampling or thresholding of a warped A4 bitmap.
      for(let dy=-2.3;dy<=2.3;dy+=.3)
        for(let dx=-2.3;dx<=2.3;dx+=.3){
          const radius=Math.hypot(dx,dy);
          if(radius>1.0 && (radius<2.0||radius>2.3))continue;
          const p=map(inv,x+dx*scale,y+dy*scale);
          if(!p)continue;
          const v=luma(p.x,p.y);if(v===null)continue;
          if(radius<=1.0){innerSum+=v;innerN++;}
          else {paperSum+=v;paperN++;}
        }
      if(innerN<12||paperN<12)continue;
      valid++;
      measurements.push({question:q,option:'ABCD'[opt],
        contrast:Math.round(100*(paperSum/paperN-innerSum/innerN))/100,
        sampleCount:innerN,sourceX:Math.round(center.x*10)/10,
        sourceY:Math.round(center.y*10)/10});
    }
  }
  return {supported:true,reason:'original-camera-domain-contrast-only-not-a-grade',
    sampled,valid,measurements};
}
