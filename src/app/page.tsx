import { HomeDashboard } from "@/components/home/home-dashboard";
import { LocaleRenderReceipt } from "@/components/i18n/locale-controller";
import { getRequestLocale } from "@/i18n/server";
import { isPortfolioDemoMode } from "@/server/config/portfolio-demo";

export default async function Home() {
  return (
    <>
      <LocaleRenderReceipt locale={await getRequestLocale()} />
      <HomeDashboard demoMode={isPortfolioDemoMode()} />
    </>
  );
}
