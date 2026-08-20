"use client";

import { createContext, useContext, type ReactNode } from "react";

import {
  getDictionary,
  type Dictionary,
} from "@/i18n/dictionaries";
import { defaultLocale, type Locale } from "@/i18n/locale";

type LocaleContextValue = {
  dictionary: Dictionary;
  locale: Locale;
};

const fallbackValue: LocaleContextValue = {
  dictionary: getDictionary(defaultLocale),
  locale: defaultLocale,
};

const LocaleContext = createContext<LocaleContextValue>(fallbackValue);

export function LocaleProvider({
  children,
  dictionary,
  locale,
}: LocaleContextValue & { children: ReactNode }) {
  return (
    <LocaleContext.Provider value={{ dictionary, locale }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}
