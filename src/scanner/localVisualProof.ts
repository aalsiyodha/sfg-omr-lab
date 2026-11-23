/**
 * v2.5.1 low-cost local optical counterfactual. No second warp/model.
 * The blank printed ring is treated as a nuisance outside the 1mm
 * answer-ink core. We only count ink INSIDE this core, not the ring.
 * Changing the ROI by 1 pixel and the grayscale threshold by +/-8
 * tests sensitivity to local geometry, exposure, and JPEG artifacts.
 * This is not a calibrated correctness score or true image subtraction.
 */
export type LocalVisualProof = {
  available:boolean; samples:number; minFill:number;maxFill:number;
  centerFill:number;spread:number;stable:boolean;
  coreVsRingContrast:number; reason:string;
};
type Gray = {rows:number;cols:number;data?:Uint8Array|Uint8ClampedArray;
  ucharPtr(y:number,x:number):ArrayLike<number>};
const empty=(reason:string):LocalVisualProof=>({
  available:false,samples:0,minFill:0,maxFill:0,centerFill:0,
  spread:0,stable:false,coreVsRingContrast:0,reason
});
export function inspectLocalBubble(
  gray:Gray,cx:number,cy:number,dpi:number,threshold:number
):LocalVisualProof {
  if(!Number.isFinite(cx)||!Number.isFinite(cy)||
     !Number.isFinite(dpi)||dpi<40||!Number.isFinite(threshold))
    return empty('Invalid ROI or threshold');
  const radius=Math.max(2,Math.round(dpi/25.4*0.82));
  const outer=radius+Math.max(3,Math.round(dpi/25.4*0.65));
  const x=Math.round(cx),y=Math.round(cy);
  if(x-outer-2<0||y-outer-2<0||x+outer+2>=gray.cols||
    y+outer+2>=gray.rows)return empty('Crop outside verified page');
  const raw=gray.data,bytes=raw&&raw.length>=gray.rows*gray.cols?raw:null;
  const pixel=(px:number,py:number)=>bytes?bytes[py*gray.cols+px]:gray.ucharPtr(py,px)[0];
  let ringTotal=0,ringN=0,coreTotal=0,coreN=0;
  for(let dy=-outer;dy<=outer;dy++)for(let dx=-outer;dx<=outer;dx++){
    const d2=dx*dx+dy*dy;
    if(d2<=radius*radius){coreTotal+=pixel(x+dx,y+dy);coreN++;}
    else if(d2>=(outer-1)**2&&d2<=outer*outer){
      ringTotal+=pixel(x+dx,y+dy);ringN++;
    }
  }
  const coreVsRingContrast=coreN&&ringN?ringTotal/ringN-coreTotal/coreN:0;
  const fills:number[]=[];
  // For every candidate, the same small interior mask must remain dark.
  // These tests are evidence of stability, not shape validity.
  for(const [ox,oy] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]){
    for(const delta of [-8,0,8]){
      let dark=0,n=0;
      for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
        if(dx*dx+dy*dy>radius*radius)continue;
        if(pixel(x+ox+dx,y+oy+dy)<threshold+delta)dark++;
        n++;
      }
      fills.push(n?100*dark/n:0);
    }
  }
  const minFill=Math.min(...fills),maxFill=Math.max(...fills),spread=maxFill-minFill;
  const centerFill=fills[1];
  // Stability is a conservative property, not proof of a valid solid bubble.
  const stable=spread<=22;
  return {available:true,samples:fills.length,minFill,maxFill,centerFill,
    spread,stable,coreVsRingContrast,
    reason:stable?'Counterfactual core coverage stable':
      'Ink classification sensitive to threshold or 1px offset'};
}
