export type Choice='A'|'B'|'C'|'D'|'X'|null;
export const TOTAL_QUESTIONS=50;
export function validKey(value:unknown):value is Choice[] {
  return Array.isArray(value)&&value.length===TOTAL_QUESTIONS&&
    value.every(v=>v===null||v==='A'||v==='B'||v==='C'||v==='D'||v==='X');
}
export function parseKeyCsv(csv:string):{key:Choice[];error?:string}{
  const result:Choice[]=Array(TOTAL_QUESTIONS).fill(null);
  const rows=csv.replace(/^\uFEFF/,'').trim().split(/\r?\n/);
  if(rows.length>100) return {key:result,error:'CSV is too large: expected 50 rows.'};
  const seen=new Set<number>();
  let parsed=0;
  for(const [index,line] of rows.entries()){
    if(!line.trim())continue;
    const columns=line.split(',').map(v=>v.trim().replace(/^"|"$/g,''));
    if(index===0 && /^(question|q|number)$/i.test(columns[0]))continue;
    const n=Number(columns[0]);
    if(!Number.isInteger(n)||n<1||n>TOTAL_QUESTIONS)return {key:result,error:'Invalid question number on row '+(index+1)};
    if(seen.has(n))return {key:result,error:'Duplicate question '+n};
    seen.add(n);
    const v=(columns[1]||'').toUpperCase();
    if(!['A','B','C','D','X',''].includes(v))return {key:result,error:'Invalid answer on row '+(index+1)};
    result[n-1]=(v||null) as Choice;
    parsed++;
  }
  if(parsed===0)return {key:result,error:'No answers found. Expected question,answer rows.'};
  return {key:result};
}
