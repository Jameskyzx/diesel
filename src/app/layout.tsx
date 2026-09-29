import type { Metadata } from "next";

import { LocaleControllerProvider } from "@/components/i18n/locale-controller";
import { LocaleProvider } from "@/components/i18n/locale-provider";
import { AppHeader } from "@/components/layout/app-header";
import { getDictionary } from "@/i18n/dictionaries";
import { buildLocalizedOpenGraph } from "@/i18n/metadata";
import { getRequestLocale } from "@/i18n/server";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const dictionary = getDictionary(locale);

  return {
    description: dictionary.metadata.description,
    metadataBase: new URL("https://diesel.jamesky.site"),
    openGraph: buildLocalizedOpenGraph(locale, {
      description: dictionary.metadata.openGraphDescription,
      imageAlt: dictionary.metadata.openGraphImageAlt,
      title: dictionary.metadata.openGraphTitle,
    }),
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
          <LocaleControllerProvider>
            <a
              className="sr-only z-[100] rounded-md bg-[#173d31] px-4 py-2 text-sm font-semibold text-white shadow-lg focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:outline-none focus:ring-4 focus:ring-emerald-200"
              href="#main-content"
            >
              {dictionary.header.skipToContent}
            </a>
            <div className="flex min-h-screen flex-col">
              <AppHeader />
              <div className="flex-1" id="main-content" tabIndex={-1}>
                {children}
              </div>
              <footer className="mt-12 border-t border-black/[0.06] bg-[#f3f1e9]/80">
                <div className="page-shell flex flex-col gap-3 py-7 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                  <p className="display-title text-sm font-semibold text-[#203b32]">
                    Global Diesel
                  </p>
                  <p>{dictionary.footer.tagline}</p>
                </div>
              </footer>
            </div>
          </LocaleControllerProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
