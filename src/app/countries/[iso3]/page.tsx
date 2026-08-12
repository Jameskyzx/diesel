import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { CountryExplorer } from "@/components/countries/country-explorer";
import type { ProductFitInitialFilters } from "@/components/products/product-fit-panel";
import {
  applicationScopeSchema,
  iso3Schema,
  isoDateSchema,
  powerKwSchema,
} from "@/features/database/schemas";

type CountryPageProps = {
  params: Promise<{
    iso3: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({
  params,
}: CountryPageProps): Promise<Metadata> {
  const { iso3 } = await params;
  const parsed = iso3Schema.safeParse(iso3);

  return {
    title: parsed.success ? `${parsed.data} 国家详情` : "国家详情",
  };
}

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

const KNOWN_FILTER_KEYS = [
  "applicationScope",
  "asOf",
  "powerKw",
  "productModelCode",
] as const;

/**
 * ADR-010/044：查询参数服务端 Zod 校验。逐字段解析已知筛选键，
 * 无效值剔除并重定向到规范化 URL（而非整页 notFound——坏的筛选值
 * 不应让有效国家 404）；未知键（如分析参数）原样保留，不参与比较、
 * 不随重定向丢弃。规范化输出与原始已知键不同时重定向（如
 * `powerKw=300.0 → 300`、型号大写化）；iso3 大小写规范化与筛选
 * 规范化在同一次重定向中完成。
 */
function parseCountryFilters(
  raw: Record<string, string | string[] | undefined>,
): {
  canonicalQuery: string;
  filters: ProductFitInitialFilters;
  needsRedirect: boolean;
} {
  const scope = applicationScopeSchema.safeParse(
    firstParam(raw.applicationScope),
  );
  const asOf = isoDateSchema.safeParse(firstParam(raw.asOf));
  const power = powerKwSchema.safeParse(firstParam(raw.powerKw));
  const product = z
    .string()
    .trim()
    .min(1)
    .max(100)
    .safeParse(firstParam(raw.productModelCode));

  const canonical = new URLSearchParams();
  const rawKnown = new URLSearchParams();
  const filters: ProductFitInitialFilters = {};

  const rawScope = firstParam(raw.applicationScope);
  if (rawScope !== undefined) {
    appendRawParams(rawKnown, "applicationScope", raw.applicationScope);
    if (scope.success) {
      canonical.set("applicationScope", scope.data);
      filters.applicationScope = scope.data;
    }
  }
  const rawAsOf = firstParam(raw.asOf);
  if (rawAsOf !== undefined) {
    appendRawParams(rawKnown, "asOf", raw.asOf);
    if (asOf.success) {
      canonical.set("asOf", asOf.data);
      filters.asOf = asOf.data;
    }
  }
  const rawPower = firstParam(raw.powerKw);
  if (rawPower !== undefined) {
    appendRawParams(rawKnown, "powerKw", raw.powerKw);
    if (power.success) {
      canonical.set("powerKw", String(power.data));
      filters.powerKw = power.data;
    }
  }
  const rawProduct = firstParam(raw.productModelCode);
  if (rawProduct !== undefined) {
    appendRawParams(rawKnown, "productModelCode", raw.productModelCode);
    if (product.success) {
      canonical.set("productModelCode", product.data.toUpperCase());
      filters.productModelCode = product.data.toUpperCase();
    }
  }

  // 未知键原样保留在重定向目标中（兼容分析参数）。
  for (const [key, value] of Object.entries(raw)) {
    if (!(KNOWN_FILTER_KEYS as readonly string[]).includes(key)) {
      appendRawParams(canonical, key, value);
      appendRawParams(rawKnown, key, value);
    }
  }

  return {
    canonicalQuery: canonical.toString(),
    filters,
    needsRedirect: canonical.toString() !== rawKnown.toString(),
  };
}

export default async function CountryPage({
  params,
  searchParams,
}: CountryPageProps) {
  const { iso3 } = await params;
  const parsed = iso3Schema.safeParse(iso3);

  if (!parsed.success) {
    notFound();
  }

  const raw = await searchParams;
  const { canonicalQuery, filters, needsRedirect } = parseCountryFilters(raw);

  if (iso3 !== parsed.data || needsRedirect) {
    redirect(
      canonicalQuery
        ? `/countries/${parsed.data}?${canonicalQuery}`
        : `/countries/${parsed.data}`,
    );
  }

  return (
    <CountryExplorer
      initialCountryIso3={parsed.data}
      initialFilters={filters}
    />
  );
}
