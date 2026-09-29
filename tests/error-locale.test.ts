import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

type CapturedButtonProps = {
  children?: ReactNode;
  className?: string;
  onClick?: () => void;
  type?: "button" | "reset" | "submit";
};

const buttonCapture = vi.hoisted(() => ({
  onClick: undefined as (() => void) | undefined,
}));

function readCapturedOnClick(): (() => void) | undefined {
  return buttonCapture.onClick;
}

vi.mock("@/components/ui/button", async () => {
  const { createElement: createReactElement } = await import("react");

  return {
    Button({ children, className, onClick, type }: CapturedButtonProps) {
      buttonCapture.onClick = onClick;
      return createReactElement("button", { className, type }, children);
    },
  };
});

import ErrorPage from "@/app/error";
import { LocaleProvider } from "@/components/i18n/locale-provider";
import { getDictionary } from "@/i18n/dictionaries";
import type { Locale } from "@/i18n/locale";

const error = Object.assign(new Error("render failed"), {
  digest: "error-reference-123",
});
function renderErrorPage(locale: Locale, reset = () => undefined): string {
  const providerProps = {
    dictionary: getDictionary(locale),
    locale,
  } as Parameters<typeof LocaleProvider>[0];

  return renderToStaticMarkup(
    createElement(
      LocaleProvider,
      providerProps,
      createElement(ErrorPage, { error, reset }),
    ),
  );
}

describe("localized route error", () => {
  it.each([
    {
      expected: [
        "Page failed to load",
        "This page is temporarily unavailable",
        "Retry this page. If the problem continues, contact the system administrator and include the error reference.",
        "Error reference: error-reference-123",
        "Reload",
      ],
      forbidden: [
        "页面加载失败",
        "暂时无法显示此页面",
        "请重试。如果问题持续出现，请联系系统管理员并提供错误编号。",
        "错误编号：error-reference-123",
        "重新加载",
      ],
      locale: "en",
    },
    {
      expected: [
        "页面加载失败",
        "暂时无法显示此页面",
        "请重试。如果问题持续出现，请联系系统管理员并提供错误编号。",
        "错误编号：error-reference-123",
        "重新加载",
      ],
      forbidden: [
        "Page failed to load",
        "This page is temporarily unavailable",
        "Retry this page. If the problem continues, contact the system administrator and include the error reference.",
        "Error reference: error-reference-123",
        "Reload",
      ],
      locale: "zh-CN",
    },
  ] satisfies ReadonlyArray<{
    expected: readonly string[];
    forbidden: readonly string[];
    locale: Locale;
  }>) (
    "renders the complete $locale error copy without leaking the other locale",
    ({ expected, forbidden, locale }) => {
      const html = renderErrorPage(locale);

      expected.forEach((copy) => expect(html).toContain(copy));
      forbidden.forEach((copy) => expect(html).not.toContain(copy));
      expect(html).toContain('aria-atomic="true"');
      expect(html).toContain('aria-labelledby="error-title"');
      expect(html).toContain('role="alert"');
      expect(html).toContain('<button class="mt-6" type="button">');
    },
  );

  it("invokes the supplied reset callback only when the reload control is activated", () => {
    const reset = vi.fn();
    buttonCapture.onClick = undefined;

    renderErrorPage("en", reset);

    expect(reset).not.toHaveBeenCalled();
    const onClick = readCapturedOnClick();
    expect(onClick).toBe(reset);

    onClick?.();

    expect(reset).toHaveBeenCalledOnce();
  });
});
