export type LiveEvalQueryTermGroup = {
  anyOf: readonly string[];
  id: string;
};

export type LiveEvalKnowledgeQueryContract = {
  forbidden: readonly LiveEvalQueryTermGroup[];
  required: readonly LiveEvalQueryTermGroup[];
};

export type LiveEvalKnowledgeQueryObservation = {
  expectationPassed: boolean;
  matchedForbiddenTermIds: string[];
  matchedRequiredTermIds: string[];
  missingRequiredTermIds: string[];
};

const dashPattern = /[\u2010-\u2015\u2212]/gu;
// English terms may be adjacent to Han text in an ordinary bilingual query.
// Block partial Latin/number tokens such as `road` in `broad`, while treating
// a script transition as a usable word boundary.
const latinWordBoundaryClass = "\\p{Script=Latin}\\p{N}_";

export function normalizeLiveEvalQueryTerm(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\p{Default_Ignorable_Code_Point}+/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(dashPattern, "-")
    .replace(/\s+/gu, " ")
    .trim();
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function queryContainsTerm(normalizedQuery: string, rawTerm: string): boolean {
  const term = normalizeLiveEvalQueryTerm(rawTerm);
  if (term.length === 0) {
    return false;
  }
  if (/\p{Script=Han}/u.test(term)) {
    return normalizedQuery.replace(/\s+/gu, "").includes(
      term.replace(/\s+/gu, ""),
    );
  }

  const pattern = escapeRegularExpression(term).replace(/\\ /gu, "\\s+");
  return new RegExp(
    `(?<![${latinWordBoundaryClass}])${pattern}(?![${latinWordBoundaryClass}])`,
    "u",
  ).test(normalizedQuery);
}

function matchedGroupIds(
  normalizedQuery: string,
  groups: readonly LiveEvalQueryTermGroup[],
): string[] {
  return groups
    .filter(({ anyOf }) =>
      anyOf.some((term) => queryContainsTerm(normalizedQuery, term))
    )
    .map(({ id }) => id);
}

export function evaluateLiveEvalKnowledgeQuery(
  query: string,
  contract: LiveEvalKnowledgeQueryContract,
): LiveEvalKnowledgeQueryObservation {
  const normalizedQuery = normalizeLiveEvalQueryTerm(query);
  const matchedRequiredTermIds = matchedGroupIds(
    normalizedQuery,
    contract.required,
  );
  const matchedRequired = new Set(matchedRequiredTermIds);
  const missingRequiredTermIds = contract.required
    .map(({ id }) => id)
    .filter((id) => !matchedRequired.has(id));
  const matchedForbiddenTermIds = matchedGroupIds(
    normalizedQuery,
    contract.forbidden,
  );

  return {
    expectationPassed:
      missingRequiredTermIds.length === 0 &&
      matchedForbiddenTermIds.length === 0,
    matchedForbiddenTermIds,
    matchedRequiredTermIds,
    missingRequiredTermIds,
  };
}
