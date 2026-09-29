import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import GlobalError, {
  GlobalErrorDocument,
} from "@/app/global-error";
import { localeFromBrowserCookie } from "@/i18n/locale";

const error = Object.assign(new Error("render failed"), {
  digest: "error-reference-123",
});
const reset = () => undefined;

describe("global error locale", () => {
  it("keeps the request-less React server snapshot explicitly English", () => {
    const html = renderToStaticMarkup(
      createElement(GlobalError, { error, reset }),
    );

    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<title>The application is temporarily unavailable</title>");
    expect(html.match(/<title>/gu)).toHaveLength(1);
    expect(html).toContain("The application is temporarily unavailable");
    expect(html).toContain("Error code: error-reference-123");
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain('role="alert"');
    expect(html).not.toMatch(/[\p{Script=Han}]/u);
  });

  it("renders client-selected Chinese copy and document language from the typed dictionary", () => {
    const locale = localeFromBrowserCookie(
      () => "session=ignored; diesel_locale=zh-CN",
    );
    const html = renderToStaticMarkup(
      createElement(GlobalErrorDocument, {
        error,
        locale,
        reset,
      }),
    );

    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toContain("<title>应用暂时不可用</title>");
    expect(html.match(/<title>/gu)).toHaveLength(1);
    expect(html).toContain("应用暂时不可用");
    expect(html).toContain("错误编号：error-reference-123");
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("The application is temporarily unavailable");
  });
});
