"""Fail closed before CI lets pnpm or setup-node consume repository input."""

import hashlib
import json
import os
import stat


def fail(message):
    raise SystemExit("unsafe CI install boundary: " + message)


def read_regular(path, maximum_bytes):
    if not hasattr(os, "O_NOFOLLOW"):
        fail("O_NOFOLLOW is unavailable")
    flags = os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as cause:
        fail("%s cannot be opened safely: %s" % (path, cause))

    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
            fail("%s must be a single-link regular file" % path)
        if before.st_mode & 0o022:
            fail("%s must not be group- or world-writable" % path)
        if before.st_size < 1 or before.st_size > maximum_bytes:
            fail("%s has an invalid size" % path)

        chunks = []
        total = 0
        while total <= maximum_bytes:
            chunk = os.read(
                descriptor,
                min(65536, maximum_bytes + 1 - total),
            )
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
        after = os.fstat(descriptor)
    finally:
        os.close(descriptor)

    def identity(value):
        return (
            value.st_dev,
            value.st_ino,
            value.st_mode,
            value.st_nlink,
            value.st_size,
            value.st_mtime_ns,
            value.st_ctime_ns,
        )

    if identity(before) != identity(after) or total != before.st_size:
        fail("%s changed while it was read" % path)
    return b"".join(chunks)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            fail("package.json contains duplicate key %r" % key)
        result[key] = value
    return result


def reject_constant(value):
    fail("package.json contains non-JSON constant %s" % value)


if os.path.realpath(".") != os.path.abspath("."):
    fail("workspace must be a physical path")

for forbidden_path in (".npmrc", ".pnpmfile.cjs"):
    if os.path.lexists(forbidden_path):
        fail("repository %s is forbidden" % forbidden_path)

package_bytes = read_regular("package.json", 2 * 1024 * 1024)
workspace_bytes = read_regular("pnpm-workspace.yaml", 2 * 1024 * 1024)
lock_bytes = read_regular("pnpm-lock.yaml", 16 * 1024 * 1024)
nvmrc_bytes = read_regular(".nvmrc", 64)

try:
    package_source = package_bytes.decode("utf-8")
    workspace_bytes.decode("utf-8")
    lock_bytes.decode("utf-8")
except UnicodeDecodeError as cause:
    fail("package-manager input is not valid UTF-8: %s" % cause)

try:
    package = json.loads(
        package_source,
        object_pairs_hook=unique_object,
        parse_constant=reject_constant,
    )
except (TypeError, ValueError, json.JSONDecodeError) as cause:
    fail("package.json is not strict JSON: %s" % cause)

canonical = json.dumps(
    package,
    ensure_ascii=False,
    indent=2,
    separators=(",", ": "),
) + "\n"
if package_source != canonical:
    fail("package.json is not canonical two-space JSON")
if not isinstance(package, dict) or package.get("packageManager") != "pnpm@11.9.0":
    fail("packageManager must be exactly pnpm@11.9.0")

scripts = package.get("scripts")
if not isinstance(scripts, dict) or any(
    not isinstance(key, str) or not isinstance(value, str)
    for key, value in scripts.items()
):
    fail("package.json scripts must be a string map")

forbidden_scripts = (
    "preinstall",
    "install",
    "postinstall",
    "prepublish",
    "preprepare",
    "prepare",
    "postprepare",
    "pnpm:devPreinstall",
)
present = sorted(name for name in forbidden_scripts if name in scripts)
if present:
    fail("root install lifecycle scripts are forbidden: " + ", ".join(present))

expected_workspace_sha256 = (
    "9b4b0615716850f396fba7904c63507ef1ad0a4855a9a599ff3bb9219a588241"
)
if hashlib.sha256(workspace_bytes).hexdigest() != expected_workspace_sha256:
    fail("pnpm-workspace.yaml does not match the reviewed execution config")
next_patch_bytes = read_regular("patches/next@16.3.8.patch", 256 * 1024)
if hashlib.sha256(next_patch_bytes).hexdigest() != (
    "c4bab236a65a0e52fa62f88e892e007d2ca2936a2df20d02579e759ea973d2a3"
):
    fail("Next static-file patch does not match its reviewed source")
next_lint_patch_bytes = read_regular("patches/@next__eslint-plugin-next@16.3.6.patch", 256 * 1024)
if hashlib.sha256(next_lint_patch_bytes).hexdigest() != (
    "c5871d65306a6b3f1d9a9f35eb5fd37d01f70b4f6107cd065476257d9ce51b67"
):
    fail("Next lint glob patch does not match its reviewed source")
runner_patch_bytes = read_regular("patches/@vitest__runner@4.1.11.patch", 256 * 1024)
if hashlib.sha256(runner_patch_bytes).hexdigest() != (
    "43a34fe00371ed7d2a7a972ad80269cbfe7cda5beb045640d3a2ad8ff06d54ee"
):
    fail("Vitest runner patch does not match its reviewed source")
vaul_patch_bytes = read_regular("patches/vaul@1.1.2.patch", 256 * 1024)
if hashlib.sha256(vaul_patch_bytes).hexdigest() != (
    "6d0a37b5ddc97a7c29c65f2a0b76771551f87b693e3f1e4c7d634c6e0841da33"
):
    fail("Vaul non-modal patch does not match its reviewed source")
if nvmrc_bytes != b"22.22.3\n":
    fail(".nvmrc must be exactly 22.22.3")

print("CI install boundary accepted")
