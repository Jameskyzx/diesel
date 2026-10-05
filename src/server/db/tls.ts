import { checkServerIdentity, type ConnectionOptions } from "node:tls";

import { databaseUrlSchema } from "./environment";
import { supabaseRootCa } from "./supabase-root-ca";

export function isLoopbackDatabaseHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
}

export function isSupabaseDatabaseHost(hostname: string): boolean {
  return /^[a-z0-9-]+\.pooler\.supabase\.com$/u.test(hostname) ||
    /^db\.[a-z0-9-]+\.supabase\.co$/u.test(hostname);
}

// Only explicit loopback databases (local development / CI) may use plaintext.
// A URL's require/prefer/disable never weakens a remote connection. Do not
// rewrite DATABASE_URL: the release protocol binds its exact identity bytes.
export function getDatabaseTlsOptions(databaseUrl: string): ConnectionOptions | undefined {
  const hostname = new URL(databaseUrlSchema.parse(databaseUrl)).hostname;
  if (isLoopbackDatabaseHost(hostname)) return undefined;
  return {
    rejectUnauthorized: true,
    servername: hostname,
    checkServerIdentity,
    ...(isSupabaseDatabaseHost(hostname) ? { ca: supabaseRootCa } : {}),
  };
}
