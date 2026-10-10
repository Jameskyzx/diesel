#!/usr/bin/env bash
set -euo pipefail

# systemd treats several termination signals as clean service exits by default.
# Convert every catchable operator signal into an explicit non-zero shell status
# before any external command can run so the root-side controller cannot mistake
# an interrupted build for success.
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ "$(id -u)" -eq 0 ]]; then
  echo "release builds must run as the unprivileged diesel-build user" >&2
  exit 64
fi

release_id="${BUILD_RELEASE_ID:-}"
build_home="${BUILD_HOME:-}"
registry="${PNPM_REGISTRY:-https://registry.npmjs.org}"
manifest_path=".release-input-manifest.json"
next_environment_path="next-env.d.ts"
next_environment_snapshot="${build_home}/next-env.d.ts.before-build"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

[[ "${release_id}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "BUILD_RELEASE_ID must be a full lowercase Git commit SHA" >&2
  exit 64
}
[[ -n "${build_home}" && -d "${build_home}" ]] || {
  echo "BUILD_HOME must name the isolated build user's existing home" >&2
  exit 64
}

for secret_name in \
  DATABASE_URL \
  AI_API_KEY \
  ADMIN_ROLE_BINDINGS_JSON; do
  if [[ -n "${!secret_name:-}" ]]; then
    echo "${secret_name} must not be present during a release build" >&2
    exit 64
  fi
done

for runtime_environment in .env.local .env.production .env.production.local; do
  if [[ -e "${runtime_environment}" || -L "${runtime_environment}" ]]; then
    echo "${runtime_environment} must be linked only after the build succeeds" >&2
    exit 64
  fi
done

[[ -f package.json && -f pnpm-lock.yaml && -f next.config.ts ]] || {
  echo "run this script from the root of a tracked release" >&2
  exit 64
}
[[ -f "${next_environment_path}" && ! -L "${next_environment_path}" ]] || {
  echo "${next_environment_path} must be a regular tracked input" >&2
  exit 64
}
[[ ! -e "${next_environment_snapshot}" && ! -L "${next_environment_snapshot}" ]] || {
  echo "isolated next-env snapshot must not already exist" >&2
  exit 64
}
[[ -d node_modules && ! -L node_modules ]] || {
  echo "node_modules must be a pre-created build output directory" >&2
  exit 64
}
[[ -d .next && ! -L .next ]] || {
  echo ".next must be a pre-created build output directory" >&2
  exit 64
}
[[ -f .build-complete && ! -L .build-complete ]] || {
  echo ".build-complete must be a pre-created regular file" >&2
  exit 64
}
[[ ! -e .deploy-ready && ! -L .deploy-ready ]] || {
  echo ".deploy-ready must not exist during a release build" >&2
  exit 64
}
[[ -f "${manifest_path}" && ! -L "${manifest_path}" ]] || {
  echo "${manifest_path} must be a pre-created regular file" >&2
  exit 64
}
[[ -f scripts/deploy/release-input-manifest.mjs && ! -L scripts/deploy/release-input-manifest.mjs ]] || {
  echo "release input verifier is missing or is a symlink" >&2
  exit 64
}
[[ -f scripts/deploy/release-artifact-manifest.mjs && ! -L scripts/deploy/release-artifact-manifest.mjs ]] || {
  echo "release artifact verifier is missing or is a symlink" >&2
  exit 64
}

input_digest="$(
  node scripts/deploy/release-input-manifest.mjs \
    verify "${release_id}" "${manifest_path}"
)"
[[ "${input_digest}" =~ ^[0-9a-f]{64}$ ]] || {
  echo "release input verifier did not return a SHA-256 digest" >&2
  exit 65
}

# Next.js rewrites next-env.d.ts during production builds. Preserve the exact
# tracked input in the per-release HOME and restore it before the strict input
# re-verification; any snapshot tampering is still caught by the trusted root
# verifier after the builder cgroup has been stopped.
cp -p -- "${next_environment_path}" "${next_environment_snapshot}"

# Keep installation aligned with the CI install boundary. In particular,
# esbuild's optional postinstall optimization creates hardlinks even when pnpm
# imports packages by copy; those cannot enter the immutable artifact closure.
# Official-registry large tarballs exceeded pnpm's 60-second request default
# on the VPS. Keep each request bounded and reduce contention; the parent
# systemd service still enforces its independent 45-minute build deadline.
# Registry/TLS, lockfile integrity and the no-lifecycle-script boundary remain
# unchanged. Never inherit these transport bounds from a caller's npm config.
# Numeric options must use pnpm's typed install flags, not --config.* strings.
corepack pnpm --config.registry="${registry}" \
  install --network-concurrency=4 --fetch-timeout=600000 --fetch-retries=2 \
  --frozen-lockfile --trust-lockfile --package-import-method=copy \
  --ignore-scripts --ignore-pnpmfile

# Keep V8 collection below the build cgroup's aggregate memory ceiling. This
# applies to Next's compilation/type-check workers, not the runtime app or root
# verifiers. Next may reset this option for static-page workers; the cgroup
# ceiling still bounds the entire build, including those workers.
# Do not inherit caller-supplied Node options or skip the Next TypeScript check.
env -i \
  HOME="${build_home}" \
  PATH="${PATH}" \
  APP_VERSION="${release_id}" \
  CI=1 \
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  NODE_ENV=production \
  NODE_OPTIONS=--max-old-space-size=1536 \
  corepack pnpm build

[[ -f "${next_environment_path}" && ! -L "${next_environment_path}" &&
  -f "${next_environment_snapshot}" && ! -L "${next_environment_snapshot}" ]] || {
  echo "next-env restore inputs must remain regular files" >&2
  exit 70
}
cp -p -- "${next_environment_snapshot}" "${next_environment_path}"
rm -f -- "${next_environment_snapshot}"

for artifact in \
  .next/BUILD_ID \
  .next/required-server-files.json \
  .next/server/app-paths-manifest.json; do
  [[ -r "${artifact}" ]] || {
    echo "required build artifact is missing: ${artifact}" >&2
    exit 70
  }
done

post_build_input_digest="$(
  node scripts/deploy/release-input-manifest.mjs \
    verify "${release_id}" "${manifest_path}"
)"
[[ "${post_build_input_digest}" == "${input_digest}" ]] || {
  echo "tracked release inputs changed during the build" >&2
  exit 70
}

artifact_digest="$(
  node scripts/deploy/release-artifact-manifest.mjs \
    create "${release_id}" .build-complete
)"
[[ "${artifact_digest}" =~ ^[0-9a-f]{64}$ ]] || {
  echo "release artifact verifier did not return a SHA-256 digest" >&2
  exit 70
}
