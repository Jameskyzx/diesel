import { NextResponse, type NextRequest } from "next/server";

import { parseCountryFilters } from "@/features/countries/url-context";
import { iso3Schema } from "@/features/database/schemas";
import { countryCatalog } from "@/server/db/seed/country-catalog";

const knownCountryIso3s = new Set(countryCatalog.map(({ iso3 }) => iso3));

/** Normalize country URLs before an RSC render starts. The page retains the
 * same validation as a defensive boundary; unknown countries still reach 404.
 */
export function proxy(request: NextRequest) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return NextResponse.next();
  }

  const match = /^\/countries\/([^/]+)$/.exec(request.nextUrl.pathname);
  if (!match) return NextResponse.next();

  let rawIso3: string;
  try {
    rawIso3 = decodeURIComponent(match[1]);
  } catch {
    return NextResponse.next();
  }
  const iso3 = iso3Schema.safeParse(rawIso3);
  if (!iso3.success || !knownCountryIso3s.has(iso3.data)) {
    return NextResponse.next();
  }

  // Object.fromEntries creates own data properties even for __proto__.
  // Keep every value so the shared parser can apply first-known/all-unknown
  // semantics. Next removes its internal _rsc query before invoking proxy;
  // leave Flight URL/header handling to the framework's default adapter.
  const params = request.nextUrl.searchParams;
  const raw = Object.fromEntries(
    [...new Set(params.keys())].map((key) => [key, params.getAll(key)]),
  );
  const { canonicalQuery, needsRedirect } = parseCountryFilters(raw);
  if (rawIso3 === iso3.data && !needsRedirect) {
    return NextResponse.next();
  }

  const destination = request.nextUrl.clone();
  destination.pathname = `/countries/${iso3.data}`;
  destination.search = canonicalQuery;
  destination.hash = "";
  return NextResponse.redirect(destination, 307);
}

export const config = { matcher: "/countries/:iso3" };
