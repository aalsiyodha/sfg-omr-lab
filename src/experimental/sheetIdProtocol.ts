/** Isolated Sheet-ID experiment. This is NOT the production QR protocol.
 *  Four deliberately separated 16-bit codewords encode the four layouts.
 *  Read the printed circle CENTRES; outlines and end boxes are alignment only.
 */
export const SHEET_ID_CODES={
  50:0xA596,
  100:0x5A69,
  120:0xC33C,
  200:0x3CC3
} as const;
export type SheetQuestionCount=keyof typeof SHEET_ID_CODES;
export const SHEET_FOOTER={
  yMm:274.0,
  firstXmm:59,
  spacingMm:3.45,
  bitCount:16,
  radiusMm:1.25,
  boxYmm:271.6,
  boxSizeMm:4.8,
  leftBoxXmm:49.5,
  rightBoxXmm:117.2
} as const;
export const footerBits=(count:SheetQuestionCount)=>
  Array.from({length:16},(_,i)=>(SHEET_ID_CODES[count]>>>(15-i))&1);
export const hamming=(a:number,b:number)=>{
 let bits=a^b,n=0;
 while(bits){n+=bits&1;bits>>>=1;}
 return n;
};
export function decodeFooterWord(word:number):{count:SheetQuestionCount|null;distance:number;exact:boolean}{
 const entries=Object.entries(SHEET_ID_CODES) as [string,number][];
 const ranked=entries.map(([count,code])=>({count:Number(count) as SheetQuestionCount,
   distance:hamming(word,code)})).sort((a,b)=>a.distance-b.distance);
 // Fail closed: no correction until real-phone data proves its safety.
 const exact=ranked[0].distance===0;
 return {count:exact?ranked[0].count:null,distance:ranked[0].distance,exact};
}
