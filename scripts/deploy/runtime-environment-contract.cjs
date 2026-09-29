"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */

const { isUtf8 } = require("node:buffer");
const { timingSafeEqual } = require("node:crypto");
const {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} = require("node:fs");
const { parseEnv } = require("node:util");

const AI_CHAT_ADMISSION_UNITS_PER_REQUEST = 5;
const MAX_AI_CHAT_ADMISSION_UNITS = 2_000_000_000;
const AI_CHAT_RATE_LIMIT_CLIENT_DEFAULT_PER_HOUR = 30;
const AI_CHAT_RATE_LIMIT_GLOBAL_DEFAULT_PER_HOUR = 10_000;
const MAX_AI_CHAT_RATE_LIMIT_PER_HOUR = 10_000;
const CLIENT_LIMIT_NAME =
  "AI_CHAT_ADMISSION_CLIENT_PROVIDER_CALL_UNITS_PER_DAY";
const GLOBAL_LIMIT_NAME =
  "AI_CHAT_ADMISSION_GLOBAL_PROVIDER_CALL_UNITS_PER_DAY";
const CLIENT_HOURLY_LIMIT_NAME = "AI_CHAT_RATE_LIMIT_PER_HOUR";
const GLOBAL_HOURLY_LIMIT_NAME =
  "AI_CHAT_RATE_LIMIT_GLOBAL_PER_HOUR";
const RATE_LIMIT_BACKEND_NAME = "AI_CHAT_RATE_LIMIT_BACKEND";
const PRODUCTION_AI_ADMISSION_CONTRACT = Object.freeze({
  maxUnitsPerDay: MAX_AI_CHAT_ADMISSION_UNITS,
  unitsPerRequest: AI_CHAT_ADMISSION_UNITS_PER_REQUEST,
});
const PRODUCTION_AI_CHAT_RATE_LIMIT_CONTRACT = Object.freeze({
  clientDefaultPerHour: AI_CHAT_RATE_LIMIT_CLIENT_DEFAULT_PER_HOUR,
  globalDefaultPerHour: AI_CHAT_RATE_LIMIT_GLOBAL_DEFAULT_PER_HOUR,
  maxPerHour: MAX_AI_CHAT_RATE_LIMIT_PER_HOUR,
});

const READBACK_ERROR_CODES = Object.freeze({
  AI_ADMISSION_INVALID: "AI_ADMISSION_INVALID",
  AI_RATE_LIMIT_INVALID: "AI_RATE_LIMIT_INVALID",
  DATABASE_IDENTITY_CHANGED: "DATABASE_IDENTITY_CHANGED",
  ENVIRONMENT_CONTENT_MISMATCH: "ENVIRONMENT_CONTENT_MISMATCH",
  ENVIRONMENT_READBACK_INVALID: "ENVIRONMENT_READBACK_INVALID",
});

class ProductionEnvironmentReadbackError extends Error {
  constructor(code) {
    super("Production environment readback validation failed.");
    this.code = code;
    this.name = "ProductionEnvironmentReadbackError";
  }
}

function invalidConfiguration() {
  return new Error("Production AI chat admission configuration is invalid.");
}

function invalidRateLimitConfiguration() {
  return new Error("Production AI chat rate-limit configuration is invalid.");
}

function parseAdmissionLimit(values, name) {
  const rawValue = values[name];
  if (typeof rawValue !== "string" || rawValue.length === 0) {
    throw invalidConfiguration();
  }

  const value = Number(rawValue);
  if (
    !Number.isSafeInteger(value) ||
    value < AI_CHAT_ADMISSION_UNITS_PER_REQUEST ||
    value > MAX_AI_CHAT_ADMISSION_UNITS ||
    value % AI_CHAT_ADMISSION_UNITS_PER_REQUEST !== 0
  ) {
    throw invalidConfiguration();
  }
  return value;
}

function validateProductionAiAdmissionConfiguration(values) {
  if (typeof values !== "object" || values === null || Array.isArray(values)) {
    throw invalidConfiguration();
  }

  const clientUnitsPerDay = parseAdmissionLimit(values, CLIENT_LIMIT_NAME);
  const globalUnitsPerDay = parseAdmissionLimit(values, GLOBAL_LIMIT_NAME);
  if (clientUnitsPerDay > globalUnitsPerDay) {
    throw invalidConfiguration();
  }
  const configuredBackend = values[RATE_LIMIT_BACKEND_NAME];
  if (configuredBackend !== undefined && configuredBackend !== "postgres") {
    throw invalidConfiguration();
  }

  return Object.freeze({ clientUnitsPerDay, globalUnitsPerDay });
}

function parseHourlyLimit(values, name, defaultValue) {
  const rawValue = values[name];
  if (rawValue === undefined || rawValue === "") return defaultValue;
  const value = Number(rawValue);
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_AI_CHAT_RATE_LIMIT_PER_HOUR
  ) {
    throw invalidRateLimitConfiguration();
  }
  return value;
}

