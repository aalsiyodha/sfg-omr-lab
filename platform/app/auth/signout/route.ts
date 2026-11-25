import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
export async function POST(request:NextRequest){
  const client=await supabaseServer();
  await client.auth.signOut();
  return NextResponse.redirect(new URL('/',request.url),303);
}
