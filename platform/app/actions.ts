'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { validKey } from '@/lib/key';
function text(form:FormData,name:string,max=120):string {
  return String(form.get(name)||'').trim().slice(0,max);
}
export async function createInstitute(form:FormData){
  const {db}=await requireUser();
  const name=text(form,'name',100);
  const slug=text(form,'slug',40).toLowerCase();
  if(name.length<3||!/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug))redirect('/setup?error=invalid');
  const {error}=await db.rpc('create_institute',{institute_name:name,institute_slug:slug});
  if(error)redirect('/setup?error=exists');
  revalidatePath('/dashboard');
  redirect('/dashboard');
}
export async function createTest(form:FormData){
  const {db,user}=await requireUser();
  const org=text(form,'org',36), title=text(form,'title'), n=Number(form.get('sheet_test_number'));
  if(!/^[0-9a-f-]{36}$/i.test(org)||title.length<3||!Number.isInteger(n)||n<1||n>40)
    redirect('/dashboard?error=invalid');
  const {data,error}=await db.from('tests').insert({
    institute_id:org,title,sheet_test_number:n,question_count:50,
    answer_key:Array(50).fill(null),created_by:user.id
  }).select('id').single();
  if(error||!data)redirect('/dashboard?error=permission');
  revalidatePath('/dashboard');
  redirect('/dashboard/tests/'+data.id);
}
export async function saveKey(form:FormData){
  const {db}=await requireUser();
  const id=text(form,'test_id',36);
  if(!/^[0-9a-f-]{36}$/i.test(id))redirect('/dashboard');
  let values:unknown;
  try{values=JSON.parse(text(form,'key',4096));}catch{redirect('/dashboard/tests/'+id+'?error=invalid');}
  if(!validKey(values))redirect('/dashboard/tests/'+id+'?error=invalid');
  const {error}=await db.from('tests').update({answer_key:values})
    .eq('id',id).eq('status','draft');
  if(error)redirect('/dashboard/tests/'+id+'?error=permission');
  revalidatePath('/dashboard/tests/'+id);
  redirect('/dashboard/tests/'+id+'?saved=1');
}
export async function publishKey(form:FormData){
  const {db}=await requireUser();
  const id=text(form,'test_id',36);
  if(!/^[0-9a-f-]{36}$/i.test(id))redirect('/dashboard');
  const {data}=await db.from('tests').select('answer_key,status').eq('id',id).single();
  if(!data||data.status!=='draft'||!validKey(data.answer_key)||
    data.answer_key.some(v=>v===null))redirect('/dashboard/tests/'+id+'?error=incomplete');
  const {error}=await db.from('tests').update({status:'published'})
    .eq('id',id).eq('status','draft');
  if(error)redirect('/dashboard/tests/'+id+'?error=permission');
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/tests/'+id);
  redirect('/dashboard/tests/'+id+'?published=1');
}
