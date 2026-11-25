import { redirect } from 'next/navigation';
import { supabaseServer } from './supabase/server';
export async function requireUser(){
  const db=await supabaseServer();
  // getUser validates the access token with Supabase Auth.
  const {data:{user},error}=await db.auth.getUser();
  if(error||!user)redirect('/login');
  return {db,user};
}
