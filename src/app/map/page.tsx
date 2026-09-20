import type { Metadata } from "next";

import { CountryExplorer } from "@/components/countries/country-explorer";
import { LocaleRenderReceipt } from "@/components/i18n/locale-controller";
import { getDictionary } from "@/i18n/dictionaries";
import { getRequestLocale } from "@/i18n/server";
import { getCountryDirectory } from "@/server/services/country-directory";

export async function generateMetadata(): Promise<Metadata> {
  return { title: getDictionary(await getRequestLocale()).map.title };
}

export default async function MapPage() {
  return (
    <>
      <LocaleRenderReceipt locale={await getRequestLocale()} />
      <CountryExplorer initialCountryIndex={getCountryDirectory()} />
    </>
  );
}
