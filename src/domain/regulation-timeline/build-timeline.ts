import { compareCanonicalText } from "@/domain/canonical-order";
import type { ApplicationScope } from "@/features/database/schemas";
import type { CatalogRecord } from "@/features/product-catalog/schemas";

/** One joined row: regulation × country membership × limit. */
export type RegulationTimelineSourceRow = {
  applicationScope: ApplicationScope;
  canonicalName: string;
  citationCode: string | null;
  countryIso3: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  isDemo: boolean;
  jurisdictionCode: string;
  limitIsDemo: boolean;
  limitValidFrom: string;
  limitValidTo: string | null;
  membershipIsDemo: boolean;
  membershipValidFrom: string;
  membershipValidTo: string | null;
  powerMaxKw: string | number | null;
  powerMinKw: string | number | null;
  regulationId: string;
  source: {
    id: string;
    isDemo: boolean;
    title: string;
    url: string | null;
    verifiedAt: Date;
  };
  status: "proposed" | "adopted" | "effective" | "superseded";
  verifiedAt: Date;
};

export type RegulationTimelineEventKind = "takes_effect" | "ends";

export type RegulationTimelineCatalogImpact = {
  /** Models in scope and power that already declare this citation code. */
  declared: string[];
  /** Models in scope and power that do not declare it: a gap once it applies. */
  gaps: string[];
};

export type RegulationTimelineEvent = {
  key: string;
  kind: RegulationTimelineEventKind;
  date: string;
  timing: "past" | "upcoming";
  regulationId: string;
  canonicalName: string;
  citationCode: string | null;
  jurisdictionCode: string;
  status: RegulationTimelineSourceRow["status"];
  isDemo: boolean;
  countryIso3s: string[];
  applicationScopes: ApplicationScope[];
  source: {
    title: string;
    url: string | null;
    verifiedAt: string;
    isDemo: boolean;
  };
  verifiedAt: string;
  /** Null unless both an application and a power were requested. */
  catalogImpact: RegulationTimelineCatalogImpact | null;
};

export type RegulationTimelineFilter = {
  applicationScope?: ApplicationScope;
  powerKw?: number;
};

function previousUtcDay(date: string): string {
  const instant = new Date(`${date}T00:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() - 1);
  return instant.toISOString().slice(0, 10);
}

function coversDate(from: string, to: string | null, date: string): boolean {
  return from <= date && (to === null || date < to);
}

function coversPower(
  row: Pick<RegulationTimelineSourceRow, "powerMinKw" | "powerMaxKw">,
  powerKw: number,
): boolean {
  const min = row.powerMinKw === null ? null : Number(row.powerMinKw);
  const max = row.powerMaxKw === null ? null : Number(row.powerMaxKw);
  return (min === null || min <= powerKw) && (max === null || powerKw < max);
}

/**
 * Catalogue impact uses the same literal rule as catalog-fit-v1: a model
 * covers a regulation only if it names its citation code. A regulation with
 * no citation code can never be declared. Declarations are not certification.
 */
export function evaluateTimelineCatalogImpact(
  records: readonly CatalogRecord[],
  citationCode: string | null,
  applicationScope: ApplicationScope,
  powerKw: number,
): RegulationTimelineCatalogImpact {
  const declared: string[] = [];
  const gaps: string[] = [];
  for (const record of records) {
    if (
      !record.applicationScopes.includes(applicationScope) ||
      powerKw < record.powerMinKw ||
      powerKw >= record.powerMaxKw
    ) {
      continue;
    }
    (citationCode !== null &&
    record.declaredCitationCodes.includes(citationCode)
      ? declared
      : gaps
    ).push(record.model);
  }
  declared.sort(compareCanonicalText);
  gaps.sort(compareCanonicalText);
  return { declared, gaps };
}

/**
 * Builds dated "takes effect" and "ends" events from published regulation
 * rows. Countries and limits are taken as they apply on the event date (for an
 * end, on the last day the regulation still applies), so a membership or limit
 * outside that date never widens an event. Status is passed through: a
 * proposed date stays proposed, and a superseded record only yields its end.
 */
export function buildRegulationTimeline(input: {
  rows: readonly RegulationTimelineSourceRow[];
  window: { from: string; to: string };
  today: string;
  filter?: RegulationTimelineFilter;
  catalog?: readonly CatalogRecord[];
}): RegulationTimelineEvent[] {
  const { window, today } = input;
  const scopeFilter = input.filter?.applicationScope;
  const powerFilter = scopeFilter ? input.filter?.powerKw : undefined;

  const byRegulation = new Map<string, RegulationTimelineSourceRow[]>();
  for (const row of input.rows) {
    const group = byRegulation.get(row.regulationId);
    if (group) group.push(row);
    else byRegulation.set(row.regulationId, [row]);
  }

  const events: RegulationTimelineEvent[] = [];
  for (const [regulationId, rows] of byRegulation) {
    const first = rows[0]!;
    const candidates: Array<[RegulationTimelineEventKind, string | null]> = [
      ["takes_effect", first.effectiveFrom],
      ["ends", first.effectiveTo],
    ];
    for (const [kind, date] of candidates) {
      if (date === null || date < window.from || date > window.to) continue;
      // A superseded record only contributes the date it stopped applying.
      if (kind === "takes_effect" && first.status === "superseded") continue;
      const applicabilityDate = kind === "ends" ? previousUtcDay(date) : date;
      const applying = rows.filter(
        (row) =>
          coversDate(
            row.membershipValidFrom,
            row.membershipValidTo,
            applicabilityDate,
          ) &&
          coversDate(row.limitValidFrom, row.limitValidTo, applicabilityDate) &&
          (scopeFilter === undefined || row.applicationScope === scopeFilter) &&
          (powerFilter === undefined || coversPower(row, powerFilter)),
      );
      if (applying.length === 0) continue;

      const countryIso3s = [
        ...new Set(applying.map((row) => row.countryIso3)),
      ].sort();
      const applicationScopes = [
        ...new Set(applying.map((row) => row.applicationScope)),
      ].sort();
      events.push({
        key: `${regulationId}:${kind}`,
        kind,
        date,
        timing: date < today ? "past" : "upcoming",
        regulationId,
        canonicalName: first.canonicalName,
        citationCode: first.citationCode,
        jurisdictionCode: first.jurisdictionCode,
        status: first.status,
        isDemo:
          first.isDemo ||
          first.source.isDemo ||
          applying.some((row) => row.limitIsDemo || row.membershipIsDemo),
        countryIso3s,
        applicationScopes,
        source: {
          title: first.source.title,
          url: first.source.url,
          verifiedAt: first.source.verifiedAt.toISOString(),
          isDemo: first.source.isDemo,
        },
        verifiedAt: first.verifiedAt.toISOString(),
        catalogImpact:
          kind === "takes_effect" &&
          scopeFilter !== undefined &&
          powerFilter !== undefined &&
          input.catalog
            ? evaluateTimelineCatalogImpact(
                input.catalog,
                first.citationCode,
                scopeFilter,
                powerFilter,
              )
            : null,
      });
    }
  }

  return events.sort(
    (left, right) =>
      compareCanonicalText(left.date, right.date) ||
      compareCanonicalText(left.jurisdictionCode, right.jurisdictionCode) ||
      compareCanonicalText(left.canonicalName, right.canonicalName) ||
      compareCanonicalText(left.kind, right.kind),
  );
}
