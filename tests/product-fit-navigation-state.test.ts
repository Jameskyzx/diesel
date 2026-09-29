import { describe, expect, it } from "vitest";

import {
  buildProductFitRouteKey,
  createProductFitNavigationState,
  MAX_PRODUCT_FIT_PENDING_NAVIGATIONS,
  reconcileProductFitNavigation,
  recordProductFitOwnNavigation,
  type ProductFitNavigationFilters,
  type ProductFitNavigationState,
} from "@/features/product-fit/navigation-state";

const asOf = "2026-01-20";
const filters: ProductFitNavigationFilters = {
  applicationScope: "non-road",
  asOf,
  powerKw: 100,
  productModelCode: "DEMO-ENG-100",
};

function key(overrides: ProductFitNavigationFilters = {}): string {
  return buildProductFitRouteKey({
    asOf,
    countryIso3: "CHN",
    initialFilters: { ...filters, ...overrides },
  });
}

const a = key();
const b = key({ powerKw: 150 });
const c = key({ powerKw: 175 });

function freezeState(state: ProductFitNavigationState): ProductFitNavigationState {
  if (state.pendingOwnRouteKeys !== null) {
    Object.freeze(state.pendingOwnRouteKeys);
  }
  return Object.freeze(state);
}

describe("product-fit route identity", () => {
  it("equates an omitted date with the available response's resolved date", () => {
    expect(key({ asOf: undefined })).toBe(a);
  });

  it("ignores locale, unknown query fields and object property ordering", () => {
    const extended = {
      productModelCode: "DEMO-ENG-100",
      powerKw: 100,
      locale: "zh-CN",
      utm_source: "history-test",
      asOf,
      applicationScope: "non-road" as const,
    };
    expect(buildProductFitRouteKey({
      asOf,
      countryIso3: "CHN",
      initialFilters: extended,
    })).toBe(a);
  });

  it.each([
    { label: "power", change: { powerKw: 150 } },
    { label: "scope", change: { applicationScope: "marine" } },
    { label: "model", change: { productModelCode: "DEMO-ENG-200" } },
    { label: "date", change: { asOf: "2026-01-21" } },
    { label: "missing power", change: { powerKw: undefined } },
    { label: "missing scope", change: { applicationScope: undefined } },
    { label: "missing model", change: { productModelCode: undefined } },
  ] satisfies Array<{ label: string; change: ProductFitNavigationFilters }>)(
    "distinguishes a changed $label without guessing form defaults",
    ({ change }) => expect(key(change)).not.toBe(a),
  );

  it("includes country and supports an entirely missing filter object", () => {
    expect(buildProductFitRouteKey({
      asOf,
      countryIso3: "BRA",
      initialFilters: filters,
    })).not.toBe(a);
    expect(buildProductFitRouteKey({ asOf, countryIso3: "CHN" })).toBe(
      JSON.stringify(["CHN", asOf, null, null, null]),
    );
  });
});

