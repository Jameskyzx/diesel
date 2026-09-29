import { NextResponse } from "next/server";
import { z } from "zod";

import {
  localeCookieMaxAgeSeconds,
  localeCookieName,
  localeFromRequest,
  locales,
} from "@/i18n/locale";
import {
  readJsonRequest,
  RequestBodyAbortedError,
  RequestBodyTooLargeError,
  RequestBodyTimeoutError,
} from "@/server/http/request-body";
import {
  MAX_LOCALE_PREFERENCE_REQUEST_BYTES,
  MAX_NON_CHAT_REQUEST_BODY_READ_MS,
} from "@/server/http/request-limits";
import { applyPublicApiCachePolicy } from "@/server/http/public-api-response";

export const runtime = "nodejs";

const errorMessages = {
  en: {
    invalid: "Locale must be either en or zh-CN.",
    payloadTooLarge: "The locale preference request is too large.",
    timeout: "The locale preference request timed out or was canceled.",
  },
  "zh-CN": {
    invalid: "语言必须为 en 或 zh-CN。",
    payloadTooLarge: "语言偏好请求过大。",
    timeout: "语言偏好请求超时或已取消。",
  },
} as const;

function errorResponse(
  code: "INVALID_LOCALE" | "PAYLOAD_TOO_LARGE" | "REQUEST_TIMEOUT",
  message: string,
  status: number,
): Response {
  const response = NextResponse.json({ error: { code, message } }, { status });
  return applyPublicApiCachePolicy(response);
}

const localePreferenceSchema = z
  .object({
    locale: z.enum(locales),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  const messages = errorMessages[localeFromRequest(request)];
  let input: z.infer<typeof localePreferenceSchema>;

  try {
    input = localePreferenceSchema.parse(
      await readJsonRequest(
        request,
        MAX_LOCALE_PREFERENCE_REQUEST_BYTES,
        MAX_NON_CHAT_REQUEST_BODY_READ_MS,
        request.signal,
      ),
    );
  } catch (error: unknown) {
    if (error instanceof RequestBodyTooLargeError) {
      return errorResponse("PAYLOAD_TOO_LARGE", messages.payloadTooLarge, 413);
    }
    if (
      error instanceof RequestBodyTimeoutError ||
      error instanceof RequestBodyAbortedError
    ) {
      return errorResponse("REQUEST_TIMEOUT", messages.timeout, 408);
    }
    return errorResponse("INVALID_LOCALE", messages.invalid, 400);
  }

  const response = NextResponse.json({ locale: input.locale, status: "ok" });
  response.cookies.set(localeCookieName, input.locale, {
    maxAge: localeCookieMaxAgeSeconds,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return applyPublicApiCachePolicy(response);
}
