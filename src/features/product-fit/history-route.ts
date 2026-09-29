import { countryDetailFiltersSchema, iso3Schema } from "@/features/database/schemas";

import { buildProductFitRouteKey } from "./navigation-state";

/** Only an identity gate; raw browser values never become evaluation inputs. */
export function productFitHistoryRouteKey(href: string, resolvedAsOf: string): string | null {
  try {
    const url = new URL(href);
    const path = /^\/countries\/([^/]+)\/?$/.exec(url.pathname);
    const country = iso3Schema.safeParse(path ? decodeURIComponent(path[1]) : undefined);
    if (!country.success) return null;
    const fields = countryDetailFiltersSchema.shape;
    // Match the page's per-field validation, first-value semantics and invalid
    // field removal, including a redirect from a noncanonical history entry.
    const scope = fields.applicationScope.safeParse(url.searchParams.get("applicationScope") ?? undefined);
    const date = fields.asOf.safeParse(url.searchParams.get("asOf") ?? undefined);
    const power = fields.powerKw.safeParse(url.searchParams.get("powerKw") ?? undefined);
    const product = fields.productModelCode.safeParse(url.searchParams.get("productModelCode") ?? undefined);
    return buildProductFitRouteKey({
      countryIso3: country.data,
      asOf: resolvedAsOf,
      initialFilters: {
        applicationScope: scope.success ? scope.data : undefined,
        asOf: date.success ? date.data : undefined,
        powerKw: power.success ? power.data : undefined,
        productModelCode: product.success ? product.data : undefined,
      },
    });
  } catch {
    return null;
  }
}
