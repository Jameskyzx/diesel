import type { ApplicationScope } from "@/features/database/schemas";

export type ApplicationScopeContext = {
  applicationScope: ApplicationScope | null;
  hasScopeConflict: boolean;
};

const scopesByAlias = {
  "on-road-truck": "on-road-truck", 卡车: "on-road-truck", 货车: "on-road-truck",
  "on-road-bus": "on-road-bus", 客车: "on-road-bus", 公交: "on-road-bus",
  construction: "construction", 工程机械: "construction", 建筑机械: "construction",
  agriculture: "agriculture", 农业: "agriculture", 农机: "agriculture",
  "generator-set": "generator-set", 发电机组: "generator-set",
  marine: "marine", 船用: "marine",
  nonroad: "non-road", "non-road": "non-road", "non road": "non-road", 非道路: "non-road",
  "on-road": "on-road", 道路: "on-road",
} as const satisfies Record<string, ApplicationScope>;
const aliases = /on-road-truck|on-road-bus|construction|agriculture|generator-set|marine|nonroad|non-road|non\s+road|on-road|工程机械|建筑机械|发电机组|非道路|卡车|货车|客车|公交|农业|农机|船用|道路/giu;
const englishIdentifierNeighbor = /[\p{L}\p{N}\p{M}_/.:@%?=+#\\\-\u2010-\u2015\u2212]/u;
const chineseIdentifierNeighbor = /[\p{Script=Latin}\p{N}_/.:@%?=+#\\\-\u2010-\u2015\u2212]/u;
const negation = /(?:(?<![\p{L}\p{N}_])(?:not|no|don['’]t|without|excluding|exclude|except(?:\s+for)?|rather\s+than|instead\s+of|neither)(?:\s+(?:for|use|using|the|a|an))?\s+|(?:不是|并非|而非|而不是|不要|不用|不含|不考虑|不适用于?|排除|除了)\s*)["“‘(]*$/iu;
const correction = /(?<![\p{L}\p{N}_])(?:actually|instead)[,\s]+(?:use|check|for)\s+["“‘(]*$/iu;
const transitionFrom = /(?:(?<![\p{L}\p{N}_])(?:change|switch)(?:\s+(?:the\s+)?(?:application\s+)?scope)?\s+from\s+|(?:(?:把|将)(?:(?:应用场景|用途|场景)(?:从|由))?|从|由)\s*)["“‘(]*$/iu;
const transitionBetween = /^["”’)]*\s*(?:to\s+|(?:改为|改成|调整为|更正为|切换到|切换为)\s*)["“‘(]*$/iu;
const transitionTo = /(?:(?<![\p{L}\p{N}_])(?:change|switch)(?:\s+(?:the\s+)?(?:application\s+)?scope)?\s+to\s+|(?:(?:把|将)?(?:应用场景|用途|场景))?(?:改为|改成|调整为|更正为|切换到|切换为)\s*)["“‘(]*$/iu;
const negativeListJoin = /^\s*(?:,\s*)?(?:and|or|nor|或|和|及|、)\s*$/iu;
const alternativeScopeJoin = /^\s*(?:,\s*)?(?:and|or|versus|vs\.?|including|或|和|及|与|以及|包括|、|\/)\s*$/iu;

// This hierarchy only resolves a user's general + specific description. It
// never expands a repository filter or asserts regulatory applicability.
const parentScope: Partial<Record<ApplicationScope, ApplicationScope>> = {
  construction: "non-road",
  agriculture: "non-road",
  "on-road-truck": "on-road",
  "on-road-bus": "on-road",
};

function overlaps(left: ApplicationScope, right: ApplicationScope): boolean {
  return left === right || parentScope[left] === right || parentScope[right] === left;
}

function standalone(text: string, offset: number, value: string): boolean {
  const before = Array.from(text.slice(Math.max(0, offset - 2), offset)).at(-1) ?? "";
  const tail = text.slice(offset + value.length, offset + value.length + 3);
  const after = Array.from(tail)[0] ?? "";
  const neighbor = /\p{Script=Han}/u.test(value) ? chineseIdentifierNeighbor : englishIdentifierNeighbor;
  return !neighbor.test(before) &&
    (/^[.?:](?:\s|$|["')\]])/u.test(tail) || !neighbor.test(after));
}

type ScopeMention = { start: number; end: number; scope: ApplicationScope; value: string };

function maskLinks(text: string): string {
  return text.replace(/(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"'“”]+/giu,
    (url) => " ".repeat(url.length));
}

export function applicationScopeMentionsIn(text: string): ScopeMention[] {
  const prose = maskLinks(text);
  return Array.from(prose.matchAll(aliases)).flatMap((match) => {
    if (!standalone(prose, match.index, match[0])) return [];
    const alias = match[0].toLowerCase().replace(/\s+/gu, " ") as keyof typeof scopesByAlias;
    return [{ start: match.index, end: match.index + match[0].length, scope: scopesByAlias[alias], value: match[0] }];
  });
}

/** A prohibited transition is a no-op, not an exclusion of its destination. */
function scopeTransitions(prose: string, mentions: readonly ScopeMention[]): Map<number, "noop" | "set"> {
  const transitions = new Map<number, "noop" | "set">();
  for (const [index, mention] of mentions.entries()) {
    if (transitions.has(mention.start)) continue;
    const prefix = prose.slice(Math.max(0, mention.start - 160), mention.start);
    const from = prefix.match(transitionFrom);
    const destination = mentions[index + 1];
    if (from && destination && transitionBetween.test(prose.slice(mention.end, destination.start))) {
      transitions.set(mention.start, "noop");
      transitions.set(destination.start, negation.test(prefix.slice(0, from.index)) ? "noop" : "set");
      continue;
    }
    const to = prefix.match(transitionTo);
    if (to) transitions.set(mention.start, negation.test(prefix.slice(0, to.index)) ? "noop" : "set");
  }
  return transitions;
}

/**
 * Bounded lexical intent, not general natural-language understanding. An absent
 * mention preserves context; exclusions/conflicts must not become an unfiltered
 * query. Only explicit correction forms discard preceding mentions in a turn.
 */
export function resolveApplicationScopeIntent(
  text: string,
  previous: ApplicationScopeContext,
): ApplicationScopeContext {
  // Mask complete links as well as checking token boundaries, including Han
  // scope labels embedded in URL paths. Keep offsets for the bounded lookbehind.
  const prose = maskLinks(text);
  const mentions = applicationScopeMentionsIn(text);
  const transitions = scopeTransitions(prose, mentions);
  const positive = new Set<ApplicationScope>();
  const excluded = new Set<ApplicationScope>();
  let mentioned = false;
  let previousEnd = 0;
  let previousWasNegative = false;
  let previousScope: ApplicationScope | null = null;
  let hasExplicitAlternatives = false;

  for (const mention of mentions) {
    mentioned = true;
    const transition = transitions.get(mention.start);
    if (transition === "noop") {
      previousEnd = mention.end;
      previousScope = null;
      previousWasNegative = false;
      continue;
    }
    const scope = mention.scope;
    const prefix = prose.slice(Math.max(0, mention.start - 160), mention.start);
    const correctionMatch = prefix.match(correction);
    const isNegatedCorrection = correctionMatch !== null &&
      negation.test(prefix.slice(0, correctionMatch.index));
    const isCorrection = transition === "set" || (correctionMatch !== null && !isNegatedCorrection);
    if (isCorrection) {
      positive.clear();
      excluded.clear();
      hasExplicitAlternatives = false;
    }
    const isNegative: boolean = isNegatedCorrection || negation.test(prefix) || (!isCorrection && previousWasNegative &&
      negativeListJoin.test(prose.slice(previousEnd, mention.start)));
    if (!isCorrection && !isNegative && !previousWasNegative && previousScope !== null &&
      previousScope !== scope && alternativeScopeJoin.test(prose.slice(previousEnd, mention.start))) {
      hasExplicitAlternatives = true;
    }
    (isNegative ? excluded : positive).add(scope);
    previousEnd = mention.end;
    previousWasNegative = isNegative;
    previousScope = scope;
  }
  if (!mentioned) return previous;

  // An exclusion-only follow-up can retain an existing, disjoint scope. It
  // cannot invent the complement of an excluded scope or retain a stale one.
  const candidates = positive.size > 0 ? [...positive] :
    previous.applicationScope ? [previous.applicationScope] : [];
  const specific = candidates.filter((scope) =>
    !candidates.some((other) => parentScope[other] === scope));
  const scope = specific.length === 1 ? specific[0]! : null;
  if (hasExplicitAlternatives || scope === null || [...excluded].some((other) => overlaps(scope, other))) {
    return { applicationScope: null, hasScopeConflict: true };
  }
  return { applicationScope: scope, hasScopeConflict: false };
}
