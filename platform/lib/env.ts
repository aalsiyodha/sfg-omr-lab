export function isConfigured(){return Boolean(process.env.DATABASE_URL && process.env.NEON_AUTH_BASE_URL && process.env.NEON_AUTH_COOKIE_SECRET);}
export function requireDatabaseUrl(){const url=process.env.DATABASE_URL;if(!url)throw new Error('Neon DATABASE_URL is not configured.');return url;}
