"use client";

import { useSyncExternalStore } from "react";

import { useLocaleControls } from "@/components/i18n/locale-controller";
import { useLocale } from "@/components/i18n/locale-provider";
import type { Locale } from "@/i18n/locale";
import { cn } from "@/lib/utils";

const options = [
  { label: "EN", locale: "en" },
  { label: "中文", locale: "zh-CN" },
] as const satisfies readonly { label: string; locale: Locale }[];

const subscribeToHydration = () => () => undefined;
const readClientHydration = () => true;
const readServerHydration = () => false;

export function LocaleToggle({
  testId = "locale-toggle",
}: {
  testId?: string;
} = {}) {
  const { dictionary, locale } = useLocale();
  const { disabled, requestPending, requestState, selectLocale, showError } = useLocaleControls();
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    readClientHydration,
    readServerHydration,
  );

  return (
    <div className="relative shrink-0">
      <div
        aria-busy={requestPending}
        aria-label={dictionary.header.localeLabel}
        className="flex items-center rounded-full border border-black/[0.07] bg-white/75 p-0.5 text-[11px] font-semibold shadow-sm"
        data-testid={testId}
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
            disabled={!hydrated || disabled}
            key={option.locale}
            lang={option.locale}
            onClick={() => void selectLocale(option.locale)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
      <span
        aria-atomic="true"
        aria-live="polite"
        className="sr-only"
        role="status"
      >
        {requestState.status === "recovering"
          ? dictionary.header.localeRecovering
          : requestPending
            ? dictionary.header.localeChanging
            : ""}
      </span>
      {showError ? (
        <span
          aria-atomic="true"
          aria-live="assertive"
          className="absolute top-full right-0 z-50 mt-2 w-max max-w-[min(16rem,calc(100vw-1rem))] rounded-lg border border-red-200 bg-white px-3 py-2 text-xs leading-4 font-medium text-red-800 shadow-lg"
          role="alert"
        >
          {dictionary.header.localeChangeFailed}
        </span>
      ) : null}
    </div>
  );
}
