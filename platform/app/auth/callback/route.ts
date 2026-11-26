import {NextRequest,NextResponse} from 'next/server';
// Neon Auth's OAuth callback is served by /api/auth/[...path].
export async function GET(request:NextRequest){
 return NextResponse.redirect(new URL('/login',request.url));
}