function validateProductionAiChatRateLimitConfiguration(values) {
  if (typeof values !== "object" || values === null || Array.isArray(values)) {
    throw invalidRateLimitConfiguration();
  }

  const perClientLimitPerHour = parseHourlyLimit(
    values,
    CLIENT_HOURLY_LIMIT_NAME,
    AI_CHAT_RATE_LIMIT_CLIENT_DEFAULT_PER_HOUR,
  );
  const globalLimitPerHour = parseHourlyLimit(
    values,
    GLOBAL_HOURLY_LIMIT_NAME,
    AI_CHAT_RATE_LIMIT_GLOBAL_DEFAULT_PER_HOUR,
  );
  if (perClientLimitPerHour > globalLimitPerHour) {
    throw invalidRateLimitConfiguration();
  }
  const configuredBackend = values[RATE_LIMIT_BACKEND_NAME];
  if (configuredBackend !== undefined && configuredBackend !== "postgres") {
    throw invalidRateLimitConfiguration();
  }

  return Object.freeze({ globalLimitPerHour, perClientLimitPerHour });
}

function readStableEnvironmentFile({
  expectedGid,
  expectedMode,
  expectedUid,
  maxBytes,
  path,
}) {
  let descriptor;
  let failed = false;
  let result;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(descriptor, { bigint: true });
    if (
      !before.isFile() ||
      before.uid !== BigInt(expectedUid) ||
      before.gid !== BigInt(expectedGid) ||
      (before.mode & 0o7777n) !== BigInt(expectedMode) ||
      before.nlink !== 1n ||
      before.size <= 0n ||
      before.size > BigInt(maxBytes)
    ) {
      throw new Error();
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    for (const key of [
      "dev",
      "ino",
      "mode",
      "nlink",
      "uid",
      "gid",
      "size",
      "mtimeNs",
      "ctimeNs",
    ]) {
      if (before[key] !== after[key]) throw new Error();
    }
    if (BigInt(bytes.length) !== before.size || !isUtf8(bytes)) {
      throw new Error();
    }
    const values = parseEnv(bytes.toString("utf8"));
    const databaseUrl = values.DATABASE_URL;
    const protocol = new URL(databaseUrl ?? "").protocol;
    if (protocol !== "postgres:" && protocol !== "postgresql:") {
      throw new Error();
    }
    result = { bytes, databaseUrl, values };
  } catch {
    failed = true;
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        failed = true;
      }
    }
  }
  if (failed || result === undefined) {
    throw new ProductionEnvironmentReadbackError(
      READBACK_ERROR_CODES.ENVIRONMENT_READBACK_INVALID,
    );
  }
  return result;
}

function validateInstalledProductionEnvironmentFiles({
  backupPath,
  candidatePath,
  liveGid,
  livePath,
  maxBytes,
  ownerGid,
  ownerUid,
}) {
  if (
    !Number.isSafeInteger(ownerUid) ||
    ownerUid < 0 ||
    !Number.isSafeInteger(ownerGid) ||
    ownerGid < 0 ||
    !Number.isSafeInteger(liveGid) ||
    liveGid < 0 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1
  ) {
    throw new ProductionEnvironmentReadbackError(
      READBACK_ERROR_CODES.ENVIRONMENT_READBACK_INVALID,
    );
  }

  const backup = readStableEnvironmentFile({
    expectedGid: ownerGid,
    expectedMode: 0o600,
    expectedUid: ownerUid,
    maxBytes,
    path: backupPath,
  });
  const candidate = readStableEnvironmentFile({
    expectedGid: ownerGid,
    expectedMode: 0o600,
    expectedUid: ownerUid,
    maxBytes,
    path: candidatePath,
  });
  const live = readStableEnvironmentFile({
    expectedGid: liveGid,
    expectedMode: 0o640,
    expectedUid: ownerUid,
    maxBytes,
    path: livePath,
  });

  if (
    backup.databaseUrl !== candidate.databaseUrl ||
    backup.databaseUrl !== live.databaseUrl
  ) {
    throw new ProductionEnvironmentReadbackError(
      READBACK_ERROR_CODES.DATABASE_IDENTITY_CHANGED,
    );
  }
  if (
    candidate.bytes.length !== live.bytes.length ||
    !timingSafeEqual(candidate.bytes, live.bytes)
  ) {
    throw new ProductionEnvironmentReadbackError(
      READBACK_ERROR_CODES.ENVIRONMENT_CONTENT_MISMATCH,
    );
  }
  try {
    validateProductionAiAdmissionConfiguration(candidate.values);
    validateProductionAiAdmissionConfiguration(live.values);
  } catch {
    throw new ProductionEnvironmentReadbackError(
      READBACK_ERROR_CODES.AI_ADMISSION_INVALID,
    );
  }
  try {
    validateProductionAiChatRateLimitConfiguration(candidate.values);
    validateProductionAiChatRateLimitConfiguration(live.values);
  } catch {
    throw new ProductionEnvironmentReadbackError(
      READBACK_ERROR_CODES.AI_RATE_LIMIT_INVALID,
    );
  }
}

module.exports = Object.freeze({
  PRODUCTION_AI_ADMISSION_CONTRACT,
  PRODUCTION_AI_CHAT_RATE_LIMIT_CONTRACT,
  READBACK_ERROR_CODES,
  validateInstalledProductionEnvironmentFiles,
  validateProductionAiAdmissionConfiguration,
  validateProductionAiChatRateLimitConfiguration,
});
