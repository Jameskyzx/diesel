import type { Metadata } from "next";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { LocaleRenderReceipt } from "@/components/i18n/locale-controller";
import { getDictionary } from "@/i18n/dictionaries";
import { buildLocalizedOpenGraph } from "@/i18n/metadata";
import { getRequestLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const dictionary = getDictionary(locale);

  return {
    openGraph: buildLocalizedOpenGraph(locale, {
      description: dictionary.state.notFoundBody,
      imageAlt: dictionary.metadata.openGraphImageAlt,
      title: dictionary.state.notFoundHeading,
    }),
    title: dictionary.state.notFoundHeading,
  };
}

export default async function NotFound() {
  const locale = await getRequestLocale();
  const copy = getDictionary(locale).state;
  return (
    <main className="grid min-h-[70vh] place-items-center px-6 py-16">
      <LocaleRenderReceipt locale={locale} />
      <section className="w-full max-w-xl rounded-3xl border bg-card p-8 text-center shadow-sm">
        <p className="text-sm font-semibold tracking-wide text-primary">
          404
        </p>
        <h1 className="mt-3 text-5xl font-semibold tracking-tight">404</h1>
        <p className="mt-3 text-xl font-medium">{copy.notFoundHeading}</p>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          {copy.notFoundBody}
        </p>
        <Link className={buttonVariants({ className: "mt-6" })} href="/map">
          {copy.returnMap}
        </Link>
      </section>
    </main>
  );
}
