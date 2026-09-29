import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export type FixtureSha256CapabilityProbe = (
  command: string,
  args: readonly string[],
  options: {
    input: Buffer;
    maxBuffer: number;
    timeout: number;
    encoding?: "utf8";
  },
) => { error?: Error; status: number | null; stdout: Buffer | string | null };

/** Test-only backend selection; neither paths nor file digests are cached. */
export function createFixtureSha256sumShim(
  options: {
    nativeExecutable?: string | null;
    runCapabilityProbe?: FixtureSha256CapabilityProbe;
  } = {},
): string {
  // Decision tests inject observations; ordinary fixtures retain the bounded
  // real process probe, including its safe fallback when the host is busy.
  const runCapabilityProbe: FixtureSha256CapabilityProbe =
    options.runCapabilityProbe ?? spawnSync;
  const candidate = options.nativeExecutable === undefined
    ? "/usr/bin/openssl"
    : options.nativeExecutable;
  let nativeIsSupported = false;
  if (candidate && isAbsolute(candidate)) {
    try {
      nativeIsSupported = true;
      for (const input of [Buffer.alloc(0), Buffer.from([0, 255, 10, 13, 65, 194, 181, 0, 127])]) {
        const result = runCapabilityProbe(candidate, ["dgst", "-sha256", "-binary"], {
          input,
          maxBuffer: 4 * 1024,
          timeout: 2_000,
        });
        const digest = createHash("sha256").update(input).digest();
        if (result.error || result.status !== 0 ||
          !Buffer.isBuffer(result.stdout) || !result.stdout.equals(digest)) {
          nativeIsSupported = false;
          break;
        }
      }
      if (nativeIsSupported) {
        const digest = createHash("sha256").update("fixture-converter-probe").digest();
        const converted = runCapabilityProbe("/usr/bin/od", ["-An", "-v", "-tx1"], {
          encoding: "utf8",
          input: digest,
          maxBuffer: 4 * 1024,
          timeout: 2_000,
        });
        nativeIsSupported = !converted.error && converted.status === 0 &&
          typeof converted.stdout === "string" &&
          /^(?:[ \t\r\n\v\f]*[0-9a-f]{2}){32}[ \t\r\n\v\f]*$/.test(converted.stdout) &&
          converted.stdout.replace(/[ \t\r\n\v\f]/g, "") === digest.toString("hex");
      }
    } catch {
      // An unavailable/incompatible backend preserves the original Node behavior.
      nativeIsSupported = false;
    }
  }

  const native = candidate && nativeIsSupported
    ? `# Convert raw bytes before command substitution: Bash discards embedded NULs.
# The native path reads each regular file afresh and keeps both pipeline statuses.
if [[ "$path" == /* && -f "$path" ]]; then
  if native_output="$(${quoteShell(candidate)} dgst -sha256 -binary 2>/dev/null < "$path" |
    /usr/bin/od -An -v -tx1 2>/dev/null)"; then
    native_digest="\${native_output//[$' \\t\\r\\n\\v\\f']/}"
    if [[ "$native_digest" =~ ^[0-9a-f]{64}$ ]]; then
      printf '%s  %s\\n' "$native_digest" "$path"
      exit 0
    fi
  fi
fi
`
    : "";
  return `#!/bin/bash
set -euo pipefail
path="\${!#}"
${native}\
digest="$(${quoteShell(process.execPath)} -e 'const fs=require("node:fs"),crypto=require("node:crypto");process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$path")"
printf '%s  %s\\n' "$digest" "$path"
`;
}
