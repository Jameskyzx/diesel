import type { LiveEvalResponseAnchor } from "./live-eval";

const MAX_RESPONSE_CHARACTERS = 131_072;
const MAX_INLINE_DEPTH = 16;
const MAX_LIST_DEPTH = 16;
const omitted = "\uFFFC";
type ProjectionBudget = { exhausted: boolean; remaining: number };

function spend(budget: ProjectionBudget, amount = 1): boolean {
  budget.remaining -= amount;
  if (budget.remaining < 0) budget.exhausted = true;
  return !budget.exhausted;
}

export type LiveEvalResponseText = Readonly<{
  facts: string;
  claims: readonly string[];
  assertionClaims: readonly string[];
}>;

function normalize(value: string): string {
  return value.normalize("NFKC")
    .replace(/\p{Default_Ignorable_Code_Point}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[\u2010-\u2015\u2212]/gu, "-")
    .replace(/\s+/gu, " ").trim();
}

function closingDelimiter(text: string, delimiter: string, from: number, budget: ProjectionBudget): number {
  for (let cursor = from; cursor < text.length; cursor += 1) {
    if (!spend(budget)) return -1;
    if (text[cursor] === "\\") { cursor += 1; continue; }
    if (text.startsWith(delimiter, cursor)) return cursor;
  }
  return -1;
}

