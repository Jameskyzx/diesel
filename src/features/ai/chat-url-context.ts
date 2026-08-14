import { z } from "zod";

import {
  applicationScopeSchema,
  iso3Schema,
  isoDateSchema,
  powerKwSchema,
  type ApplicationScope,
} from "@/features/database/schemas";

export type ChatUrlContext = {
  applicationScope?: ApplicationScope;
  asOf?: string;
  countryIso3?: string;
  powerKw?: number;
  productModelCode?: string;
};

const productModelCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .transform((value) => value.toUpperCase());

const knownContextKeys = [
  "applicationScope",
  "asOf",
  "countryIso3",
  "powerKw",
  "productModelCode",
] as const;

function firstParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function appendRawParams(
  params: URLSearchParams,
  key: string,
  value: string | string[] | undefined,
): void {
  if (value === undefined) {
    return;
  }
  for (const item of Array.isArray(value) ? value : [value]) {
    params.append(key, item);
  }
}

export function parseChatUrlContext(
  raw: Record<string, string | string[] | undefined>,
): {
  canonicalQuery: string;
  context: ChatUrlContext;
  needsRedirect: boolean;
} {
  const parsers = {
    applicationScope: applicationScopeSchema,
    asOf: isoDateSchema,
    countryIso3: iso3Schema,
    powerKw: powerKwSchema,
    productModelCode: productModelCodeSchema,
  } as const;
  const canonical = new URLSearchParams();
  const original = new URLSearchParams();
  const context: ChatUrlContext = {};

  for (const key of knownContextKeys) {
    const rawValue = raw[key];
    if (rawValue === undefined) {
      continue;
    }
    appendRawParams(original, key, rawValue);
    const parsed = parsers[key].safeParse(firstParam(rawValue));
    if (!parsed.success) {
      continue;
    }

    if (key === "powerKw") {
      context.powerKw = parsed.data as number;
      canonical.set(key, String(parsed.data));
    } else if (key === "applicationScope") {
      context.applicationScope = parsed.data as ApplicationScope;
      canonical.set(key, parsed.data as string);
    } else {
      const value = parsed.data as string;
      context[key] = value;
      canonical.set(key, value);
    }
  }

  for (const [key, value] of Object.entries(raw)) {
    if (!(knownContextKeys as readonly string[]).includes(key)) {
      appendRawParams(canonical, key, value);
      appendRawParams(original, key, value);
    }
  }

  return {
    canonicalQuery: canonical.toString(),
    context,
    needsRedirect: canonical.toString() !== original.toString(),
  };
}
