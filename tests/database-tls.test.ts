import { createHash, X509Certificate } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { checkServerIdentity } from "node:tls";

import { describe, expect, it } from "vitest";

import postgres from "@/server/db/postgres";
import { supabaseRootCa } from "@/server/db/supabase-root-ca";
import { getDatabaseTlsOptions } from "@/server/db/tls";
import { createPostgresBackupConnection } from "../scripts/db/postgres-backup";

describe("remote PostgreSQL certificate and hostname verification", () => {
  it.each(["require", "allow", "prefer", "disable", "verify-ca", "verify-full"])(
    "never downgrades TLS for a remote URL with sslmode=%s", async (mode) => {
      const client = postgres(`postgres://user@db.example.test/app?sslmode=${mode}`, {
        ssl: { rejectUnauthorized: false, checkServerIdentity: () => undefined },
        connect_timeout: 10, max: 2, prepare: false,
      });
      expect(client.options.ssl).toEqual({
        rejectUnauthorized: true, servername: "db.example.test", checkServerIdentity,
      });
      expect(client.options).toMatchObject({ connect_timeout: 10, max: 2, prepare: false });
      await client.end(); // No connection/query is opened by this options test.
    },
  );

  it.each(["localhost", "127.0.0.1", "[::1]"])("preserves explicit local development / CI transport for %s", (host) => {
    expect(getDatabaseTlsOptions(`postgres://user@${host}/app`)).toBeUndefined();
  });

  it.each(["localhost.example.test", "127.0.0.2", "192.168.1.1", "db.example.test"])(
    "does not exempt non-allowlisted destinations: %s", (host) => {
      expect(getDatabaseTlsOptions(`postgres://user@${host}/app`)).toMatchObject({
        rejectUnauthorized: true, servername: host, checkServerIdentity,
      });
    },
  );

  it.each(["aws-0-ap-southeast-1.pooler.supabase.com", "db.exampleproject.supabase.co"])(
    "uses the reviewed public CA only for the exact Supabase database domain: %s", (host) => {
      expect(getDatabaseTlsOptions(`postgres://user@${host}/app?sslmode=require`)).toEqual({
        rejectUnauthorized: true, servername: host, checkServerIdentity, ca: supabaseRootCa,
      });
    },
  );

  it.each(["supabase.com", "evilpooler.supabase.com", "aws-0.pooler.supabase.com.evil.test", "example.supabase.co"])(
    "does not assign Supabase trust to a lookalike host: %s", (host) => {
      expect(getDatabaseTlsOptions(`postgres://user@${host}/app`)).not.toHaveProperty("ca");
    },
  );

  it("pins the certificate bytes, purpose, validity and identical pg_dump CA", () => {
    expect(createHash("sha256").update(supabaseRootCa).digest("hex")).toBe(
      "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7",
    );
    const cert = new X509Certificate(supabaseRootCa);
    expect(cert.ca).toBe(true);
    expect(cert.verify(cert.publicKey)).toBe(true);
    expect(new Date(cert.validFrom).getTime()).toBeLessThan(Date.now());
    expect(new Date(cert.validTo).getTime()).toBeGreaterThan(Date.now());
    expect(readFileSync("deploy/certificates/supabase-prod-ca-2021.crt", "utf8")).toBe(supabaseRootCa);
  });

  it("keeps Node's real hostname check (a wrong hostname is rejected)", () => {
    const options = getDatabaseTlsOptions("postgres://user@db.example.test/app");
    const certificate = {
      ...new X509Certificate(supabaseRootCa).toLegacyObject(),
      subjectaltname: "DNS:other.example.test",
    };
    expect(options?.checkServerIdentity?.("db.example.test", certificate)).toBeInstanceOf(Error);
    expect(options?.checkServerIdentity?.("other.example.test", certificate)).toBeUndefined();
  });

  it.each(["host", "hostname", "path", "socket"])("rejects a destination override through %s", (key) => {
    expect(() => postgres("postgres://user@localhost/app", { [key]: "remote.test" }))
      .toThrow("Database destination overrides are not permitted");
  });

  it("does not rewrite the URL bound by the release/rollback identity contract", () => {
    const url = "postgres://user@aws-0-ap-southeast-1.pooler.supabase.com/app?sslmode=require";
    const before = url;
    getDatabaseTlsOptions(url);
    expect(url).toBe(before);
  });

  it("also makes pg_dump use verify-full and the reviewed CA without credential arguments", () => {
    const result = createPostgresBackupConnection(
      "postgres://user:secret@aws-0-ap-southeast-1.pooler.supabase.com/app?sslmode=disable",
      "/private/backup.dump",
    );
    expect(result.environment.PGSSLMODE).toBe("verify-full");
    expect(readFileSync(result.environment.PGSSLROOTCERT!, "utf8")).toBe(supabaseRootCa);
    expect(result.pgDumpArguments.join(" ")).not.toContain("secret");
  });

  it("keeps every application/operational PostgreSQL constructor behind the TLS boundary", () => {
    function inspect(directory: string): string[] {
      return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? inspect(path) : path.endsWith(".ts") ? [path] : [];
      });
    }
    const bypasses = [...inspect("src"), ...inspect("scripts")].filter((path) =>
      path !== "src/server/db/postgres.ts" &&
      /import\s+(?!type\b)[^;]*\bfrom\s*["']postgres["']/u.test(readFileSync(path, "utf8")),
    );
    expect(bypasses).toEqual([]);
  });
});
