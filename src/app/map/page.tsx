import type { Metadata } from "next";

import { CountryExplorer } from "@/components/countries/country-explorer";
import { getCountryDirectory } from "@/server/services/country-directory";

export const metadata: Metadata = { title: "全球地图" };

export default function MapPage() {
  return <CountryExplorer initialCountryIndex={getCountryDirectory()} />;
}
