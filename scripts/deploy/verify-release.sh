#!/usr/bin/env bash
set -euo pipefail

origin="${1:-}"
expected_version="${2:-}"

case "${origin}" in
  http://127.0.0.1:*|https://jamesky.site) ;;
  *)
    echo "usage: verify-release.sh <http://127.0.0.1:PORT|https://jamesky.site> <expected-version>" >&2
    exit 64
    ;;
esac
[[ "${expected_version}" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || {
  echo "expected version must be a safe, non-empty release identifier" >&2
  exit 64
}

curl_common=(
  --connect-timeout 10
  --fail
  --max-time 30
  --retry 2
  --show-error
  --silent
)

curl "${curl_common[@]}" "${origin}/api/health/ready" |
  EXPECTED_APP_VERSION="${expected_version}" node -e '
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (
        body.status !== "ok" ||
        body.checks?.database !== "ok" ||
        body.version !== process.env.EXPECTED_APP_VERSION
      ) {
        throw new Error("Unexpected application readiness payload");
      }
    });
  '

for route in / /map /chat /countries/CHN; do
  curl "${curl_common[@]}" --output /dev/null "${origin}${route}"
done
