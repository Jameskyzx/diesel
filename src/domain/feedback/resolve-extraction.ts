import type {
  FeedbackDraftItem,
  FeedbackExtractionItem,
  FeedbackItemIssue,
  FeedbackPowerUnit,
} from "@/features/feedback/schemas";

/**
 * Deterministic checks that turn a model's feedback draft into an editable
 * preview. The model only reads and quotes; model codes, countries, unit
 * conversion and evidence checks are decided here.
 */

const KW_PER_UNIT: Record<FeedbackPowerUnit, number> = {
  kW: 1,
  hp: 0.745699872,
  PS: 0.73549875,
};

export function powerToKw(value: number, unit: FeedbackPowerUnit): number {
  return Math.round(value * KW_PER_UNIT[unit] * 1000) / 1000;
}

/** Width, case and punctuation-insensitive text for evidence matching. */
export function normalizeForEvidence(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function evidenceFoundIn(quote: string, sources: readonly string[]): boolean {
  const needle = normalizeForEvidence(quote);
  return needle.length > 0 && sources.some(source => normalizeForEvidence(source).includes(needle));
}

const chineseNumerals: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

function numberAppearsIn(value: number, text: string): boolean {
  const digits = text.normalize("NFKC").replace(/(?<=\d)[,\s](?=\d{3}\b)/gu, "");
  const numbers = digits.match(/\d+(?:\.\d+)?/gu) ?? [];
  // Small counts are often written in Chinese, e.g. "两台" for two units.
  const spelled = [...digits].flatMap(character => chineseNumerals[character] === undefined ? [] : [chineseNumerals[character]]);
  return numbers.some(candidate => Number(candidate) === value) || spelled.includes(value);
}

const REDACTED = "[已隐去]";
const contactPatterns = [
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu,
  /(?:微信号?|wechat|whatsapp|wx|电话|手机|tel|phone)\s*[:：]?\s*[\w+\-().\s]{5,30}/giu,
  /\+?\d[\d\s\-()]{6,}\d/gu,
];

/** Removes e-mail addresses, phone numbers and messenger ids before storage. */
export function redactContacts(text: string): { text: string; redacted: boolean } {
  let redacted = false;
  let result = text.normalize("NFC");
  for (const pattern of contactPatterns) {
    result = result.replace(pattern, match => {
      // A long digit run is a phone number; a model code such as H13-460 is not.
      if (pattern === contactPatterns[2] &&
        (match.replace(/\D/gu, "").length < 7 || /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/u.test(match.trim()))) return match;
      redacted = true;
      return REDACTED;
    });
  }
  return { text: result, redacted };
}

export type CatalogueModel = { id: string; model: string; series: string };

export type ModelMatch =
  | { status: "matched"; record: CatalogueModel }
  | { status: "ambiguous"; candidates: CatalogueModel[] }
  | { status: "unmatched" };

const compactModel = (value: string) => value.normalize("NFKC").toUpperCase().replace(/[\s_\-–—.]+/gu, "");

/**
 * Exact catalogue matching only. A mention matches a model code (with or
 * without the DEMO prefix); a series mention with several models is ambiguous.
 */
export function matchCatalogueModel(mention: string | null, records: readonly CatalogueModel[]): ModelMatch {
  if (!mention) return { status: "unmatched" };
  const wanted = compactModel(mention);
  if (!wanted) return { status: "unmatched" };
  const withoutPrefix = (value: string) => value.replace(/^DEMO/u, "");
  const exact = records.filter(record =>
    compactModel(record.model) === wanted || withoutPrefix(compactModel(record.model)) === withoutPrefix(wanted));
  if (exact.length === 1) return { status: "matched", record: exact[0]! };
  if (exact.length > 1) return { status: "ambiguous", candidates: exact };
  const series = records.filter(record =>
    compactModel(record.series) === wanted || withoutPrefix(compactModel(record.series)) === withoutPrefix(wanted));
  if (series.length === 1) return { status: "matched", record: series[0]! };
  if (series.length > 1) return { status: "ambiguous", candidates: series };
  return { status: "unmatched" };
}

export type DirectoryCountry = { iso2: string | null; iso3: string; name: string };

const regionNames = new Intl.DisplayNames(["zh-CN"], { type: "region" });
const compactName = (value: string) => value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[\s.'’()-]+/gu, "");

/** Exact match on ISO codes, the English directory name or the Chinese region name. */
export function matchDirectoryCountry(mention: string | null, directory: readonly DirectoryCountry[]): string | null {
  if (!mention) return null;
  const wanted = compactName(mention);
  if (!wanted) return null;
  for (const country of directory) {
    const names = [country.iso3, country.iso2, country.name];
    if (country.iso2) {
      try {
        names.push(regionNames.of(country.iso2) ?? "");
      } catch {
        // An unknown region code simply has no Chinese name.
      }
    }
    if (names.some(name => name && compactName(name) === wanted)) return country.iso3;
  }
  return null;
}

export type ResolveContext = {
  /** Every text the quote may come from: pasted text, PDF/e-mail text, the image transcript. */
  sources: readonly string[];
  catalogue: readonly CatalogueModel[];
  directory: readonly DirectoryCountry[];
};

export function resolveExtractedItem(
  extracted: FeedbackExtractionItem,
  context: ResolveContext,
): { item: FeedbackDraftItem; issues: FeedbackItemIssue[] } {
  const issues: FeedbackItemIssue[] = [];
  const quote = redactContacts(extracted.evidenceQuote);
  const evidenceVerified = evidenceFoundIn(extracted.evidenceQuote, context.sources);
  if (!evidenceVerified) {
    issues.push({ code: "evidence_not_found", message: "原文摘录在上传内容里找不到，请核对或改写后再保存。" });
  }
  if (quote.redacted) {
    issues.push({ code: "contact_redacted", message: "摘录中的电话、邮箱或社交账号已隐去。" });
  }

  const numbers = [extracted.requestedPower?.value, extracted.quantityAffected].filter((value): value is number => typeof value === "number");
  if (numbers.some(value => !numberAppearsIn(value, extracted.evidenceQuote))) {
    issues.push({ code: "number_not_in_evidence", message: "功率或台数没有出现在原文摘录里，请核对数字。" });
  }

  const model = matchCatalogueModel(extracted.modelMention, context.catalogue);
  if (model.status === "ambiguous") {
    issues.push({ code: "model_ambiguous", message: `型号可能是 ${model.candidates.map(c => c.model).join("、")}，请选择。` });
  } else if (model.status === "unmatched") {
    issues.push({ code: "model_unmatched", message: "没有在机型目录里找到对应型号，请选择。" });
  }

  const countryIso3 = matchDirectoryCountry(extracted.countryMention, context.directory);
  if (extracted.countryMention && !countryIso3) {
    issues.push({ code: "country_unmatched", message: `无法确定“${extracted.countryMention}”对应的国家，请选择。` });
  }

  const power = extracted.requestedPower;
  return {
    issues,
    item: {
      catalogEngineId: model.status === "matched" ? model.record.id : null,
      modelCode: model.status === "matched" ? model.record.model : null,
      modelMention: extracted.modelMention,
      countryIso3,
      countryMention: extracted.countryMention,
      occurredOn: extracted.occurredOn,
      category: extracted.category,
      system: extracted.system,
      component: extracted.component,
      symptom: redactContacts(extracted.symptom).text,
      customerRequest: extracted.customerRequest ? redactContacts(extracted.customerRequest).text : null,
      requestedPowerValue: power?.value ?? null,
      requestedPowerUnit: power?.unit ?? null,
      requestedPowerKw: power ? powerToKw(power.value, power.unit) : null,
      quantityAffected: extracted.quantityAffected,
      severity: extracted.severity,
      tags: [...new Set(extracted.tags)],
      evidenceQuote: quote.text,
      evidenceVerified,
      sourceLanguage: extracted.sourceLanguage,
    },
  };
}
