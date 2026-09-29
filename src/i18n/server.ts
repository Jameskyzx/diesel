import "server-only";

import { headers } from "next/headers";

import { getDictionary } from "@/i18n/dictionaries";
import {
  defaultLocale,
  localePreferenceFromCookieHeader,
  type Locale,
} from "@/i18n/locale";

export async function getRequestLocale(): Promise<Locale> {
  const requestHeaders = await headers();
  return localePreferenceFromCookieHeader(requestHeaders.get("cookie")) ??
    defaultLocale;
}

export async function getRequestDictionary() {
  return getDictionary(await getRequestLocale());
}
