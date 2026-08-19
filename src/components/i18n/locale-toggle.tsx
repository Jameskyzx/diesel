"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useLocale } from "@/components/i18n/locale-provider";
import { localeCookieName, type Locale } from "@/i18n/locale";
import { cn } from "@/lib/utils";

const options = [
  { label: "EN", locale: "en" },
  { label: "中文", locale: "zh-CN" },
] as const satisfies readonly { label: string; locale: Locale }[];

export function LocaleToggle() {
  const router = useRouter();
  const { dictionary, locale } = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function selectLocale(nextLocale: Locale) {
    if (nextLocale === locale || pending) {
      return;
    }

    setError(null);
    try {
      const response = await fetch("/api/preferences/locale", {
        body: JSON.stringify({ locale: nextLocale }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Locale preference request failed.");
      }

      window.localStorage.setItem(localeCookieName, nextLocale);

      startTransition(() => {
        // A server refresh keeps the current pathname, query string, and scroll
        // position while rebuilding server-rendered copy from the new cookie.
        router.refresh();
      });
    } catch {
      setError(dictionary.header.localeChangeFailed);
    }
  }

  return (
    <div className="shrink-0">
      <div
        aria-label={dictionary.header.localeLabel}
        className="flex items-center rounded-full border border-black/[0.07] bg-white/75 p-0.5 text-[11px] font-semibold shadow-sm"
        data-testid="locale-toggle"
        role="group"
      >
        {options.map((option) => (
          <button
            aria-pressed={locale === option.locale}
            className={cn(
              "h-8 rounded-full px-2.5 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-emerald-700/20",
              locale === option.locale
                ? "bg-[#173d31] text-white"
                : "text-slate-600 hover:bg-emerald-50 hover:text-emerald-900",
            )}
            disabled={pending}
            key={option.locale}
            lang={option.locale}
            onClick={() => void selectLocale(option.locale)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
      {error ? (
        <span aria-live="polite" className="sr-only" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
