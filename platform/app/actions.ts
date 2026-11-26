'use server';
import {revalidatePath} from 'next/cache';
import {redirect} from 'next/navigation';
import {requireUser} from '@/lib/auth';
import {validKey} from '@/lib/key';
import {createInstituteRecord,createTestRecord,saveAnswerKey,publishAnswerKey} from '@/lib/repository';

function field(form:FormData,name:string,max=120){return String(form.get(name)||'').trim().slice(0,max);}
export async function createInstitute(form:FormData){
 const {user}=await requireUser();
 const name=field(form,'name',100),slug=field(form,'slug',40).toLowerCase();
 if(name.length<3||!/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug))redirect('/setup?error=invalid');
 try{if(!await createInstituteRecord(user.id,name,slug))redirect('/setup?error=exists');}
 catch{redirect('/setup?error=exists');}
 revalidatePath('/dashboard');redirect('/dashboard');
}
export async function createTest(form:FormData){
 const {user}=await requireUser();
 const org=field(form,'org',36),title=field(form,'title'),n=Number(form.get('sheet_test_number'));
 if(!/^[0-9a-f-]{36}$/i.test(org)||title.length<3||!Number.isInteger(n)||n<1||n>40)
  redirect('/dashboard?error=invalid');
 const id=await createTestRecord(user.id,org,title,n);
 if(!id)redirect('/dashboard?error=permission');
 revalidatePath('/dashboard');redirect('/dashboard/tests/'+id);
}
export async function saveKey(form:FormData){
 const {user}=await requireUser();
 const id=field(form,'test_id',36);
 if(!/^[0-9a-f-]{36}$/i.test(id))redirect('/dashboard');
 let values:unknown;
 try{values=JSON.parse(field(form,'key',4096));}catch{redirect('/dashboard/tests/'+id+'?error=invalid');}
 if(!validKey(values))redirect('/dashboard/tests/'+id+'?error=invalid');
 if(!await saveAnswerKey(user.id,id,values))redirect('/dashboard/tests/'+id+'?error=permission');
 revalidatePath('/dashboard/tests/'+id);
 redirect('/dashboard/tests/'+id+'?saved=1');
}
export async function publishKey(form:FormData){
 const {user}=await requireUser(),id=field(form,'test_id',36);
 if(!/^[0-9a-f-]{36}$/i.test(id))redirect('/dashboard');
 try{if(!await publishAnswerKey(user.id,id))redirect('/dashboard/tests/'+id+'?error=incomplete');}
 catch{redirect('/dashboard/tests/'+id+'?error=incomplete');}
 revalidatePath('/dashboard');revalidatePath('/dashboard/tests/'+id);
 redirect('/dashboard/tests/'+id+'?published=1');
}
