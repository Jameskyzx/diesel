import { HomeDashboard } from "@/components/home/home-dashboard";
import { isPortfolioDemoMode } from "@/server/config/portfolio-demo";

export default function Home() {
  return <HomeDashboard demoMode={isPortfolioDemoMode()} />;
}
