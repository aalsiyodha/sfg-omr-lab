import 'server-only';
import {createNeonAuth} from '@neondatabase/auth/next/server';
// Build-only placeholders: protected pages fail closed when isConfigured() is false.
export const auth=createNeonAuth({
 baseUrl:process.env.NEON_AUTH_BASE_URL||'https://example.invalid/neondb/auth',
 cookies:{secret:process.env.NEON_AUTH_COOKIE_SECRET||'OMRLabsBuildOnlyNotForRuntime2026PlaceholderSecret'}
});