function closingBracket(text: string, start: number, open: string, close: string, budget: ProjectionBudget): number {
  let depth = 1;
  for (let cursor = start + 1; cursor < text.length; cursor += 1) {
    if (!spend(budget)) return -1;
    if (text[cursor] === "\\") { cursor += 1; continue; }
    if (text[cursor] === open) depth += 1;
    if (text[cursor] === close) {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  return -1;
}

function atomicLiteral(value: string): boolean {
  // URL destinations remain excluded even when presented as atomic code or
  // quoted values. Keep the same omission barrier as a bare HTTP(S) URL.
  return !/^https?:\/\//iu.test(value) &&
    /^[\p{L}\p{N}_.:/+-]+(?:[ \t]+(?:kW|千瓦))?$/u.test(value) && value.length <= 160;
}

function quotedClaimLiteral(value: string): boolean {
  // Explicit negative/unknown status values must remain visible to vetoes.
  return /^(?:compatible|ready|not_ready|not-ready|unknown|unavailable|unconfirmed|可供货|通过)$/iu.test(value) ||
    /^[A-Z0-9][A-Z0-9_.:/+-]*$/u.test(value);
}

/**
 * A bounded scoring projection, not a general Markdown renderer. Discarded
 * spans introduce a barrier: removing a quote/code example must not construct
 * a new assertion or identifier from the text on either side.
 */
function inlineText(text: string, claims: boolean, budget: ProjectionBudget, depth = 0): string {
  if (depth > MAX_INLINE_DEPTH) { budget.exhausted = true; return omitted; }
  let output = "";
  for (let cursor = 0; cursor < text.length;) {
    if (!spend(budget)) return omitted;
    const character = text[cursor]!;
    if (character === "\\" && /[\\`*_~[\]()<>"']/u.test(text[cursor + 1] ?? "")) {
      output += text[cursor + 1]; cursor += 2; continue;
    }
    if (/^https?:\/\//iu.test(text.slice(cursor, cursor + 8))) {
      // The surrounding prose's closing parenthesis is not part of a bare
      // URL. NFKC also brings Chinese full-width parentheses here. Keep URL
      // path/query parentheses balanced so their suffixes remain excluded.
      let end = cursor;
      let parentheses = 0;
      while (end < text.length && !/[\s<>]/u.test(text[end]!)) {
        if (!spend(budget)) return omitted;
        if (text[end] === "(") parentheses += 1;
        else if (text[end] === ")") {
          if (parentheses === 0) break;
          parentheses -= 1;
        }
        end += 1;
      }
      output += omitted;
      cursor = end;
      continue;
    }
    if (character === "[" || (character === "!" && text[cursor + 1] === "[")) {
      const image = character === "!";
      const start = cursor + (image ? 1 : 0);
      const end = closingBracket(text, start, "[", "]", budget);
      const next = text[end + 1];
      const targetEnd = end >= 0 && (next === "(" || next === "[")
        ? closingBracket(text, end + 1, next, next === "(" ? ")" : "]", budget) : -1;
      if (targetEnd >= 0) {
        output += image ? omitted : inlineText(text.slice(start + 1, end), claims, budget, depth + 1);
        cursor = targetEnd + 1; continue;
      }
    }
    if (character === "<") {
      if (!spend(budget, text.length)) return omitted;
      const end = text.indexOf(">", cursor + 1);
      if (end >= 0 && /^(?:\/?[A-Za-z]|!|https?:)/u.test(text.slice(cursor + 1, end))) {
        const tag = /^([A-Za-z][A-Za-z0-9]*)\b/u.exec(text.slice(cursor + 1, end));
        const closing = tag ? text.toLowerCase().indexOf(`</${tag[1]!.toLowerCase()}>`, end + 1) : -1;
        output += omitted;
        cursor = closing >= 0 ? closing + tag![1]!.length + 3 : end + 1;
        continue;
      }
    }
    if (character === "`") {
      const delimiter = /^`+/u.exec(text.slice(cursor))![0];
      const end = closingDelimiter(text, delimiter, cursor + delimiter.length, budget);
      if (end >= 0) {
        const literal = text.slice(cursor + delimiter.length, end).trim();
        output += atomicLiteral(literal) && (!claims || quotedClaimLiteral(literal)) ? literal : omitted;
        cursor = end + delimiter.length; continue;
      }
      // An unfinished code span is not affirmative evidence.
      budget.exhausted = true; return omitted;
    }
    const quoteClose = character === '"' ? '"' : character === "“" ? "”"
      : character === "「" ? "」" : character === "『" ? "』"
        : (character === "'" || character === "‘") && !/[\p{L}\p{N}]/u.test(text[cursor - 1] ?? "")
          ? character === "'" ? "'" : "’" : null;
    if (quoteClose !== null) {
      const end = closingDelimiter(text, quoteClose, cursor + 1, budget);
      if (end >= 0) {
        const literal = text.slice(cursor + 1, end).trim();
        output += atomicLiteral(literal) && (!claims || quotedClaimLiteral(literal)) ? literal : omitted;
        cursor = end + 1; continue;
      }
      if (claims) { budget.exhausted = true; return omitted; }
    }
    const delimiter = text.startsWith("~~", cursor) ? "~~"
      : text.startsWith("***", cursor) ? "***" : text.startsWith("**", cursor) ? "**"
        : text.startsWith("__", cursor) ? "__" : character === "*" || character === "_" ? character : null;
    if (delimiter !== null && !(delimiter.startsWith("_") && /[\p{L}\p{N}]/u.test(text[cursor - 1] ?? ""))) {
      const start = cursor + delimiter.length;
      const end = closingDelimiter(text, delimiter, start, budget);
      const body = end >= 0 ? text.slice(start, end) : "";
      if (body.length > 0 && !/^\s|\s$/u.test(body)) {
        output += delimiter === "~~" ? omitted : inlineText(body, claims, budget, depth + 1);
        cursor = end + delimiter.length; continue;
      }
    }
    output += character;
    cursor += 1;
  }
  return output;
}

type ProseLine = Readonly<{ text: string; assertionBlocked: boolean; factBoundary?: boolean }>;
type ListFrame = Readonly<{
  markerIndent: number;
  contentIndent: number;
  assertionBlocked: boolean;
}>;

function proseLines(response: string, budget: ProjectionBudget): ProseLine[] {
  const lines: ProseLine[] = [];
  const barrier: ProseLine = { text: omitted, assertionBlocked: true };
  const parents: ListFrame[] = [];
  let fence: Readonly<{ delimiter: string; contentIndent: number }> | null = null;
  let quoteBlock = false;
  let htmlBlock = false;
  let blockContentIndent = 0;
  for (const line of response.replace(/\r\n?/gu, "\n").split("\n")) {
    if (!spend(budget, line.length + 1)) return [];
    const indent = /^ */u.exec(line)![0].length;
    if (fence !== null) {
      const close = indent >= fence.contentIndent
        ? /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line.slice(fence.contentIndent)) : null;
      if (close && close[1]![0] === fence.delimiter[0] &&
        close[1]!.length >= fence.delimiter.length && !close[2]!.trim()) fence = null;
      lines.push(barrier); continue;
    }
    if (!line.trim()) {
      quoteBlock = false; htmlBlock = false; parents.length = 0;
      lines.push(barrier); continue;
    }
    const marker = /^( *)([-+*])([ \t]+)(\S.*)$/u.exec(line);
    if (quoteBlock || htmlBlock) {
      // A validated list sibling outside the quoted/HTML item's content
      // column ends that container. Do not hide its new decision as a lazy
      // continuation. Root block exclusions retain their existing behavior.
      const exitsContainer = marker && blockContentIndent > 0 &&
        (indent < blockContentIndent || (quoteBlock && indent === blockContentIndent));
      if (!exitsContainer) { lines.push(barrier); continue; }
      quoteBlock = false; htmlBlock = false;
    }
    if (/^[ \t]*\t/u.test(line)) {
      parents.length = 0; lines.push(barrier); continue;
    }
    const thematicBreak = /^ {0,3}(?:\*(?: *\*){2,}|-(?: *-){2,}|_(?: *_){2,}) *$/u;
    if (thematicBreak.test(line)) {
      parents.length = 0; lines.push(barrier); continue;
    }

    // A list child is prose only inside a known parent content column. Four
    // additional spaces are still code; a standalone indented marker is not
    // permission to expose an example. The small stack also bounds work.
    let body = line;
    let contentIndent = 0;
    let assertionBlocked = false;
    let factBoundary = false;
    let frame: ListFrame | null = null;
    let continuationParentIndex: number | null = null;
    if (marker) {
      while (parents.length && parents.at(-1)!.markerIndent >= indent) parents.pop();
      const parent = parents.at(-1);
      const insideParent = parent !== undefined &&
        indent >= parent.contentIndent && indent < parent.contentIndent + 4;
      if ((!parent && indent > 3) || (parent && !insideParent)) {
        parents.length = 0; lines.push(barrier); continue;
      }
      // Five spaces after a bullet start list-contained code, not prose.
      // Tabs are outside this bounded container contract. Keep the valid
      // ancestor so the next ordinary sibling cannot silently disappear.
      if (marker[3]!.includes("\t") || marker[3]!.length > 4) {
        lines.push(barrier); continue;
      }
      if (parents.length >= MAX_LIST_DEPTH) { budget.exhausted = true; return []; }
      body = marker[4]!;
      contentIndent = indent + 1 + marker[3]!.length;
      assertionBlocked = parent?.assertionBlocked ?? false;
      frame = { markerIndent: indent, contentIndent, assertionBlocked };
    } else {
      let parentIndex = parents.length - 1;
      while (parentIndex >= 0 && indent < parents[parentIndex]!.contentIndent) parentIndex -= 1;
      const parent = parents[parentIndex];
      if (parent && indent < parent.contentIndent + 4) {
        parents.length = parentIndex + 1;
        contentIndent = parent.contentIndent;
        body = line.slice(contentIndent);
        assertionBlocked = parent.assertionBlocked;
        continuationParentIndex = parentIndex;
      } else {
        factBoundary = parents.length > 0;
        parents.length = 0;
        if (indent > 3) { lines.push(barrier); continue; }
      }
    }

    // Recheck block exclusions after removing a validated list container.
    // Otherwise list markers can conceal fences, quotations or HTML blocks.
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(body);
    if (fenceMatch) {
      fence = { delimiter: fenceMatch[1]!, contentIndent };
      if (frame) parents.push(frame);
      lines.push(barrier); continue;
    }
    if (/^ {0,3}>/u.test(body)) quoteBlock = true;
    if (/^ {0,3}<(?:[A-Za-z][\w-]*(?:\s|>|\/)|!--|!DOCTYPE)/iu.test(body)) htmlBlock = true;
    if (quoteBlock || htmlBlock) {
      blockContentIndent = contentIndent;
      if (frame) parents.push(frame);
      lines.push(barrier); continue;
    }
    if (/^ {0,3}\[[^\]]+\]:/u.test(body) || thematicBreak.test(body)) {
      if (frame) parents.push(frame);
      lines.push(barrier); continue;
    }
    lines.push({ text: body, assertionBlocked, factBoundary: frame !== null || factBoundary });
    if (frame || continuationParentIndex !== null) {
      const context = assertionContext(normalize(inlineText(body, true, budget)));
      const blocked = assertionBlocked || Number.isFinite(context.firstDenialEnd) ||
        context.lastSuffixDenialStart >= 0;
      if (frame) parents.push({ ...frame, assertionBlocked: blocked });
      else if (continuationParentIndex !== null) {
        parents[continuationParentIndex] = {
          ...parents[continuationParentIndex]!, assertionBlocked: blocked,
        };
      }
    }
  }
  return lines;
}

export function prepareLiveEvalResponseText(response: string): LiveEvalResponseText {
  const empty: LiveEvalResponseText = { facts: "", claims: [], assertionClaims: [] };
  if (response.length > MAX_RESPONSE_CHARACTERS) return empty;
  const canonical = response.normalize("NFKC").replace(/\p{Default_Ignorable_Code_Point}/gu, "");
  if (canonical.length > MAX_RESPONSE_CHARACTERS) return empty;
  const budget: ProjectionBudget = { exhausted: false, remaining: MAX_RESPONSE_CHARACTERS * 8 };
  const lines = proseLines(canonical, budget);
  const facts = normalize(lines.map(({ text, factBoundary }) =>
    (factBoundary ? omitted : "") + inlineText(text, false, budget)).join("\n"));
  const claims: string[] = [];
  const assertionClaims: string[] = [];
  for (const line of lines) {
    const clauses = inlineText(line.text, true, budget)
      .split(/(?:[!?;。！？；\n|]+|\.(?!\d))/u).map(normalize).filter(Boolean);
    claims.push(...clauses);
    // A child of an example/hypothesis/negated parent cannot turn into an
    // assertion merely because Markdown places it on another line. Retain
    // all visible claims separately for conservative contradiction vetoes.
    if (!line.assertionBlocked) assertionClaims.push(...clauses);
  }
  if (budget.exhausted) return empty;
  return { facts, claims, assertionClaims };
}

function identifierCharacter(character: string): boolean {
  return /[\p{L}\p{N}\p{M}_:/+-]/u.test(character) && !/\p{Script=Han}/u.test(character);
}

function boundariesMatch(text: string, start: number, end: number, anchorId: string, candidate: string): boolean {
  const before = text[start - 1] ?? "";
  const after = text[end] ?? "";
  if (/^fact:date-/u.test(anchorId)) return !/\d/u.test(before) && !/\d/u.test(after);
  if (/^fact:(?:model|metric)-/u.test(anchorId)) {
    return !identifierCharacter(before) && !identifierCharacter(after) &&
      !(before === "." && identifierCharacter(text[start - 2] ?? "")) &&
      !(after === "." && identifierCharacter(text[end + 1] ?? ""));
  }
  const wordCharacter = (value: string) => /[\p{L}\p{N}\p{M}_]/u.test(value) && !/\p{Script=Han}/u.test(value);
  return (!wordCharacter(candidate[0] ?? "") || !wordCharacter(before)) &&
    (!wordCharacter(candidate.at(-1) ?? "") || !wordCharacter(after));
}

function assertionContext(text: string): { firstDenialEnd: number; lastSuffixDenialStart: number } {
  // Explicit negation, uncertainty and hypothetical/example introductions are
  // not assertions. This bounded lexical contract is not a general NLI judge.
  const english = /(?<![\p{L}\p{N}_-])(?:not|cannot|can't|can’t|unable|false|untrue|unconfirmed|undetermined|uncertain|unverified|unsupported|hypothetical|example|suppose|assuming|if|may|might|could|would)(?![\p{L}\p{N}_-])/iu.exec(text);
  const chinese = /(?:不能|无法|不要|不可断言|尚未确认|未确认|未作|并非|不是|假设|假如|如果|例句|示例)/u.exec(text);
  const firstDenialEnd = Math.min(...[english, chinese].map((match) => match ? match.index + match[0].length : Number.POSITIVE_INFINITY));
  let lastSuffixDenialStart = -1;
  for (const match of text.matchAll(/\b(?:is|was)\s+(?:false|untrue|unconfirmed|unsupported|undetermined)|\bis\s+not\s+(?:true|confirmed)|(?:不成立|不属实|尚未确认)/giu)) {
    lastSuffixDenialStart = match.index;
  }
  return { firstDenialEnd, lastSuffixDenialStart };
}

function canonicalDecimal(value: string): string {
  const negative = value.startsWith("-");
  const [whole = "0", decimal = ""] = value.replace(/^[+-]/u, "").replaceAll(",", "").split(".");
  const integer = whole.replace(/^0+(?=\d)/u, "");
  const fraction = decimal.replace(/0+$/u, "");
  const sign = negative && (integer !== "0" || fraction.length > 0) ? "-" : "";
  return `${sign}${integer}${fraction ? `.${fraction}` : ""}`;
}

function containsPowerValue(text: string, candidate: string): boolean {
  const expected = /^(\d+(?:\.\d+)?)\s*(?:kw|千瓦)$/u.exec(candidate);
  if (!expected) return false;
  const expectedValue = canonicalDecimal(expected[1]!);
  // Establish the number's left boundary before consuming it. Otherwise the
  // model suffix in "DEMO-ENG-100,100 千瓦" can consume the real power field as
  // part of a rejected number, hiding a subsequent valid match.
  for (const match of text.matchAll(/(^|\p{Script=Han}|[^\p{L}\p{N}\p{M}_.:/+-])([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(kw|千瓦)/gu)) {
    const start = match.index + match[1]!.length;
    const end = match.index + match[0].length;
    const before = text[start - 1] ?? "";
    const after = text[end] ?? "";
    if (identifierCharacter(before) || before === "." || identifierCharacter(after) ||
      (after === "." && identifierCharacter(text[end + 1] ?? "")) ||
      (before === "," && /(?:^|[^\p{L}\p{N}_.:/+-])\d{1,3}(?:,\d{3})*,$/u.test(text.slice(0, start)))) continue;
    if (canonicalDecimal(match[2]!) === expectedValue) return true;
  }
  return false;
}

function containsCandidate(text: string, value: string, anchorId: string, assertion: boolean): boolean {
  const candidate = normalize(value);
  if (!candidate) return false;
  if (anchorId.startsWith("fact:power-")) return containsPowerValue(text, candidate);
  const context = assertion ? assertionContext(text) : null;
  for (let from = 0; from < text.length;) {
    const start = text.indexOf(candidate, from);
    if (start < 0) return false;
    const end = start + candidate.length;
    if (boundariesMatch(text, start, end, anchorId, candidate) &&
      (context === null || (context.firstDenialEnd > start && context.lastSuffixDenialStart < end))) return true;
    from = start + 1;
  }
  return false;
}

function supplyConfirmationContradicted(claims: readonly string[]): boolean {
  // Only these finite supply predicates are considered here, within one
  // projected visible clause. Formatting barriers cannot connect their words.
  // This complements the case's literal vetoes without introducing a general
  // entailment or synonym rule for other decisions.
  const unavailableConfirmation = /(?<![\p{L}\p{N}_-])supply availability confirmed(?:\s+(?:(?:to be|as)\s+)?|\s*:\s*)(?:unavailable|unknown|unconfirmed)(?![\p{L}\p{N}_-])/u;
  const uncertainStatus = /(?<![\p{L}\p{N}_-])(?:supply availability|commercial readiness)\s+(?:is|remains)\s+(?:unknown|unconfirmed)(?![\p{L}\p{N}_-])/u;
  return claims.some((claim) => unavailableConfirmation.test(claim) || uncertainStatus.test(claim));
}

export function responseContainsLiveEvalAnchor(text: LiveEvalResponseText, anchor: LiveEvalResponseAnchor): boolean {
  if (anchor.id === "decision:supply-ready" && supplyConfirmationContradicted(text.claims)) return false;
  const decision = anchor.id.startsWith("decision:");
  const polarized = ["decision:product-compatible", "decision:supply-ready", "decision:product-not-ready", "decision:evidence-denied"].includes(anchor.id);
  const matches = (candidate: string, assertion: boolean) => {
    const segments = decision ? assertion ? text.assertionClaims : text.claims : [text.facts];
    return segments.some((segment) => containsCandidate(segment, candidate, anchor.id, assertion));
  };
  // Topical anchors (for example, "country overview") establish subject
  // coverage, not positive polarity; whole-request refusal is scored separately.
  // Explicit contradictions in the remaining prose are conservative vetoes,
  // including a second negative predicate after an earlier negative predicate.
  return anchor.anyOf.some((candidate) => matches(candidate, polarized)) &&
    !(anchor.noneOf?.some((candidate) => matches(candidate, false)) ?? false);
}
