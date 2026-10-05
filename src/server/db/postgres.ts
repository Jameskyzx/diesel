import rawPostgres, { type Options, type PostgresType } from "postgres";

import { getDatabaseTlsOptions } from "./tls";

export type { Sql, Options } from "postgres";

export default function postgres<T extends Record<string, PostgresType> = Record<string, never>>(
  databaseUrl: string,
  options: Options<T> = {},
) {
  // The URL is the sole destination identity. A socket/host override could make
  // a loopback exception connect to a remote host, or change the verified name.
  if (["host", "hostname", "path", "socket"].some((key) =>
    Object.prototype.hasOwnProperty.call(options, key))) {
    throw new Error("Database destination overrides are not permitted.");
  }
  const ssl = getDatabaseTlsOptions(databaseUrl);
  return rawPostgres<T>(databaseUrl, {
    ...options,
    ...(ssl ? { ssl } : {}),
  });
}
