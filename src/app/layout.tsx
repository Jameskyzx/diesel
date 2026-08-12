import type { Metadata } from "next";

import { AppHeader } from "@/components/layout/app-header";

import "./globals.css";

export const metadata: Metadata = {
  description: "面向柴油机销售人员的全球法规、产品适配与市场分析平台。",
  metadataBase: new URL("https://jamesky.site"),
  openGraph: {
    description: "查法规、验产品、比市场。每个结论都能回到日期、状态与来源。",
    images: [
      {
        alt: "全球柴油机法规证据网络",
        height: 675,
        url: "/og.jpg",
        width: 1200,
      },
    ],
    locale: "zh_CN",
    title: "Global Diesel Intelligence",
    type: "website",
  },
  title: {
    default: "全球法规与市场分析平台",
    template: "%s · 全球法规与市场分析平台",
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og.jpg"],
  },
};

type RootLayoutProps = Readonly<{
  children: React.ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="zh-CN">
      <body className="font-sans">
        <div className="flex min-h-screen flex-col">
          <AppHeader />
          <div className="flex-1">{children}</div>
          <footer className="mt-12 border-t border-black/[0.06] bg-[#f3f1e9]/80">
            <div className="page-shell flex flex-col gap-3 py-7 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
              <p className="display-title text-sm font-semibold text-[#203b32]">
                Global Diesel
              </p>
              <p>法规、产品适配与市场分析的可追溯工作台</p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
