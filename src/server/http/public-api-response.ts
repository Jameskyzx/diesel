import "server-only";

import { createApiRequestObserver } from "@/server/observability/structured-log";

export const PUBLIC_API_CACHE_CONTROL = "private, no-store, max-age=0";

export function applyPublicApiCachePolicy(response: Response): Response {
  response.headers.set("Cache-Control", PUBLIC_API_CACHE_CONTROL);
  response.headers.set("Pragma", "no-cache");
  return response;
}

export function createPublicApiRequestObserver(
  route: string,
): ReturnType<typeof createApiRequestObserver> {
  const observer = createApiRequestObserver(route);

  return {
    finish(response, errorCode) {
      return applyPublicApiCachePolicy(observer.finish(response, errorCode));
    },
    requestId: observer.requestId,
    startedAtMs: observer.startedAtMs,
  };
}
