import { jsPDF } from 'jspdf';
import { OMR_LAYOUT, getBubbleCentre, getTestIdBubbleCentre } from '../config/omrLayout';
import { SHEET_FOOTER, footerBits, type SheetQuestionCount } from './sheetIdProtocol';

/** Exact-format A4 50-question Sheet ID proof. Other future IDs are encoded
 * in the protocol but do not yet have a corresponding verified print layout.
 */
export function downloadSheetIdPrototype(count:SheetQuestionCount=50){
 if(count!==50)throw new Error('Only the 50-question geometry is calibrated in this prototype.');
 const pdf=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
 pdf.setDrawColor(0);pdf.setTextColor(0);pdf.setLineWidth(.22);
 const square=(x:number,y:number,w:number,h:number,filled=false)=>{
  pdf.rect(x,y,w,h,filled?'F':'S');
 };
 const bubble=(x:number,y:number,r:number,filled=false)=>{
  pdf.circle(x,y,r,filled?'F':'S');
 };
 const {markers,answers,testId}=OMR_LAYOUT;
 Object.values(markers).forEach(m=>square(m.xMm,m.yMm,m.sizeMm,m.sizeMm,true));
 pdf.setFont('helvetica','bold');pdf.setFontSize(15);
 pdf.text('SFG OMR LAB',105,24,{align:'center'});
 pdf.setFont('helvetica','normal');pdf.setFontSize(8);
 pdf.text('SHEET ID PROTOTYPE  /  50 QUESTIONS  /  4 OPTIONS',105,31,{align:'center'});
 pdf.text('Candidate Name: ______________________________________________',16,40);
 pdf.text('Roll No.: ___________________________________________________',16,46);
 pdf.text('Shade one complete circle with a blue/black pen. Do not tick, cross or half-fill.',16,52);
 pdf.setFontSize(8);pdf.setFont('helvetica','bold');
 pdf.text('TEST ID   (mark one tens digit and one units digit)',16,56);
 for(const type of ['tens','units'] as const){
  const item=testId[type];
  pdf.setFontSize(7);
  pdf.text(type==='tens'?'TENS':'UNITS',item.labelX,item.yMm+1.5);
  for(const d of item.digits){
   const c=getTestIdBubbleCentre(type,d);
   bubble(c.xMm,c.yMm,testId.bubbleDiamMm/2);
   pdf.text(String(d),c.xMm+2.8,c.yMm+1);
  }
 }
 pdf.setFontSize(8);pdf.text('ANSWER GRID',16,75);
 for(let question=1;question<=50;question++){
  const col=question<=25?answers.col1:answers.col2;
  const y=answers.rowStartY+((question-1)%25)*answers.rowSpacingY;
  pdf.setFont('helvetica','normal');pdf.setFontSize(8);
  pdf.text(String(question).padStart(2,'0')+'.',col.qNumX,y+1);
  for(let option=0;option<4;option++){
   const p=getBubbleCentre(question,option as 0|1|2|3);
   bubble(p.xMm,p.yMm,answers.bubbleDiamMm/2);
   pdf.setFontSize(6.7);
   pdf.text('ABCD'[option],p.xMm+col.labelOffsetMm,p.yMm+1);
  }
 }
 // Independent 25+25 side timing squares at the existing verified coordinates.
 for(let row=0;row<25;row++){
  const y=answers.rowStartY+row*answers.rowSpacingY;
  for(const x of [13.3,196.7])square(x-.8,y-.8,1.6,1.6,true);
 }
 // The two never-filled squares give a geometry reference for the code.
 const f=SHEET_FOOTER;
 pdf.setLineWidth(.45);
 square(f.leftBoxXmm,f.boxYmm,f.boxSizeMm,f.boxSizeMm);
 square(f.rightBoxXmm,f.boxYmm,f.boxSizeMm,f.boxSizeMm);
 pdf.setLineWidth(.18);
 const bits=footerBits(count);
 bits.forEach((bit,i)=>bubble(f.firstXmm+i*f.spacingMm,f.yMm,f.radiusMm,Boolean(bit)));
 // Same seven-patch grayscale reference as the original 50-question layout.
 const gray=[0,38,77,115,153,204,255];
 gray.forEach((value,i)=>{
  pdf.setFillColor(value,value,value);
  square(129+i*9,283.2,6,6,true);
 });
 pdf.setFillColor(0,0,0);
 pdf.setFontSize(6.5);
 pdf.text('Experimental layout. Print A4 at 100% / actual size. Do not fit to page.',105,294,{align:'center'});
 pdf.save('SFG-OMR-SheetID-50-experiment.pdf');
}
