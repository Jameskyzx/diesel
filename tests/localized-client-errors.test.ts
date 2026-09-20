import { describe, expect, it } from "vitest";

import { chatErrorMessage } from "@/components/ai/sales-chat";
import {
  productFitErrorMessage,
  productListErrorMessage,
} from "@/components/products/product-fit-panel";
import { getDictionary } from "@/i18n/dictionaries";

describe("retained client errors follow the active locale", () => {
  const english = getDictionary("en");
  const chinese = getDictionary("zh-CN");

  it("re-localizes retained product-list and product-fit codes", () => {
    expect(productListErrorMessage("INTERNAL_ERROR", english)).toBe(
      english.apiErrors.productListUnavailable,
    );
    expect(productListErrorMessage("INTERNAL_ERROR", chinese)).toBe(
      chinese.apiErrors.productListUnavailable,
    );
    expect(productFitErrorMessage("INVALID_INPUT", english)).toBe(
      english.apiErrors.invalidProductFit,
    );
    expect(productFitErrorMessage("INVALID_INPUT", chinese)).toBe(
      chinese.apiErrors.invalidProductFit,
    );
  });

  it("re-localizes a retained chat Error without rendering envelope text", () => {
    const error = new Error(
      JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "DO NOT RENDER provider detail",
        },
      }),
    );

    expect(chatErrorMessage(error, english)).toBe(
      english.apiErrors.chatUnavailable,
    );
    expect(chatErrorMessage(error, chinese)).toBe(
      chinese.apiErrors.chatUnavailable,
    );
    expect(chatErrorMessage(error, chinese)).not.toContain("DO NOT RENDER");
  });

  it.each([
    ["AI_NOT_CONFIGURED", "chatAiNotConfigured"],
    ["INVALID_INPUT", "chatInvalidInput"],
    ["PAYLOAD_TOO_LARGE", "chatPayloadTooLarge"],
    ["RATE_LIMITED", "chatRateLimited"],
    ["REQUEST_TIMEOUT", "chatRequestTimeout"],
  ] as const)("maps %s to fixed localized copy", (code, key) => {
    const error = new Error(
      JSON.stringify({ error: { code, message: "DO NOT RENDER" } }),
    );

    expect(chatErrorMessage(error, english)).toBe(english.apiErrors[key]);
    expect(chatErrorMessage(error, chinese)).toBe(chinese.apiErrors[key]);
  });

  it("uses localized safe fallbacks for unknown codes", () => {
    expect(productFitErrorMessage(null, english)).toBe(
      english.productFit.errorFallback,
    );
    expect(productFitErrorMessage(null, chinese)).toBe(
      chinese.productFit.errorFallback,
    );
    expect(
      chatErrorMessage(new Error("<html>unsafe</html>"), chinese),
    ).toBe(chinese.chat.chatError);
  });
});
