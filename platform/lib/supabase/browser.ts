'use client';
import { createBrowserClient } from '@supabase/ssr';
import { authEnv } from '@/lib/env';
export function supabaseBrowser(){
  const {url,key}=authEnv();
  return createBrowserClient(url,key);
}
