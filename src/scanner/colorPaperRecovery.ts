/** Exp 3.7.6: a classical (no neural model) page-appearance hypothesis.
 * Background fabrics can be bright but strongly coloured; white copy paper
 * tends to have low HSV saturation. This is strictly a page-quad PROPOSAL.
 * Caller rechecks exact QR identity and both independent timing tracks.
 */
import type { PagePoint } from './pageBoundaryRecovery';
declare const cv:any;

export type ColorPaperCandidate={corners:PagePoint[];method:string;areaRatio:number;};
export function detectLowSaturationPaper(
  source:HTMLCanvasElement,maxCandidates=5
):ColorPaperCandidate[]{
  let rgba:any=null,rgb:any=null,hsv:any=null,mask:any=null,closed:any=null;
  let opened:any=null,kClose:any=null,kOpen:any=null,contours:any=null,hierarchy:any=null;
  const results:ColorPaperCandidate[]=[];
  const seen=new Set<string>();
  try{
    rgba=cv.imread(source);
    rgb=new cv.Mat();
    hsv=new cv.Mat();
    cv.cvtColor(rgba,rgb,cv.COLOR_RGBA2RGB);
    cv.cvtColor(rgb,hsv,cv.COLOR_RGB2HSV);
    const size=new cv.Size(23,23);
    kClose=cv.getStructuringElement(cv.MORPH_RECT,size);
    kOpen=cv.getStructuringElement(cv.MORPH_RECT,new cv.Size(13,13));
    const areaTotal=source.width*source.height;
    for(const maxSat of [25,35,45]){
      mask=new cv.Mat();
      closed=new cv.Mat();
      opened=new cv.Mat();
      cv.inRange(hsv,new cv.Mat(hsv.rows,hsv.cols,hsv.type(),new cv.Scalar(0,0,120)),
        new cv.Mat(hsv.rows,hsv.cols,hsv.type(),new cv.Scalar(179,maxSat,255)),mask);
      cv.morphologyEx(mask,closed,cv.MORPH_CLOSE,kClose);
      cv.morphologyEx(closed,opened,cv.MORPH_OPEN,kOpen);
      contours=new cv.MatVector();hierarchy=new cv.Mat();
      cv.findContours(opened,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
      for(let i=0;i<contours.size();i++){
        const c=contours.get(i);
        let hull:any=null,poly:any=null;
        try{
          const area=cv.contourArea(c)/areaTotal;
          if(area<.14||area>.86)continue;
          hull=new cv.Mat();cv.convexHull(c,hull);
          const perimeter=cv.arcLength(hull,true);
          poly=new cv.Mat();
          cv.approxPolyDP(hull,poly,.025*perimeter,true);
          if(poly.rows!==4)continue;
          const data=poly.data32S;
          const pts:Array<PagePoint>=Array.from({length:4},(_,j)=>({
            x:data[2*j],y:data[2*j+1]
          }));
          const margin=8;
          const imageCorners=pts.filter(p=>
            (p.x<margin||p.x>source.width-margin)&&
            (p.y<margin||p.y>source.height-margin)).length;
          if(imageCorners>=2)continue;
          const sorted=[...pts].sort((a,b)=>a.y-b.y||a.x-b.x);
          const key=sorted.map(p=>Math.round(p.x/22)+':'+Math.round(p.y/22)).join('|');
          if(seen.has(key))continue;
          seen.add(key);
          results.push({corners:pts,method:'low-saturation-'+maxSat,
            areaRatio:Number(area.toFixed(4))});
        }finally{for(const m of [c,hull,poly])try{m?.delete?.()}catch{/*clean*/}}
      }
      for(const m of [mask,closed,opened,contours,hierarchy])try{m?.delete?.()}catch{/*clean*/}
      mask=closed=opened=contours=hierarchy=null;
    }
    // Never treat area or paper whiteness as identity. These are only
    // conservative proposals; full optical verification is mandatory.
    return results.sort((a,b)=>a.areaRatio-b.areaRatio).slice(0,maxCandidates);
  }catch{return [];}
  finally{
    for(const m of [rgba,rgb,hsv,mask,closed,opened,kClose,kOpen,contours,hierarchy])
      try{m?.delete?.()}catch{/*clean*/}
  }
}
