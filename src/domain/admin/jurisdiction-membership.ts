export type MembershipPeriod = {
  countryIso3: string;
  validFrom: string;
  validTo?: string | null;
};

/**
 * Returns the original indexes of periods that overlap an earlier interval for
 * the same country. Half-open boundaries are allowed to touch.
 */
export function findOverlappingMembershipIndexes(
  memberships: readonly MembershipPeriod[],
): number[] {
  const indexesByCountry = new Map<string, number[]>();
  memberships.forEach((membership, index) => {
    const indexes = indexesByCountry.get(membership.countryIso3) ?? [];
    indexes.push(index);
    indexesByCountry.set(membership.countryIso3, indexes);
  });

  const overlapping: number[] = [];
  for (const indexes of indexesByCountry.values()) {
    const sortedIndexes = indexes.toSorted((left, right) =>
      memberships[left]!.validFrom.localeCompare(
        memberships[right]!.validFrom,
      ),
    );
    let frontierEnd: string | null | undefined;
    sortedIndexes.forEach((currentIndex, position) => {
      const current = memberships[currentIndex]!;
      if (
        position > 0 &&
        (frontierEnd === null || current.validFrom < frontierEnd!)
      ) {
        overlapping.push(currentIndex);
      }
      if (
        position === 0 ||
        frontierEnd === undefined ||
        (frontierEnd !== null &&
          (current.validTo === null ||
            current.validTo === undefined ||
            current.validTo > frontierEnd))
      ) {
        frontierEnd = current.validTo ?? null;
      }
    });
  }

  return overlapping.toSorted((left, right) => left - right);
}
