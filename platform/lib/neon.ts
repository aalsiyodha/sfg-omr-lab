import 'server-only';
import {neon} from '@neondatabase/serverless';
import {requireDatabaseUrl} from './env';
/** HTTP serverless driver: each request is a parameterized tagged SQL query. */
export function sql(){return neon(requireDatabaseUrl());}
