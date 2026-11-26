import {redirect} from 'next/navigation';
import {auth} from './auth/server';
import {isConfigured} from './env';
export async function requireUser(){
 if(!isConfigured())redirect('/login');
 const {data}=await auth.getSession();
 const user=data?.user;
 if(!user?.id)redirect('/login');
 return {user};
}
