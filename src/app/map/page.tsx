import type { Metadata } from "next";

import { CountryExplorer } from "@/components/countries/country-explorer";

export const metadata: Metadata = { title: "全球地图" };

export default function MapPage() {
  return <CountryExplorer />;
}
