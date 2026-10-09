import type { Metadata } from "next";
import { AnalysisLibrary } from "@/components/analyses/analysis-library";
import { LocaleRenderReceipt } from "@/components/i18n/locale-controller";
import { getDictionary } from "@/i18n/dictionaries";
import { getRequestLocale } from "@/i18n/server";
import { getCountryDirectory } from "@/server/services/country-directory";

export async function generateMetadata(): Promise<Metadata> {
  return { title: getDictionary(await getRequestLocale()).analysis.library };
}

export default async function AnalysesPage() {
  return <main className="page-shell space-y-5 py-6">
    <LocaleRenderReceipt locale={await getRequestLocale()} />
    <AnalysisLibrary countryIso2ByIso3={Object.fromEntries(getCountryDirectory().map(country => [country.iso3, country.iso2]))} />
  </main>;
}