describe("product-fit navigation ownership", () => {
  it("preserves the same object for same-identity refreshes and no-op commits", () => {
    const state = freezeState(createProductFitNavigationState(a));
    expect(reconcileProductFitNavigation(state, a)).toBe(state);
    expect(recordProductFitOwnNavigation(state, a)).toBe(state);
  });

  it("retires summary ownership on own acknowledgement without remounting the form", () => {
    const original = freezeState(createProductFitNavigationState(a));
    const pending = freezeState(recordProductFitOwnNavigation(original, b));
    expect(pending.routeRevision).toBe(0);
    expect(pending.panelGeneration).toBe(0);
    expect(reconcileProductFitNavigation(pending, a)).toBe(pending);

    const acknowledged = reconcileProductFitNavigation(pending, b);
    expect(acknowledged).toEqual({
      routeKey: b,
      routeRevision: 1,
      panelGeneration: 0,
      pendingOwnRouteKeys: [],
    });
    expect(original.pendingOwnRouteKeys).toEqual([]);
    expect(pending.pendingOwnRouteKeys).toEqual([b]);
  });

  it("does not resurrect first-A summary ownership when history returns from B", () => {
    const firstA = createProductFitNavigationState(a);
    const atB = reconcileProductFitNavigation(
      recordProductFitOwnNavigation(firstA, b),
      b,
    );
    const secondA = reconcileProductFitNavigation(atB, a, { external: true });
    expect(secondA.routeKey).toBe(firstA.routeKey);
    expect(secondA.routeRevision).toBe(2);
    expect(secondA.routeRevision).not.toBe(firstA.routeRevision);
    expect(secondA.panelGeneration).toBe(1);
    const forwardB = reconcileProductFitNavigation(secondA, b, { external: true });
    expect(forwardB.routeRevision).toBe(3);
    expect(forwardB.panelGeneration).toBe(2);
  });

  it.each([a, b, c])("explicit external navigation overrides own targets: %s", (target) => {
    const pending = recordProductFitOwnNavigation(createProductFitNavigationState(a), b);
    const next = reconcileProductFitNavigation(pending, target, { external: true });
    expect(next).toEqual({
      routeKey: target,
      routeRevision: 1,
      panelGeneration: 1,
      pendingOwnRouteKeys: [],
    });
  });

  it("treats an unregistered changed route as external and retires old intents", () => {
    const pending = recordProductFitOwnNavigation(createProductFitNavigationState(a), b);
    const next = reconcileProductFitNavigation(pending, c);
    expect(next.panelGeneration).toBe(1);
    expect(next.pendingOwnRouteKeys).toEqual([]);
    expect(reconcileProductFitNavigation(next, b).panelGeneration).toBe(2);
  });

  it("acknowledges consecutive own commits in order while preserving one form", () => {
    const pending = recordProductFitOwnNavigation(
      recordProductFitOwnNavigation(createProductFitNavigationState(a), b),
      c,
    );
    expect(recordProductFitOwnNavigation(pending, c)).toBe(pending);
    const atB = reconcileProductFitNavigation(freezeState(pending), b);
    expect(atB.pendingOwnRouteKeys).toEqual([c]);
    const atC = reconcileProductFitNavigation(atB, c);
    expect(atC.pendingOwnRouteKeys).toEqual([]);
    expect(atC.routeRevision).toBe(2);
    expect(atC.panelGeneration).toBe(0);
  });

  it("consumes a skipped acknowledgement prefix when Next coalesces own routes", () => {
    const pending = recordProductFitOwnNavigation(
      recordProductFitOwnNavigation(createProductFitNavigationState(a), b),
      c,
    );
    const atC = reconcileProductFitNavigation(pending, c);
    expect(atC.pendingOwnRouteKeys).toEqual([]);
    expect(atC.panelGeneration).toBe(0);
    // An older target is no longer trusted after its acknowledgement is consumed.
    expect(reconcileProductFitNavigation(atC, b).panelGeneration).toBe(1);
  });

  it("retains nonconsecutive repeated targets until their ordered acknowledgements", () => {
    let state = createProductFitNavigationState(a);
    for (const target of [b, c, b, a]) {
      state = recordProductFitOwnNavigation(state, target);
    }
    expect(state.pendingOwnRouteKeys).toEqual([b, c, b, a]);
    for (const target of [b, c, b, a]) {
      state = reconcileProductFitNavigation(state, target);
      expect(state.panelGeneration).toBe(0);
    }
    expect(state.pendingOwnRouteKeys).toEqual([]);
    expect(state.routeRevision).toBe(4);
  });

  it("fails closed after queue overflow without retaining unlimited or stale acknowledgements", () => {
    let state = createProductFitNavigationState(a);
    const targets = Array.from(
      { length: MAX_PRODUCT_FIT_PENDING_NAVIGATIONS },
      (_, index) => key({ powerKw: 200 + index }),
    );
    for (const target of targets) state = recordProductFitOwnNavigation(state, target);
    expect(state.pendingOwnRouteKeys).toHaveLength(MAX_PRODUCT_FIT_PENDING_NAVIGATIONS);
    expect(recordProductFitOwnNavigation(state, targets[targets.length - 1]!)).toBe(state);

    const overflowed = recordProductFitOwnNavigation(freezeState(state), b);
    expect(overflowed.pendingOwnRouteKeys).toBeNull();
    expect(recordProductFitOwnNavigation(overflowed, c)).toBe(overflowed);
    expect(reconcileProductFitNavigation(overflowed, a)).toBe(overflowed);

    const recovered = reconcileProductFitNavigation(overflowed, b);
    expect(recovered.panelGeneration).toBe(1);
    expect(recovered.pendingOwnRouteKeys).toEqual([]);
    const ownAgain = reconcileProductFitNavigation(
      recordProductFitOwnNavigation(recovered, c),
      c,
    );
    expect(ownAgain.panelGeneration).toBe(1);
  });
});
