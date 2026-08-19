import "server-only";

import { cookies } from "next/headers";

import { getDictionary } from "@/i18n/dictionaries";
import {
  localeCookieName,
  parseLocale,
  type Locale,
} from "@/i18n/locale";

export async function getRequestLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  return parseLocale(cookieStore.get(localeCookieName)?.value);
}

export async function getRequestDictionary() {
  return getDictionary(await getRequestLocale());
}
