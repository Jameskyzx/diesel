import { NextResponse } from "next/server";
import { z } from "zod";

import {
  localeCookieMaxAgeSeconds,
  localeCookieName,
  locales,
} from "@/i18n/locale";

export const runtime = "nodejs";

const localePreferenceSchema = z
  .object({
    locale: z.enum(locales),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  let input: z.infer<typeof localePreferenceSchema>;

  try {
    input = localePreferenceSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_LOCALE",
          message: "Locale must be either en or zh-CN.",
        },
      },
      { status: 400 },
    );
  }

  const response = NextResponse.json({ locale: input.locale, status: "ok" });
  response.cookies.set(localeCookieName, input.locale, {
    httpOnly: true,
    maxAge: localeCookieMaxAgeSeconds,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
