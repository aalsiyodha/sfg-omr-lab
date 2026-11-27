/**
 * 3.7.12 candidate-only classical vertex laboratory.
 *
 * Harris: OpenCV cornerHarris response within a SMALL region around a
 * pre-existing, independently proposed paper corner. Never search globally
 * for the four strongest Harris pixels: patterned backgrounds dominate.
 *
 * TCVD-inspired: measure discrete changes in tangent direction along an
 * edge contour. This is a practical contour-curvature approximation, NOT the
 * original parametric cubic TCVD paper implementation.
 *
 * Both generate geometry proposals ONLY. No QR, timing or mark policy changes.
 */
export type Vertex={x:number;y:number};
export type VertexProposal={method:'harris-refined'|'contour-tangent';corners:Vertex[];score:number};
declare const cv:any;
const length=(a:Vertex,b:Vertex)=>Math.hypot(a.x-b.x,a.y-b.y);
const clockwise=(vertices:Vertex[]):Vertex[]=>{
  const center={x:vertices.reduce((a,p)=>a+p.x,0)/4,
    y:vertices.reduce((a,p)=>a+p.y,0)/4};
  const ordered=[...vertices].sort((a,b)=>Math.atan2(a.y-center.y,a.x-center.x)-
    Math.atan2(b.y-center.y,b.x-center.x));
  const k=ordered.reduce((best,p,i)=>p.x+p.y<ordered[best].x+ordered[best].y?i:best,0);
  return [...ordered.slice(k),...ordered.slice(0,k)];
};
export function tangentDeflection(points:Vertex[],window=4):number[]{
  const n=points.length;
  if(n<window*2+4)return [];
  return points.map((_,i)=>{
    const before=points[(i-window+n)%n],at=points[i],after=points[(i+window)%n];
    const a=Math.atan2(at.y-before.y,at.x-before.x);
    const b=Math.atan2(after.y-at.y,after.x-at.x);
    return Math.abs(Math.atan2(Math.sin(b-a),Math.cos(b-a)));
  });
}
export function proposeVertexQuads(
  gray:any,
  contours:Array<Vertex[]>,
  existing:Vertex[][],
  options?:{maxCandidates?:number}
):{proposals:VertexProposal[];stats:{harris:number;tangent:number;errors:string[]}}{
  const proposed:VertexProposal[]=[];
  const errors:string[]=[];
  // Bounded Harris displacement to prevent a patterned floor from becoming
  // a high-scoring false paper boundary.
  if(typeof cv?.cornerHarris==='function'){
    let float:any=null,response:any=null;
    try{
      float=new cv.Mat();gray.convertTo(float,cv.CV_32F);
      response=new cv.Mat();
      cv.cornerHarris(float,response,2,3,.04);
      const values=response.data32F as Float32Array;
      const rows=response.rows,cols=response.cols;
      for(const quad of existing.slice(0,6)){
        if(quad.length!==4)continue;
        const refined=quad.map(p=>{
          const x0=Math.round(p.x),y0=Math.round(p.y);
          const radius=Math.max(5,Math.round(Math.min(rows,cols)*.015));
          let best=-Infinity,found=p;
          for(let dy=-radius;dy<=radius;dy+=2)for(let dx=-radius;dx<=radius;dx+=2){
            const x=x0+dx,y=y0+dy;
            if(x<3||y<3||x>=cols-3||y>=rows-3)continue;
            const strength=values[y*cols+x];
            if(Number.isFinite(strength)&&strength>best){
              best=strength;found={x,y};
            }
          }
          return found;
        });
        if(refined.every((p,i)=>length(p,quad[i])<Math.min(rows,cols)*.03))
          proposed.push({method:'harris-refined',corners:refined,score:
            refined.reduce((sum,p,i)=>sum+length(p,quad[i]),0)});
      }
    }catch(e){errors.push('harris:'+String(e));}
    finally{try{response?.delete();}catch{}try{float?.delete();}catch{}}
  }else errors.push('cornerHarris not available in this OpenCV build');
  // Tangent-deflection peaks on contour chains propose quadrilaterals.
  // Not a full reproduction of the TCVD sketch-segmentation algorithm.
  for(const contour of contours.slice(0,20)){
    const deflection=tangentDeflection(contour,Math.max(2,Math.floor(contour.length/65)));
    if(!deflection.length)continue;
    const order=deflection.map((score,i)=>({score,i}))
      .sort((a,b)=>b.score-a.score);
    const ids:number[]=[];
    const separation=Math.max(5,Math.floor(contour.length/9));
    for(const {i,score} of order){
      if(score<.32)break;
      if(ids.every(previous=>Math.min(Math.abs(previous-i),
        contour.length-Math.abs(previous-i))>=separation))ids.push(i);
      if(ids.length===4)break;
    }
    if(ids.length!==4)continue;
    const corners=clockwise(ids.map(i=>contour[i]));
    const edges=corners.map((p,i)=>length(p,corners[(i+1)%4]));
    if(Math.min(...edges)<Math.min(gray.cols,gray.rows)*.06)continue;
    proposed.push({method:'contour-tangent',corners,
      score:1/(deflection.filter(s=>s>.32).length+1)});
  }
  const filtered=proposed.filter(v=>v.corners.every(p=>
    Number.isFinite(p.x)&&Number.isFinite(p.y)&&
    p.x>=0&&p.y>=0&&p.x<gray.cols&&p.y<gray.rows));
  return {proposals:filtered.slice(0,options?.maxCandidates??10),
    stats:{harris:filtered.filter(p=>p.method==='harris-refined').length,
      tangent:filtered.filter(p=>p.method==='contour-tangent').length,errors}};
}
