import type { SearchKnowledgeBaseResult } from "@/features/ai/schemas";
import { unwrapUntrustedKnowledgeExcerpt, wrapUntrustedKnowledgeExcerpt } from "./retrieval-policy";

export type KnowledgeDeliveryRequirements = Readonly<{
  pageLocator: boolean;
  sectionLocator: boolean;
  pages: readonly string[];
  sections: readonly string[];
}>;

type PageRange = { from: number; to: number };

function pageRange(from: number | null, to: number | null): PageRange | null {
  if (from === null || !Number.isSafeInteger(from) || from < 1) return null;
  const end = to ?? from;
  return Number.isSafeInteger(end) && end >= from ? { from, to: end } : null;
}

function requestedPageRange(value: string): PageRange | null {
  const match = /^(\d+)(?:-(\d+))?$/u.exec(value);
  return match ? pageRange(Number(match[1]), match[2] === undefined ? null : Number(match[2])) : null;
}

function covered(range: PageRange, available: readonly PageRange[]): boolean {
  let next = range.from;
  for (const candidate of [...available].sort((a, b) => a.from - b.from)) {
    if (candidate.to < next) continue;
    if (candidate.from > next) return false;
    if (candidate.to >= range.to) return true;
    next = candidate.to + 1;
  }
  return false;
}

/** Interpret labeled components only in the dedicated locator field, never
 * numbers mentioned in prose or a document title. This is bounded lexical
 * matching, not a claim that arbitrary publisher locator formats are equivalent.
 */
function sectionReferences(locator: string | null): Set<string> {
  const value = (locator ?? "").normalize("NFKC").replace(/\p{Cf}/gu, "")
    .replace(/[‐‑‒–—−]/gu, "-").toLowerCase().replace(/[.,;:。；，]+$/u, "");
  const references = new Set<string>();
  for (const match of value.matchAll(/(?<![\p{L}\p{N}_])(section|clause|part|annex|appendix)[\s:#._-]+([ivxlcdm]+|\d+(?:[./-]\d+)*)(?![\p{L}\p{N}_]|[./-][\p{L}\p{N}])/gu)) {
    references.add(`ref:${match[1]}:${match[2]}`);
  }
  for (const match of value.matchAll(/§\s*(\d+(?:[./-]\d+)*)(?![\p{L}\p{N}]|[./-]\d)/gu)) {
    references.add(`ref:section:${match[1]}`);
  }
  for (const match of value.matchAll(/第?\s*(\d+(?:[./-]\d+)*)\s*(条|款|章|节)/gu)) {
    references.add(`ref:${match[2] === "款" ? "clause" : "section"}:${match[1]}`);
  }
  return references;
}

/** Called in addition to the full DTO/score/filter/publication consistency
 * boundary. Requested delivery is proven by cited excerpts and their actual
 * locators, not by the model repeating those requests in the query echo.
 */
export function knowledgeDeliverySatisfied(
  requirements: KnowledgeDeliveryRequirements,
  result: SearchKnowledgeBaseResult,
): boolean {
  const parsedRanges = requirements.pages.map(requestedPageRange);
  if (parsedRanges.some((range) => range === null)) return false;
  const ranges = parsedRanges.filter((range): range is PageRange => range !== null);
  const eligible = result.search.results.flatMap((hit) => {
    const excerpt = unwrapUntrustedKnowledgeExcerpt(hit.content);
    if (excerpt.trim().length === 0 || wrapUntrustedKnowledgeExcerpt(excerpt) !== hit.content) return [];
    if (!result.citations.some((citation) => citation.chunkId === hit.chunkId &&
      citation.documentId === hit.document.id && citation.sourceId === hit.document.source.id &&
      citation.pageFrom === hit.pageFrom && citation.pageTo === hit.pageTo &&
      citation.sectionLocator === hit.sectionLocator)) return [];
    const page = pageRange(hit.pageFrom, hit.pageTo);
    const sections = sectionReferences(hit.sectionLocator);
    if (requirements.pageLocator && page === null) return [];
    if (requirements.sectionLocator && !hit.sectionLocator?.trim()) return [];
    if (ranges.length > 0 && (page === null || !ranges.some((range) => page.from <= range.to && page.to >= range.from))) return [];
    if (requirements.sections.length > 0 && !requirements.sections.some((reference) => sections.has(reference))) return [];
    return [{ page, sections }];
  });
  if (eligible.length === 0) return false;
  const pages = eligible.flatMap(({ page }) => page === null ? [] : [page]);
  return ranges.every((range) => covered(range, pages)) &&
    requirements.sections.every((reference) => eligible.some(({ sections }) => sections.has(reference)));
}
