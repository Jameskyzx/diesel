import type { createRegulationRepository } from "@/server/repositories/regulation-repository";

type EffectiveRegulationLimitRow = Awaited<
  ReturnType<ReturnType<typeof createRegulationRepository>["findEffectiveByCountry"]>
>[number];

function toApplicableRegulation(row: EffectiveRegulationLimitRow) {
  return {
    applicability: {
      countryIso3: row.applicability.countryIso3,
      jurisdiction: {
        code: row.applicability.jurisdictionCode,
        id: row.applicability.jurisdictionId,
        isDemo: row.applicability.jurisdictionIsDemo,
        name: row.applicability.jurisdictionName,
        source: {
          id: row.applicability.jurisdictionSourceId,
          isDemo: row.applicability.jurisdictionSourceIsDemo,
          publishedOn: row.applicability.jurisdictionSourcePublishedOn,
          title: row.applicability.jurisdictionSourceTitle,
          url: row.applicability.jurisdictionSourceUrl,
          verifiedAt: row.applicability.jurisdictionSourceVerifiedAt,
        },
        verifiedAt: row.applicability.jurisdictionVerifiedAt,
      },
      membership: {
        isDemo: row.applicability.membershipIsDemo,
        source: {
          id: row.applicability.membershipSourceId,
          isDemo: row.applicability.membershipSourceIsDemo,
          publishedOn: row.applicability.membershipSourcePublishedOn,
          title: row.applicability.membershipSourceTitle,
          url: row.applicability.membershipSourceUrl,
          verifiedAt: row.applicability.membershipSourceVerifiedAt,
        },
        validFrom: row.applicability.membershipValidFrom,
        validTo: row.applicability.membershipValidTo,
        verifiedAt: row.applicability.membershipVerifiedAt,
      },
    },
    canonicalName: row.canonicalName,
    citationCode: row.citationCode,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    isDemo: row.isDemo,
    limitSources: [limitSourceOf(row)],
    regulationId: row.regulationId,
    source: row.source,
    status: row.status,
    verifiedAt: row.verifiedAt,
  };
}

export type ApplicableRegulationRecord = ReturnType<typeof toApplicableRegulation>;

function limitSourceOf(row: EffectiveRegulationLimitRow) {
  return {
    id: row.limit.sourceId,
    isDemo: row.limit.isDemo || row.limit.sourceIsDemo,
    publishedOn: row.limit.sourcePublishedOn,
    title: row.limit.sourceTitle,
    url: row.limit.sourceUrl,
    verifiedAt: row.limit.sourceVerifiedAt,
  };
}

/**
 * One applicable regulation per regulation ID, in first-row order. The query
 * returns one row per matching limit; limit sources are merged, never dropped,
 * and a Demo flag on any duplicate source row is preserved.
 */
export function groupApplicableRegulationRows(
  rows: readonly EffectiveRegulationLimitRow[],
): ApplicableRegulationRecord[] {
  const regulationsById = new Map<string, ApplicableRegulationRecord>();
  for (const row of rows) {
    const existing = regulationsById.get(row.regulationId);
    if (!existing) {
      regulationsById.set(row.regulationId, toApplicableRegulation(row));
      continue;
    }

    const limitSource = limitSourceOf(row);
    const existingLimitSource = existing.limitSources.find(
      ({ id }) => id === limitSource.id,
    );
    if (existingLimitSource) {
      existingLimitSource.isDemo =
        existingLimitSource.isDemo || limitSource.isDemo;
    } else {
      existing.limitSources.push(limitSource);
    }
  }
  return Array.from(regulationsById.values());
}
