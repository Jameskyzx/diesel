#!/usr/bin/env bash
set -euo pipefail

origin="${1:-}"
expected_version="${2:-}"
local_origin=false

if [[ "${origin}" =~ ^http://127\.0\.0\.1:([0-9]{1,5})$ ]]; then
  origin_port="${BASH_REMATCH[1]}"
  if ((10#${origin_port} < 1 || 10#${origin_port} > 65535)); then
    echo "loopback origin port must be between 1 and 65535" >&2
    exit 64
  fi
  local_origin=true
elif [[ "${origin}" != "https://diesel.jamesky.site" ]]; then
  echo "usage: verify-release.sh <http://127.0.0.1:PORT|https://diesel.jamesky.site> <expected-version>" >&2
  exit 64
fi
[[ "${expected_version}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "expected version must be a full lowercase Git commit SHA" >&2
  exit 64
}

verify_release_script_dir="$(
  CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P
)"
release_root="$(
  CDPATH= cd -- "${verify_release_script_dir}/../.." && pwd -P
)"
public_products_validator="${verify_release_script_dir}/validate-public-products.ts"
readiness_response_validator="${verify_release_script_dir}/readiness-response-contract.cjs"
[[ -f "${public_products_validator}" && ! -L "${public_products_validator}" ]] || {
  echo "public product release validator is missing or is a symlink" >&2
  exit 70
}
[[ -f "${readiness_response_validator}" && ! -L "${readiness_response_validator}" ]] || {
  echo "readiness response validator is missing or is a symlink" >&2
  exit 70
}

curl_common=(
  --disable
  --connect-timeout 10
  --fail
  --max-time 30
  --noproxy '*'
  --retry 2
  --show-error
  --silent
)
if [[ "${local_origin}" == true ]]; then
  curl_common+=(--proto '=http')
else
  curl_common+=(--proto '=https')
fi

readonly max_json_response_bytes=65536
readonly max_html_response_bytes=4194304
readonly max_sse_response_bytes=1048576
readonly health_max_clock_skew_ms=5000

verification_dir="$(mktemp -d)"
cookie_jar="${verification_dir}/cookies.txt"
liveness_headers="${verification_dir}/liveness-headers.txt"
readiness_headers="${verification_dir}/readiness-headers.txt"
locale_headers="${verification_dir}/locale-headers.txt"
locale_body="${verification_dir}/locale-body.json"
chat_headers="${verification_dir}/chat-headers.txt"
chat_body="${verification_dir}/chat.sse"

cleanup() {
  rm -f -- \
    "${cookie_jar}" \
    "${liveness_headers}" \
    "${readiness_headers}" \
    "${locale_headers}" \
    "${locale_body}" \
    "${chat_headers}" \
    "${chat_body}"
  rmdir -- "${verification_dir}" 2>/dev/null || true
}
trap cleanup EXIT

verify_health_payload() {
  local route="$1"
  local payload_kind="$2"
  local health_headers_path
  local health_request_started_at_ms

  if [[ "${payload_kind}" == liveness ]]; then
    health_headers_path="${liveness_headers}"
  elif [[ "${payload_kind}" == readiness ]]; then
    health_headers_path="${readiness_headers}"
  else
    echo "unknown health payload kind" >&2
    return 70
  fi

  health_request_started_at_ms="$(
    node -e 'process.stdout.write(String(Date.now()))'
  )"
  [[ "${health_request_started_at_ms}" =~ ^[0-9]+$ ]] || {
    echo "health request clock returned an invalid timestamp" >&2
    return 70
  }

  curl "${curl_common[@]}" \
    --dump-header "${health_headers_path}" \
    --max-filesize "${max_json_response_bytes}" \
    "${origin}${route}" |
    EXPECTED_APP_VERSION="${expected_version}" \
      EXPECTED_CACHE_CONTROL="private, no-store, max-age=0" \
      EXPECTED_PRAGMA="no-cache" \
      HEALTH_MAX_CLOCK_SKEW_MS="${health_max_clock_skew_ms}" \
      HEALTH_HEADERS_PATH="${health_headers_path}" \
      HEALTH_PAYLOAD_KIND="${payload_kind}" \
      HEALTH_REQUEST_STARTED_AT_MS="${health_request_started_at_ms}" \
      READINESS_RESPONSE_VALIDATOR="${readiness_response_validator}" \
      node -e '
        const { readFileSync } = require("node:fs");
        const chunks = [];
        process.stdin.on("data", (chunk) => chunks.push(chunk));
        process.stdin.on("end", () => {
          const bodyText = Buffer.concat(chunks).toString("utf8");
          const rawHeaderText = readFileSync(
            process.env.HEALTH_HEADERS_PATH, "utf8",
          );
          const payloadKind = process.env.HEALTH_PAYLOAD_KIND;
          if (payloadKind === "readiness") {
            const contract = require(
              process.env.READINESS_RESPONSE_VALIDATOR,
            );
            contract.validateReadinessResponseV1({
              bodyText,
              contractVersion: contract.READINESS_RESPONSE_CONTRACT_VERSION,
              expectedVersion: process.env.EXPECTED_APP_VERSION,
              rawHeaders: rawHeaderText,
              requestStartedAtMs: Number(
                process.env.HEALTH_REQUEST_STARTED_AT_MS,
              ),
              responseReceivedAtMs: Date.now(),
            });
            return;
          }
          const body = JSON.parse(bodyText);
          const rawHeaders = rawHeaderText.replace(/\r\n/gu, "\n").trim();
          const finalHeaderBlock = rawHeaders.split(/\n\n+/u).at(-1) ?? "";
          const headerLines = finalHeaderBlock.split("\n").slice(1);
          const headerValues = (name) => headerLines.flatMap((line) => {
            const separator = line.indexOf(":");
            return separator > 0 &&
                line.slice(0, separator).trim().toLowerCase() === name
              ? [line.slice(separator + 1).trim()]
              : [];
          });
          const cacheControlValues = headerValues("cache-control");
          const pragmaValues = headerValues("pragma");
          const cachePolicyValid =
            cacheControlValues.length === 1 &&
            cacheControlValues[0] === process.env.EXPECTED_CACHE_CONTROL &&
            pragmaValues.length === 1 &&
            pragmaValues[0] === process.env.EXPECTED_PRAGMA;
          const requestStartedAtMs = Number(
            process.env.HEALTH_REQUEST_STARTED_AT_MS,
          );
          const responseReceivedAtMs = Date.now();
          const maxClockSkewMs = Number(process.env.HEALTH_MAX_CLOCK_SKEW_MS);
          const timestampMs = typeof body.timestamp === "string"
            ? Date.parse(body.timestamp)
            : Number.NaN;
          const canonicalTimestamp = Number.isFinite(timestampMs) &&
            new Date(timestampMs).toISOString() === body.timestamp;
          const timestampInRequestWindow = canonicalTimestamp &&
            Number.isSafeInteger(requestStartedAtMs) &&
            Number.isSafeInteger(maxClockSkewMs) &&
            maxClockSkewMs >= 0 &&
            timestampMs >= requestStartedAtMs - maxClockSkewMs &&
            timestampMs <= responseReceivedAtMs + maxClockSkewMs;
          const commonPayloadValid =
            cachePolicyValid &&
            body.service === "global-diesel-regulations" &&
            body.status === "ok" &&
            body.version === process.env.EXPECTED_APP_VERSION &&
            timestampInRequestWindow;
          const shapeValid = payloadKind === "liveness" && commonPayloadValid;
          if (!shapeValid) {
            throw new Error(`Unexpected application ${payloadKind} payload`);
          }
        });
      '
}

verify_health_payload "/api/health" liveness
verify_health_payload "/api/health/ready" readiness

# The public portfolio currently approves no real products. Keep this check in
# the atomic release verifier instead of waiting for the scheduled canary: a
# missing endpoint, malformed canonical DTO, additional model, or Demo entity,
# source, specification, or classification drift must stop activation before
# any page or chat acceptance.
curl "${curl_common[@]}" \
  --max-filesize "${max_json_response_bytes}" \
  "${origin}/api/products" |
  (
    cd -- "${release_root}"
    node --conditions=react-server --import tsx \
      "${public_products_validator}"
  )

verify_html_lang() {
  local route="$1"
  local expected_locale="$2"
  shift 2

  curl "${curl_common[@]}" \
    --max-filesize "${max_html_response_bytes}" \
    "$@" "${origin}${route}" |
    EXPECTED_LOCALE="${expected_locale}" EXPECTED_ROUTE="${route}" node -e '
      const chunks = [];
      process.stdin.on("data", (chunk) => chunks.push(chunk));
      process.stdin.on("end", () => {
        const html = Buffer.concat(chunks).toString("utf8");
        const locale = process.env.EXPECTED_LOCALE;
        const route = process.env.EXPECTED_ROUTE;
        const pattern = locale === "en"
          ? /<html\b[^>]*\blang\s*=\s*["\x27]en["\x27][^>]*>/iu
          : /<html\b[^>]*\blang\s*=\s*["\x27]zh-CN["\x27][^>]*>/iu;
        if (!pattern.test(html)) {
          throw new Error(`Expected ${route} to render <html lang="${locale}">`);
        }
      });
    '
}

for route in / /map /chat /countries/CHN; do
  verify_html_lang "${route}" en
done

curl "${curl_common[@]}" \
  --cookie-jar "${cookie_jar}" \
  --data-binary '{"locale":"zh-CN"}' \
  --dump-header "${locale_headers}" \
  --header "content-type: application/json" \
  --max-filesize "${max_json_response_bytes}" \
  --output "${locale_body}" \
  --request POST \
  "${origin}/api/preferences/locale"

LOCALE_BODY_PATH="${locale_body}" \
  LOCALE_COOKIE_PATH="${cookie_jar}" \
  LOCALE_HEADERS_PATH="${locale_headers}" \
  node -e '
    const { readFileSync } = require("node:fs");
    const body = JSON.parse(readFileSync(process.env.LOCALE_BODY_PATH, "utf8"));
    if (body.locale !== "zh-CN" || body.status !== "ok") {
      throw new Error("Unexpected locale preference response");
    }

    const headers = readFileSync(process.env.LOCALE_HEADERS_PATH, "utf8");
    const localeCookieHeader = headers
      .split(/\r?\n/u)
      .filter((line) => /^set-cookie:/iu.test(line))
      .map((line) => line.replace(/^set-cookie:\s*/iu, ""))
      .find((line) => /^diesel_locale=zh-CN(?:;|$)/u.test(line));
    if (!localeCookieHeader) {
      throw new Error("Locale preference response did not set diesel_locale=zh-CN");
    }
    const attributes = new Set(
      localeCookieHeader
        .split(";")
        .slice(1)
        .map((attribute) => attribute.trim().toLowerCase()),
    );
    for (const requiredAttribute of [
      "max-age=31536000",
      "path=/",
      "samesite=lax",
      "secure",
    ]) {
      if (!attributes.has(requiredAttribute)) {
        throw new Error(`Locale preference cookie is missing ${requiredAttribute}`);
      }
    }

    const cookieLines = readFileSync(process.env.LOCALE_COOKIE_PATH, "utf8")
      .split(/\r?\n/u)
      .filter((line) => line && (!line.startsWith("#") || line.startsWith("#HttpOnly_")));
    const persisted = cookieLines.some((line) => {
      const fields = line.split("\t");
      return fields[2] === "/" &&
        fields[3] === "TRUE" &&
        fields.at(-2) === "diesel_locale" &&
        fields.at(-1) === "zh-CN";
    });
    if (!persisted) {
      throw new Error("curl did not persist the secure diesel_locale preference cookie");
    }
  '

locale_cookie_args=(--cookie "${cookie_jar}")
if [[ "${local_origin}" == true ]]; then
  # Production correctly marks the preference Secure. The internal health URL
  # is HTTP-only, so present the already-validated value explicitly instead of
  # relying on curl version-specific loopback handling for Secure cookies.
  locale_cookie_args=(--header "cookie: diesel_locale=zh-CN")
fi

for route in / /map /chat /countries/CHN; do
  verify_html_lang "${route}" zh-CN "${locale_cookie_args[@]}"
done

# This capability request is answered by the deterministic direct-response path.
# It verifies the public UI-message SSE contract without invoking the configured
# model provider.
curl "${curl_common[@]}" \
  --data-binary '{"locale":"en","messages":[{"id":"release-verification","parts":[{"text":"What can you do?","type":"text"}],"role":"user"}],"sessionId":"00000000-0000-4000-8000-000000000001"}' \
  --dump-header "${chat_headers}" \
  --header "accept: text/event-stream" \
  --header "content-type: application/json" \
  --max-filesize "${max_sse_response_bytes}" \
  --output "${chat_body}" \
  --request POST \
  "${origin}/api/chat"

CHAT_BODY_PATH="${chat_body}" CHAT_HEADERS_PATH="${chat_headers}" node -e '
  const { readFileSync } = require("node:fs");
  const headers = readFileSync(process.env.CHAT_HEADERS_PATH, "utf8");
  if (!/(?:^|\r?\n)content-type:\s*text\/event-stream(?:\s*;|\r?$)/imu.test(headers)) {
    throw new Error("Chat verification did not return text/event-stream");
  }
  if (!/(?:^|\r?\n)x-vercel-ai-ui-message-stream:\s*v1\s*$/imu.test(headers)) {
    throw new Error("Chat verification did not return the UI message stream v1 header");
  }

  const body = readFileSync(process.env.CHAT_BODY_PATH, "utf8").replace(/\r\n/gu, "\n");
  const payloads = body
    .split(/\n\n+/u)
    .map((block) => block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /u, ""))
      .join("\n"))
    .filter(Boolean);

  let sawDone = false;
  let sawFinish = false;
  let sawStart = false;
  let sawTextDelta = false;
  const openTextIds = new Set();

  for (const payload of payloads) {
    if (payload === "[DONE]") {
      if (sawDone) {
        throw new Error("Chat verification returned more than one [DONE] event");
      }
      if (!sawFinish || openTextIds.size !== 0) {
        throw new Error("Chat verification returned [DONE] before a valid finish event");
      }
      sawDone = true;
      continue;
    }
    if (sawDone) {
      throw new Error("Chat verification returned an event after [DONE]");
    }
    if (sawFinish) {
      throw new Error("Chat verification returned an event after finish");
    }

    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      throw new Error("Chat verification returned an invalid JSON SSE event");
    }
    if (typeof event !== "object" || event === null || Array.isArray(event)) {
      throw new Error("Chat verification returned a non-object SSE event");
    }
    if (typeof event.type === "string" && event.type.startsWith("reasoning")) {
      throw new Error(`Chat verification exposed a forbidden ${event.type} part`);
    }
    if (event.type === "abort" || event.type === "error") {
      throw new Error(`Chat verification returned a terminal ${event.type} part`);
    }
    if (!sawStart && event.type !== "start") {
      throw new Error("Chat verification must begin with a start event");
    }
    if (event.type === "start") {
      if (sawStart) {
        throw new Error("Chat verification returned more than one start event");
      }
      sawStart = true;
    } else if (event.type === "text-start") {
      if (
        typeof event.id !== "string" ||
        event.id.length === 0 ||
        openTextIds.has(event.id)
      ) {
        throw new Error("Chat verification returned a duplicate text-start event");
      }
      openTextIds.add(event.id);
    } else if (event.type === "text-delta") {
      if (
        typeof event.id !== "string" ||
        !openTextIds.has(event.id) ||
        typeof event.delta !== "string" ||
        event.delta.length === 0
      ) {
        throw new Error("Chat verification returned an invalid text-delta event");
      }
      sawTextDelta = true;
    } else if (event.type === "text-end") {
      if (typeof event.id !== "string" || !openTextIds.delete(event.id)) {
        throw new Error("Chat verification returned an unmatched text-end event");
      }
    } else if (event.type === "finish") {
      if (event.finishReason !== "stop") {
        throw new Error("Chat verification returned a non-stop finish reason");
      }
      if (!sawTextDelta || openTextIds.size !== 0) {
        throw new Error("Chat verification returned finish before closing its text stream");
      }
      sawFinish = true;
    } else {
      throw new Error(`Chat verification returned an unknown ${String(event.type)} event`);
    }
  }

  if (!sawStart || !sawTextDelta || !sawFinish || !sawDone || openTextIds.size !== 0) {
    throw new Error("Chat verification returned an incomplete UI message text stream");
  }
'
