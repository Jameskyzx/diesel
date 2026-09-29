import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { CountryExplorer } from "@/components/countries/country-explorer";
import { CountryInitialPanel } from "@/components/countries/country-initial-panel";
import { LocaleRenderReceipt } from "@/components/i18n/locale-controller";
import {
  iso3Schema,
  type CountryDetailQuery,
} from "@/features/database/schemas";
import { countryDirectoryDisplayIdentity } from "@/features/countries/directory-display";
import { parseCountryFilters } from "@/features/countries/url-context";
import { getDictionary, interpolate } from "@/i18n/dictionaries";
import { formatCountryDisplayName } from "@/i18n/country-name";
import { buildLocalizedOpenGraph } from "@/i18n/metadata";
import { getRequestLocale } from "@/i18n/server";
import { getErrorCode } from "@/lib/api-error";
import { runPublicDataRenderOperation } from "@/server/http/public-data-admission";
import {
  getCountryDirectory,
  isKnownCountryIso3,
} from "@/server/services/country-directory";
import {
  getCountryDetails,
  listCountryMapSummaries,
} from "@/server/services/country-service";

const COUNTRY_PAGE_DATA_ROUTE = "/countries/:iso3";
const COUNTRY_PAGE_DATA_UNAVAILABLE =
  "Country page data is temporarily unavailable.";

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
  const locale = await getRequestLocale();
  const dictionary = getDictionary(locale);

  if (!parsed.success) {
    return { title: dictionary.country.unknownCountryTitle };
  }

  const country = getCountryDirectory().find(
    ({ iso3: countryIso3 }) => countryIso3 === parsed.data,
  );
  if (!country) {
    return { title: dictionary.country.unknownCountryTitle };
  }

  const name = formatCountryDisplayName(
    countryDirectoryDisplayIdentity(country, undefined),
    locale,
  );
  const values = { iso3: country.iso3, name };
  const title = interpolate(dictionary.country.metadataTitle, values);
  const description = interpolate(
    dictionary.country.metadataDescription,
    values,
  );

  return {
    description,
    openGraph: buildLocalizedOpenGraph(locale, {
      description,
      imageAlt: dictionary.metadata.openGraphImageAlt,
      title,
    }),
    title,
  };
}

async function loadCountryPageData(
  input: CountryDetailQuery,
  signal: AbortSignal,
) {
  const [mapResult, detailResult] = await Promise.allSettled([
    listCountryMapSummaries({ signal }),
    getCountryDetails(input, { signal }),
  ]);

  // Do not let one rejected branch release the outer admission lease while
  // the sibling database branch is still running. Promise.allSettled above
  // observes both branches before either failure is propagated.
  if (mapResult.status === "rejected") {
    throw mapResult.reason;
  }
  if (detailResult.status === "rejected") {
    throw detailResult.reason;
  }

  return {
    initialCountryDetail: detailResult.value,
    initialMapResponse: mapResult.value,
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

  if (!isKnownCountryIso3(parsed.data)) {
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

  const operation = await runPublicDataRenderOperation({
    headers: await headers(),
    route: COUNTRY_PAGE_DATA_ROUTE,
    work: (signal) => loadCountryPageData({
      applicationScope: filters.applicationScope,
      asOf: filters.asOf,
      iso3: parsed.data,
      powerKw: filters.powerKw,
    }, signal),
  });
  if (operation.status !== "fulfilled") {
    console.error("Country page data request failed", {
      errorCode:
        operation.status === "failed"
          ? getErrorCode(operation.error)
          : `PUBLIC_DATA_${operation.status.toUpperCase()}`,
      route: COUNTRY_PAGE_DATA_ROUTE,
      status: operation.status,
    });
    throw new Error(COUNTRY_PAGE_DATA_UNAVAILABLE);
  }
  const { initialCountryDetail, initialMapResponse } = operation.value;
  const countryDirectory = getCountryDirectory();
  const locale = await getRequestLocale();
  const dictionary = getDictionary(locale);
  const directoryEntry = countryDirectory.find(
    ({ iso3: value }) => value === parsed.data,
  );
  if (!directoryEntry) {
    notFound();
  }

  return (
    <>
      <LocaleRenderReceipt locale={locale} />
      <CountryExplorer
        initialCountryDetail={initialCountryDetail}
        initialCountryIso3={parsed.data}
        initialCountryIndex={countryDirectory}
        initialCountryPanel={
          <CountryInitialPanel
            countryDirectoryEntry={directoryEntry}
            countrySummary={initialMapResponse.countries.find(
              ({ iso3: countryIso3 }) => countryIso3 === directoryEntry.iso3,
            )}
            detail={initialCountryDetail}
            dictionary={dictionary}
            hasGeometry={directoryEntry?.hasGeometry ?? false}
            locale={locale}
          />
        }
        initialFilters={filters}
        initialMapResponse={initialMapResponse}
      />
    </>
  );
}
