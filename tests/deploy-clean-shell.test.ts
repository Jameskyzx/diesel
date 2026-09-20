import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("deployment clean Bash boundary", () => {
  it("drops startup hooks and exported functions while preserving descriptor 8", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "diesel-clean-bash-"));
    const poison = join(fixture, "poison.sh");
    const marker = join(fixture, "startup-hook-ran");
    const probe = join(fixture, "probe.sh");
    const lock = join(fixture, "lifecycle.lock");
    const output = join(fixture, "probe.out");

    try {
      await Promise.all([
        writeFile(
          poison,
          'printf \'startup-hook-ran\\n\' >"${ACTIVATION_STARTUP_CANARY:?}"\n',
          "utf8",
        ),
        writeFile(lock, "lock\n", "utf8"),
        writeFile(
          probe,
          [
            "#!/bin/bash",
            "set -Eeuo pipefail",
            'marker="$1"',
            'output="$2"',
            '[[ ! -e "${marker}" ]]',
            '[[ -z "${BASH_ENV+x}" ]]',
            '[[ -z "${ENV+x}" ]]',
            '[[ -z "${ACTIVATION_SECRET_CANARY+x}" ]]',
            '[[ "$(type -t env)" == "file" ]]',
            '[[ "$(type -t cp)" == "file" ]]',
            '[[ "$(type -t mv)" == "file" ]]',
            '[[ "$(type -t source)" == "builtin" ]]',
            '[[ "${DIESEL_RELEASE_LIFECYCLE_LOCK_FD:-}" == "8" ]]',
            "{ true <&8; }",
            'printf \'clean-child\\n\' >"${output}"',
            "",
          ].join("\n"),
          "utf8",
        ),
      ]);
      await chmod(probe, 0o700);

      const outer = [
        "set -Eeuo pipefail",
        'poison="$1"',
        'marker="$2"',
        'probe="$3"',
        'lock="$4"',
        'output="$5"',
        'fixture_home="$6"',
        'env() { printf \'exported-env-ran\\n\' >"${ACTIVATION_STARTUP_CANARY:?}"; return 91; }',
        'cp() { printf \'exported-cp-ran\\n\' >"${ACTIVATION_STARTUP_CANARY:?}"; return 92; }',
        'mv() { printf \'exported-mv-ran\\n\' >"${ACTIVATION_STARTUP_CANARY:?}"; return 93; }',
        'source() { printf \'exported-source-ran\\n\' >"${ACTIVATION_STARTUP_CANARY:?}"; return 94; }',
        "export -f env cp mv source",
        'export BASH_ENV="${poison}"',
        'export ENV="${poison}"',
        'export ACTIVATION_SECRET_CANARY="must-not-enter-clean-child"',
        'export ACTIVATION_STARTUP_CANARY="${marker}"',
        'exec 8<>"${lock}"',
        "command /usr/bin/env -i \\",
        '  HOME="${fixture_home}" \\',
        "  LANG=C \\",
        "  LC_ALL=C \\",
        "  PATH=/usr/bin:/bin \\",
        "  DIESEL_RELEASE_LIFECYCLE_LOCK_FD=8 \\",
        "  /bin/bash --noprofile --norc -- \\",
        '  "${probe}" "${marker}" "${output}"',
        '[[ ! -e "${marker}" ]]',
        "set +e",
        '/bin/bash --noprofile --norc -- "${probe}" "${marker}" "${output}.dirty"',
        'dirty_status="$?"',
        "set -e",
        '[[ "${dirty_status}" -ne 0 ]]',
        '[[ -f "${marker}" ]]',
        "",
      ].join("\n");

      await execFileAsync(
        "/bin/bash",
        [
          "-c",
          outer,
          "clean-bash-fixture",
          poison,
          marker,
          probe,
          lock,
          output,
          fixture,
        ],
        { env: { NODE_ENV: "test", PATH: "/usr/bin:/bin" } },
      );

      await expect(readFile(output, "utf8")).resolves.toBe("clean-child\n");
      await expect(readFile(marker, "utf8")).resolves.toBe(
        "startup-hook-ran\n",
      );
    } finally {
      await rm(fixture, { force: true, recursive: true });
    }
  });
});
