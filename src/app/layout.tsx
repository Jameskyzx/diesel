import type { Metadata } from "next";

import { AppHeader } from "@/components/layout/app-header";

import "./globals.css";

export const metadata: Metadata = {
  description: "面向柴油机销售人员的全球法规、产品适配与市场分析平台。",
  title: {
    default: "全球法规与市场分析平台",
    template: "%s · 全球法规与市场分析平台",
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
          <footer className="border-t border-slate-800/80 bg-[#111918] text-slate-300">
            <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-2 px-4 py-5 text-xs sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
              <p className="font-medium text-white">全球柴油机法规与市场分析平台</p>
              <p>
                记录逐条标注 Demo / 已核验状态；使用前请复核来源与有效日期。
              </p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
