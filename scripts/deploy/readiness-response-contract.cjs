"use strict";

const READINESS_RESPONSE_CONTRACT_VERSION =
  "diesel-readiness-response-v1";
const HEALTH_CLOCK_TOLERANCE_MS = 5_000;
const MAX_READINESS_BODY_BYTES = 65_536;
const MAX_READINESS_HEADER_BYTES = 65_536;
const EXPECTED_TOP_LEVEL_KEYS = Object.freeze([
  "checks",
  "service",
  "status",
  "timestamp",
  "version",
]);
const EXPECTED_CHECK_KEYS = Object.freeze([
  "aiChatAdmission",
  "aiChatRateLimit",
  "database",
]);

function invalidReadiness() {
  return new Error("Unexpected application readiness payload.");
}

function isPlainRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  if (!isPlainRecord(value)) return false;
  const actualKeys = Object.keys(value).sort();
  return actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index]);
}

function parseFinalHeaders(rawHeaders) {
  if (
    typeof rawHeaders !== "string" ||
    Buffer.byteLength(rawHeaders, "utf8") > MAX_READINESS_HEADER_BYTES ||
    rawHeaders.includes("\0")
  ) {
    throw invalidReadiness();
  }
  const normalized = rawHeaders.replace(/\r\n/gu, "\n");
  if (normalized.includes("\r")) throw invalidReadiness();
  const finalBlock = normalized.trim().split(/\n\n+/u).at(-1) ?? "";
  const lines = finalBlock.split("\n");
  if (!/^HTTP\/(?:1\.[01]|2|3) 200(?: |$)/u.test(lines[0] ?? "")) {
    throw invalidReadiness();
  }

  const values = new Map();
  for (const line of lines.slice(1)) {
    if (line.length === 0) continue;
    if (/^[ \t]/u.test(line)) throw invalidReadiness();
    const separator = line.indexOf(":");
    if (separator <= 0) throw invalidReadiness();
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    const existing = values.get(name) ?? [];
    existing.push(value);
    values.set(name, existing);
  }
  return values;
}

function validateReadinessResponseV1({
  bodyText,
  contractVersion,
  expectedVersion,
  rawHeaders,
  requestStartedAtMs,
  responseReceivedAtMs,
}) {
  try {
    if (
      contractVersion !== READINESS_RESPONSE_CONTRACT_VERSION ||
      typeof bodyText !== "string" ||
      Buffer.byteLength(bodyText, "utf8") > MAX_READINESS_BODY_BYTES ||
      !/^[0-9a-f]{40}$/u.test(expectedVersion) ||
      !Number.isSafeInteger(requestStartedAtMs) ||
      requestStartedAtMs < 0 ||
      !Number.isSafeInteger(responseReceivedAtMs) ||
      responseReceivedAtMs < requestStartedAtMs
    ) {
      throw invalidReadiness();
    }

    const body = JSON.parse(bodyText);
    if (
      !hasExactKeys(body, EXPECTED_TOP_LEVEL_KEYS) ||
      !hasExactKeys(body.checks, EXPECTED_CHECK_KEYS) ||
      body.service !== "global-diesel-regulations" ||
      body.status !== "ok" ||
      body.version !== expectedVersion ||
      body.checks.aiChatAdmission !== "ok" ||
      body.checks.aiChatRateLimit !== "ok" ||
      body.checks.database !== "ok" ||
      typeof body.timestamp !== "string"
    ) {
      throw invalidReadiness();
    }

    const timestampMs = Date.parse(body.timestamp);
    if (
      !Number.isFinite(timestampMs) ||
      new Date(timestampMs).toISOString() !== body.timestamp ||
      timestampMs < requestStartedAtMs - HEALTH_CLOCK_TOLERANCE_MS ||
      timestampMs > responseReceivedAtMs + HEALTH_CLOCK_TOLERANCE_MS
    ) {
      throw invalidReadiness();
    }

    const headers = parseFinalHeaders(rawHeaders);
    const cacheControl = headers.get("cache-control") ?? [];
    const pragma = headers.get("pragma") ?? [];
    if (
      cacheControl.length !== 1 ||
      cacheControl[0] !== "private, no-store, max-age=0" ||
      pragma.length !== 1 ||
      pragma[0] !== "no-cache"
    ) {
      throw invalidReadiness();
    }
  } catch {
    throw invalidReadiness();
  }
}

module.exports = Object.freeze({
  HEALTH_CLOCK_TOLERANCE_MS,
  READINESS_RESPONSE_CONTRACT_VERSION,
  validateReadinessResponseV1,
});
