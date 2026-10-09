import type { Metadata } from "next";
import { ComparisonWorkspace } from "@/components/analyses/comparison-workspace";
import { PageHeader } from "@/components/layout/page-header";
import { LocaleRenderReceipt } from "@/components/i18n/locale-controller";
import { parseComparisonQuery } from "@/features/analyses/schemas";
import { getDictionary } from "@/i18n/dictionaries";
import { getRequestLocale } from "@/i18n/server";
import { getCountryDirectory } from "@/server/services/country-directory";

export async function generateMetadata(): Promise<Metadata> {
  return { title: getDictionary(await getRequestLocale()).analysis.comparisonTitle };
}

export default async function ComparePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getRequestLocale();
  const copy = getDictionary(locale).analysis;
  const params = await searchParams;
  const countries = getCountryDirectory();
  const parsed = parseComparisonQuery(params);
  const query = parsed?.countryIso3s.every(iso3 => countries.some(country => country.iso3 === iso3)) ? parsed : null;
  return <main className="page-shell space-y-5 py-6">
    <LocaleRenderReceipt locale={locale} />
    <PageHeader kicker="Global Diesel" title={copy.comparisonTitle} description={copy.comparisonHelp} />
    <ComparisonWorkspace key={JSON.stringify(params)} countries={countries} query={query} invalid={Object.keys(params).some(key => ["countryIso3s", "applicationScope", "powerKw", "asOf"].includes(key)) && !query} today={new Date().toISOString().slice(0, 10)} />
  </main>;
}
