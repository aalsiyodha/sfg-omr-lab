import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { authEnv } from '@/lib/env';
export async function supabaseServer() {
  const {url,key}=authEnv();
  const jar=await cookies();
  return createServerClient(url,key,{
    cookies: {
      getAll(){return jar.getAll();},
      setAll(items){
        try { for(const item of items) jar.set(item.name,item.value,item.options); }
        catch { /* Server Components cannot set cookies; proxy refreshes sessions. */ }
      }
    }
  });
}
