import { describe, expect, it } from "vitest";

import { productFitHistoryRouteKey } from "@/features/product-fit/history-route";
import { buildProductFitRouteKey } from "@/features/product-fit/navigation-state";

const asOf = "2026-01-20";
const initialFilters = {
  applicationScope: "non-road" as const,
  asOf,
  powerKw: 100,
  productModelCode: "DEMO-ENG-100",
};
const expected = buildProductFitRouteKey({ countryIso3: "CHN", asOf, initialFilters });

describe("product-fit history target identity", () => {
  it.each([
    "/countries/CHN?applicationScope=non-road&asOf=2026-01-20&powerKw=100&productModelCode=DEMO-ENG-100",
    "/countries/chn?utm_term=engine&powerKw=100.0&productModelCode=demo-eng-100&applicationScope=non-road&asOf=2026-01-20&utm_term=export#sources",
    "/countries/CHN?applicationScope=non-road&powerKw=100&powerKw=150&productModelCode=DEMO-ENG-100",
  ])("matches normalized page filters: %s", (path) => {
    expect(productFitHistoryRouteKey(`https://example.test${path}`, asOf)).toBe(expected);
  });

  it("drops invalid fields individually without trusting a later duplicate", () => {
    expect(productFitHistoryRouteKey("https://example.test/countries/CHN?applicationScope=bad&asOf=2026-02-31&powerKw=bad&powerKw=100&productModelCode=%20", asOf)).toBe(
      buildProductFitRouteKey({ countryIso3: "CHN", asOf }),
    );
  });

  it("keeps absent product distinct from an explicit shared-link product", () => {
    expect(productFitHistoryRouteKey("https://example.test/countries/CHN?applicationScope=non-road&powerKw=100", asOf)).not.toBe(expected);
  });

  it.each(["not a URL", "https://example.test/map", "https://example.test/countries/%ZZ", "https://example.test/countries/CHINA"]) (
    "cannot match a different or malformed route: %s", (href) => {
      expect(productFitHistoryRouteKey(href, asOf)).toBeNull();
    },
  );
});
