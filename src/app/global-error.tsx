"use client";

import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { getDictionary } from "@/i18n/dictionaries";
import {
  defaultLocale,
  localeFromBrowserCookie,
  type Locale,
} from "@/i18n/locale";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

const subscribeToBrowserLocale = () => () => undefined;
const readBrowserLocale = () =>
  localeFromBrowserCookie(() => document.cookie);

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  // Next.js global-error is a Client Component without request headers. Keep
  // its React server snapshot deterministic, then reconcile from the
  // authoritative locale cookie in the browser. A root-layout failure may use
  // Next's neutral error shell instead of serializing this snapshot as HTML.
  const locale = useSyncExternalStore(
    subscribeToBrowserLocale,
    readBrowserLocale,
    () => defaultLocale,
  );

  return <GlobalErrorDocument error={error} locale={locale} reset={reset} />;
}

export function GlobalErrorDocument({
  error,
  locale,
  reset,
}: GlobalErrorProps & { locale: Locale }) {
  const dictionary = getDictionary(locale);
  const copy = dictionary.globalError;

  return (
    <html lang={locale}>
      <head>
        <title>{copy.heading}</title>
      </head>
      <body>
        <main className="grid min-h-screen place-items-center bg-background px-6 py-16 text-foreground">
          <section
            aria-atomic="true"
            aria-labelledby="global-error-title"
            className="surface-panel w-full max-w-xl rounded-md border-t-4 border-t-destructive p-8"
            role="alert"
          >
            <p className="text-sm font-semibold text-destructive">
              {copy.kicker}
            </p>
            <h1
              className="mt-3 text-3xl font-semibold tracking-tight"
              id="global-error-title"
            >
              {copy.heading}
            </h1>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              {copy.body}
            </p>
            {error.digest ? (
              <p className="mt-2 font-mono text-xs text-muted-foreground">
                {copy.code}{dictionary.common.labelSeparator}{error.digest}
              </p>
            ) : null}
            <Button className="mt-6" onClick={reset} type="button">
              {copy.retry}
            </Button>
          </section>
        </main>
      </body>
    </html>
  );
}
