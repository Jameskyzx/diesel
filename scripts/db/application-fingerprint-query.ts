import { z } from "zod";
import { applicationDataTables } from "../deploy/application-release-contract";

/** Only fixed governed tables; raw row/document values never leave PostgreSQL. */
export function applicationFingerprintQuery(tableValue: unknown): string {
  const table = z.enum(applicationDataTables).parse(tableValue);
  const qualified = table === "drizzle.__drizzle_migrations" ? table : `public.${table}`;
  // The 100001st row is retained so the report schema rejects an oversized
  // relation, rather than certifying a truncated 100000-row fingerprint.
  return `select count(*)::integer as count,
    encode(sha256(convert_to(coalesce(string_agg(h, '' order by h collate "C"), ''), 'UTF8')), 'hex') as sha256
    from (select encode(sha256(convert_to(row_to_json(t)::text, 'UTF8')), 'hex') as h
      from only ${qualified} t limit 100001) fingerprints`;
}
