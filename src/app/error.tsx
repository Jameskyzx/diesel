"use client";

import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/i18n/locale-provider";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  const copy = useLocale().dictionary.state;
  return (
    <main className="grid min-h-[70vh] place-items-center px-6 py-16">
      <section
        aria-labelledby="error-title"
        className="w-full max-w-xl rounded-3xl border bg-card p-8 shadow-sm"
      >
        <p className="text-sm font-semibold text-destructive">
          {copy.errorKicker}
        </p>
        <h1
          className="mt-3 text-3xl font-semibold tracking-tight"
          id="error-title"
        >
          {copy.errorHeading}
        </h1>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          {copy.errorBody}
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            {copy.errorCode}: {error.digest}
          </p>
        ) : null}
        <Button className="mt-6" onClick={reset} type="button">
          {copy.reload}
        </Button>
      </section>
    </main>
  );
}
