/** On-device diagnostic contact sheet of suspicious answer regions.
 * Captures the *registered image* (not the original photograph) so crops
 * and measured bubble locations can be inspected together.
 * Never runs inference or changes answer decisions.
 */
import type { QuestionResult } from '../types';
export function makeReviewCropSheet(
  warped:HTMLCanvasElement,answers:QuestionResult[],maxRows=12
):{dataUrl:string;questions:number[]}|null{
  const ranked=answers
    .map(row=>{
      const top=[...row.measurements].sort((a,b)=>b.fillPercent-a.fillPercent)[0];
      const suspicious=row.status==='uncertain'||row.status==='multiple'||
        Boolean(row.policyRejectedBlank)||
        (row.status==='blank'&&top?.fillPercent>=30);
      return {row,top,suspicious};
    })
    .filter(x=>x.suspicious&&x.top&&
      Number.isFinite(x.top.sampleXPx)&&Number.isFinite(x.top.sampleYPx))
    .sort((a,b)=>Number(b.suspicious)-Number(a.suspicious)||
      (b.top?.fillPercent??0)-(a.top?.fillPercent??0))
    .slice(0,Math.max(1,Math.min(20,maxRows)));
  if(!ranked.length)return null;
  const cellW=265,cellH=170,columns=2,rows=Math.ceil(ranked.length/columns);
  const sheet=document.createElement('canvas');
  sheet.width=cellW*columns;sheet.height=cellH*rows;
  const ctx=sheet.getContext('2d');if(!ctx)return null;
  ctx.fillStyle='#fff';ctx.fillRect(0,0,sheet.width,sheet.height);
  ctx.textBaseline='top';ctx.font='bold 14px sans-serif';
  const questions:number[]=[];
  ranked.forEach(({row,top},i)=>{
    if(!top)return;
    const x=(i%columns)*cellW,y=Math.floor(i/columns)*cellH;
    questions.push(row.question);
    ctx.fillStyle='#fff';ctx.fillRect(x,y,cellW,cellH);
    ctx.fillStyle='#111';ctx.fillText('Q'+String(row.question).padStart(2,'0')+
      ' '+row.status+' · '+top.option+' '+Math.round(top.fillPercent)+'%',x+9,y+7);
    const cx=top.sampleXPx!,cy=top.sampleYPx!;
    const left=Math.max(0,Math.min(warped.width-1,Math.round(cx)-48));
    const upper=Math.max(0,Math.min(warped.height-1,Math.round(cy)-42));
    const width=Math.max(1,Math.min(96,warped.width-left));
    const height=Math.max(1,Math.min(84,warped.height-upper));
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(warped,left,upper,width,height,x+34,y+30,196,110);
    ctx.strokeStyle='#d97706';ctx.lineWidth=1.5;
    ctx.strokeRect(x+34,y+30,196,110);
    ctx.fillStyle='#555';ctx.font='11px sans-serif';
    ctx.fillText('ROI '+Math.round(cx)+','+Math.round(cy)+
      ' · '+(top.rejectReason??'optical observation').slice(0,33),x+9,y+146);
    ctx.font='bold 14px sans-serif';
  });
  return {dataUrl:sheet.toDataURL('image/png'),questions};
}
