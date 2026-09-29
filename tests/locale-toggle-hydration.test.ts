import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const idleControls = vi.hoisted(() => ({
  disabled: false,
  requestPending: false,
  requestState: { status: "idle" as const },
  selectLocale: vi.fn(async () => undefined),
  showError: false,
}));

vi.mock("@/components/i18n/locale-controller", () => ({
  useLocaleControls: () => idleControls,
}));

import { LocaleProvider } from "@/components/i18n/locale-provider";
import { LocaleToggle } from "@/components/i18n/locale-toggle";
import { getDictionary } from "@/i18n/dictionaries";

describe("locale toggle hydration boundary", () => {
  it.each(["en", "zh-CN"] as const)(
    "renders both %s SSR buttons disabled even when the controller is idle",
    (locale) => {
      const dictionary = getDictionary(locale);
      const providerProps = {
        dictionary,
        locale,
      } as Parameters<typeof LocaleProvider>[0];
      const html = renderToStaticMarkup(createElement(
        LocaleProvider,
        providerProps,
        createElement(LocaleToggle),
      ));
      const buttons = Array.from(html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/gu), (match) => match[0]);

      expect(idleControls.disabled).toBe(false);
      expect(buttons).toHaveLength(2);
      for (const [index, buttonLocale] of (["en", "zh-CN"] as const).entries()) {
        expect(buttons[index]).toContain('disabled=""');
        expect(buttons[index]).toContain(`lang="${buttonLocale}"`);
        expect(buttons[index]).toContain(`aria-pressed="${locale === buttonLocale}"`);
      }
      expect(html).toContain(`aria-label="${dictionary.header.localeLabel}"`);
      expect(html).toContain('aria-busy="false"');
      expect(html).toMatch(/<span\b[^>]*aria-live="polite"[^>]*role="status"><\/span>/u);
      expect(html).not.toContain(dictionary.header.localeChanging);
      expect(html).not.toContain(dictionary.header.localeRecovering);
      expect(idleControls.selectLocale).not.toHaveBeenCalled();
    },
  );
});
