import type { Metadata } from "next";

import { LocaleProvider } from "@/components/i18n/locale-provider";
import { AppHeader } from "@/components/layout/app-header";
import { getDictionary } from "@/i18n/dictionaries";
import { getRequestLocale } from "@/i18n/server";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const dictionary = getDictionary(locale);

  return {
    description: dictionary.metadata.description,
    metadataBase: new URL("https://jamesky.site"),
    openGraph: {
      description: dictionary.metadata.openGraphDescription,
      images: [
        {
          alt: dictionary.metadata.openGraphImageAlt,
          height: 675,
          url: "/og.jpg",
          width: 1200,
        },
      ],
      locale: locale === "zh-CN" ? "zh_CN" : "en_US",
      title: "Global Diesel Intelligence",
      type: "website",
    },
    title: {
      default: dictionary.metadata.siteTitle,
      template: `%s · ${dictionary.metadata.siteTitle}`,
    },
    twitter: {
      card: "summary_large_image",
      images: ["/og.jpg"],
    },
  };
}

type RootLayoutProps = Readonly<{
  children: React.ReactNode;
}>;

export default async function RootLayout({ children }: RootLayoutProps) {
  const locale = await getRequestLocale();
  const dictionary = getDictionary(locale);

  return (
    <html lang={locale}>
      <body className="font-sans">
        <LocaleProvider dictionary={dictionary} locale={locale}>
          <div className="flex min-h-screen flex-col">
            <AppHeader />
            <div className="flex-1">{children}</div>
            <footer className="mt-12 border-t border-black/[0.06] bg-[#f3f1e9]/80">
              <div className="page-shell flex flex-col gap-3 py-7 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                <p className="display-title text-sm font-semibold text-[#203b32]">
                  Global Diesel
                </p>
                <p>{dictionary.footer.tagline}</p>
              </div>
            </footer>
          </div>
        </LocaleProvider>
      </body>
    </html>
  );
}
