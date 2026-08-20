"use client";

import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import {
  defaultLocale,
  localeCookieName,
  parseLocale,
} from "@/i18n/locale";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  const locale = useSyncExternalStore(
    () => () => undefined,
    () => parseLocale(window.localStorage.getItem(localeCookieName)),
    () => defaultLocale,
  );
  const copy = locale === "en"
    ? {
        body: "Try again later. Unverified data will not be shown while the service is recovering.",
        code: "Error code",
        heading: "The application is temporarily unavailable",
        kicker: "System error",
        retry: "Try again",
      }
    : {
        body: "请稍后重试。服务恢复前不会展示未经核验的数据。",
        code: "错误编号",
        heading: "应用暂时不可用",
        kicker: "系统错误",
        retry: "重试",
      };

  return (
    <html lang={locale}>
      <body>
        <main className="grid min-h-screen place-items-center bg-slate-950 px-6 py-16 text-white">
          <section
            aria-labelledby="global-error-title"
            className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/5 p-8"
          >
            <p className="text-sm font-semibold text-amber-300">
              {copy.kicker}
            </p>
            <h1
              className="mt-3 text-3xl font-semibold tracking-tight"
              id="global-error-title"
            >
              {copy.heading}
            </h1>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              {copy.body}
            </p>
            {error.digest ? (
              <p className="mt-2 font-mono text-xs text-slate-400">
                {copy.code}: {error.digest}
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
