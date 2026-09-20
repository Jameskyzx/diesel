import type { Metadata } from "next";

import type { Locale } from "@/i18n/locale";

type LocalizedOpenGraphInput = {
  description: string;
  imageAlt: string;
  title: string;
};

/** Keeps route-specific Open Graph copy on the same complete locale contract. */
export function buildLocalizedOpenGraph(
  locale: Locale,
  input: LocalizedOpenGraphInput,
): NonNullable<Metadata["openGraph"]> {
  return {
    description: input.description,
    images: [
      {
        alt: input.imageAlt,
        height: 675,
        url: "/og.jpg",
        width: 1200,
      },
    ],
    locale: locale === "zh-CN" ? "zh_CN" : "en_US",
    title: input.title,
    type: "website",
  };
}
