import {NextResponse} from 'next/server';
import {sql} from '@/lib/neon';
import {isConfigured} from '@/lib/env';
export const dynamic='force-dynamic';
export async function GET(){
 if(!isConfigured())return NextResponse.json({status:'unavailable'}, {status:503});
 try{
  const rows=await sql()`SELECT 1 AS alive`;
  const ready=Number(rows[0]?.alive)===1;
  return NextResponse.json({status:ready?'ok':'unavailable',database:ready?'connected':'unavailable',
    auth:'configured',version:'neon-pilot-0.3'},
    {status:ready?200:503,headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({status:'unavailable',database:'unavailable'},{status:503});}
}
