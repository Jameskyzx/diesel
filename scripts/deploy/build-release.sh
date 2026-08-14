#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -eq 0 ]]; then
  echo "release builds must run as the unprivileged diesel-build user" >&2
  exit 64
fi

release_id="${BUILD_RELEASE_ID:-}"
build_home="${BUILD_HOME:-}"
registry="${PNPM_REGISTRY:-https://registry.npmjs.org}"

[[ "${release_id}" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || {
  echo "BUILD_RELEASE_ID must be a safe, non-empty release identifier" >&2
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

corepack pnpm --config.registry="${registry}" \
  install --frozen-lockfile --trust-lockfile --package-import-method=copy

env -i \
  HOME="${build_home}" \
  PATH="${PATH}" \
  APP_VERSION="${release_id}" \
  CI=1 \
  NODE_ENV=production \
  corepack pnpm build

for artifact in \
  .next/BUILD_ID \
  .next/required-server-files.json \
  .next/server/app-paths-manifest.json; do
  [[ -r "${artifact}" ]] || {
    echo "required build artifact is missing: ${artifact}" >&2
    exit 70
  }
done

printf '%s\n' "${release_id}" > .build-complete
