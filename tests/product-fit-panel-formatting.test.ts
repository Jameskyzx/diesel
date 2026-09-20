import { describe, expect, it } from "vitest";

import {
  formatCertificationPowerRange,
  formatCertificationValidityRange,
  productFitErrorMessage,
  productListErrorMessage,
} from "@/components/products/product-fit-panel";
import { getDictionary } from "@/i18n/dictionaries";
import type { Locale } from "@/i18n/locale";

const boundaryCases = [
  {
    end: null,
    label: "both bounds missing",
    maximum: null,
    minimum: null,
    power: { en: "Not recorded", "zh-CN": "未记录" },
    start: null,
    validity: { en: "Not recorded", "zh-CN": "未记录" },
  },
  {
    end: null,
    label: "known lower bound and start with missing upper bound and end",
    maximum: null,
    minimum: 75,
    power: { en: "[75, Open) kW", "zh-CN": "[75, 开放) kW" },
    start: "2025-01-01",
    validity: {
      en: "Jan 1, 2025 → Open",
      "zh-CN": "2025年1月1日 → 开放",
    },
  },
  {
    end: "2030-12-31",
    label: "missing lower bound and start with known upper bound and end",
    maximum: 150,
    minimum: null,
    power: {
      en: "[Not recorded, 150) kW",
      "zh-CN": "[未记录, 150) kW",
    },
    start: null,
    validity: {
      en: "Not recorded → Dec 31, 2030",
      "zh-CN": "未记录 → 2030年12月31日",
    },
  },
  {
    end: "2030-12-31",
    label: "known closed bounds",
    maximum: 150,
    minimum: 75,
    power: { en: "[75, 150) kW", "zh-CN": "[75, 150) kW" },
    start: "2025-01-01",
    validity: {
      en: "Jan 1, 2025 → Dec 31, 2030",
      "zh-CN": "2025年1月1日 → 2030年12月31日",
    },
  },
] as const;

describe.each(["en", "zh-CN"] as const)(
  "certification evidence ranges in %s",
  (locale: Locale) => {
    const dictionary = getDictionary(locale);

    it.each(boundaryCases)("formats $label", (testCase) => {
      expect(
        formatCertificationPowerRange(
          testCase.minimum,
          testCase.maximum,
          dictionary.common.notRecorded,
          dictionary.common.open,
        ),
      ).toBe(testCase.power[locale]);
      expect(
        formatCertificationValidityRange(
          testCase.start,
          testCase.end,
          locale,
          dictionary.common.notRecorded,
          dictionary.common.open,
        ),
      ).toBe(testCase.validity[locale]);
    });
  },
);

describe.each(["en", "zh-CN"] as const)(
  "product-fit request timeout copy in %s",
  (locale: Locale) => {
    const dictionary = getDictionary(locale);

    it("maps the typed timeout code without exposing an abort reason", () => {
      expect(productListErrorMessage("REQUEST_TIMEOUT", dictionary)).toBe(
        dictionary.apiErrors.productListUnavailable,
      );
      expect(productFitErrorMessage("REQUEST_TIMEOUT", dictionary)).toBe(
        dictionary.apiErrors.productFitUnavailable,
      );
    });
  },
);
