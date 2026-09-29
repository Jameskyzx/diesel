import type { ApplicationScope } from "@/features/database/schemas";

export type ProductFitNavigationFilters = Readonly<{
  applicationScope?: ApplicationScope;
  asOf?: string;
  powerKw?: number;
  productModelCode?: string;
}>;

/** A key for already-validated, canonical route inputs, not raw URL input. */
export function buildProductFitRouteKey({
  countryIso3,
  asOf,
  initialFilters,
}: {
  countryIso3: string;
  /** The available server response's resolved date. */
  asOf: string;
  initialFilters?: ProductFitNavigationFilters;
}): string {
  return JSON.stringify([
    countryIso3,
    initialFilters?.asOf ?? asOf,
    initialFilters?.applicationScope ?? null,
    initialFilters?.powerKw ?? null,
    initialFilters?.productModelCode ?? null,
  ]);
}

export const MAX_PRODUCT_FIT_PENDING_NAVIGATIONS = 8;

export type ProductFitNavigationState = Readonly<{
  routeKey: string;
  /** Unique ownership for route-bound summaries, errors and committed filters. */
  routeRevision: number;
  /** Changes only when the product form must acquire a new navigation owner. */
  panelGeneration: number;
  /** null fails closed after overflow until a different route is reconciled. */
  pendingOwnRouteKeys: readonly string[] | null;
}>;

export function createProductFitNavigationState(
  routeKey: string,
): ProductFitNavigationState {
  return {
    routeKey,
    routeRevision: 0,
    panelGeneration: 0,
    pendingOwnRouteKeys: [],
  };
}

/** Record a validated successful evaluation immediately before its replace. */
export function recordProductFitOwnNavigation(
  state: ProductFitNavigationState,
  targetKey: string,
): ProductFitNavigationState {
  const pending = state.pendingOwnRouteKeys;
  if (
    pending === null ||
    (pending.length === 0 && targetKey === state.routeKey) ||
    pending[pending.length - 1] === targetKey
  ) {
    return state;
  }

  // Dropping only the oldest entry could incorrectly preserve a later stale
  // acknowledgement. Stop trusting all acknowledgements until a new route.
  if (pending.length >= MAX_PRODUCT_FIT_PENDING_NAVIGATIONS) {
    return { ...state, pendingOwnRouteKeys: null };
  }

  return { ...state, pendingOwnRouteKeys: [...pending, targetKey] };
}

/**
 * Reconcile a committed canonical destination, not stale props while navigating.
 * Pass external once for an explicit external navigation (including popstate),
 * even if its destination matches an outstanding own target. The caller owns
 * immediate request cancellation and any loading gate before that commit.
 */
export function reconcileProductFitNavigation(
  state: ProductFitNavigationState,
  nextKey: string,
  { external = false }: { external?: boolean } = {},
): ProductFitNavigationState {
  if (!external && nextKey === state.routeKey) {
    return state;
  }

  const ownIndex = external
    ? -1
    : (state.pendingOwnRouteKeys?.indexOf(nextKey) ?? -1);
  const isOwnAcknowledgement = ownIndex >= 0;

  return {
    routeKey: nextKey,
    // An own acknowledgement also retires the previous summary owner. A key
    // returning from A to B to A must never revive state saved during first A.
    routeRevision: state.routeRevision + 1,
    panelGeneration: state.panelGeneration + (isOwnAcknowledgement ? 0 : 1),
    // A coalesced navigation may acknowledge a later queued target first.
    pendingOwnRouteKeys: isOwnAcknowledgement
      ? state.pendingOwnRouteKeys!.slice(ownIndex + 1)
      : [],
  };
}
