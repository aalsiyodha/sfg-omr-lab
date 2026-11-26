import {NextRequest,NextResponse} from 'next/server';
import {auth} from '@/lib/auth/server';
export async function POST(request:NextRequest){
 await auth.signOut();
 return NextResponse.redirect(new URL('/',request.url),303);
}
