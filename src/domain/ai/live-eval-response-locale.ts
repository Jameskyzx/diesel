const maximumCitationTitles = 256;
const maximumCitationTitleBytes = 512;
const maximumCitationTitleTotalBytes = 32 * 1024;
const maximumResponseCharacters = 131_072;
const maximumProjectionWork = 1_048_576;
const maximumSourceListTitles = 32;
const encoder = new TextEncoder();

type Span = { start: number; end: number };
type ProjectionBudget = { remaining: number };
type LocaleProjection = { text: string; nonCitationText: string };

function spend(budget: ProjectionBudget, amount: number): boolean {
  budget.remaining -= amount;
  return budget.remaining >= 0;
}

function replaceTitleSpans(text: string, start: number, end: number, spans: readonly Span[]): string {
  let cursor = start;
  const output: string[] = [];
  for (const span of spans) {
    output.push(text.slice(cursor, span.start), " ");
    cursor = span.end;
  }
  output.push(text.slice(cursor, end));
  return output.join("");
}

/** Only explicit source fields, not a title-shaped substring in ordinary prose. */
function sourceContainerAt(
  text: string,
  start: number,
  titles: readonly string[],
  budget: ProjectionBudget,
): { end: number; titleSpans: Span[] } | null {
  if (!/(?:^|\n)[ \t]{0,3}(?:[-*+][ \t]{1,4})?$|[。.;；!?][ \t]{0,4}$/u.test(text.slice(Math.max(0, start - 12), start))) return null;
  const label = /^(?:来源|sources?)[ \t]*[:：][ \t]*/iu.exec(text.slice(start, start + 32));
  if (!label) return null;
  let cursor = start + label[0].length;
  const titleSpans: Span[] = [];
  const skipSpace = () => {
    while (text[cursor] === " " || text[cursor] === "\t") cursor += 1;
  };
  for (let count = 0; count < maximumSourceListTitles; count += 1) {
    const itemStart = cursor;
    const opening = text[cursor];
    const closing = opening === "“" ? "”" : opening;
    const quoted = opening === "`" || opening === '"' || opening === "“";
    if (quoted) cursor += 1;
    let matched: string | undefined;
    for (const title of titles) {
      if (!spend(budget, title.length)) return null;
      if (text.startsWith(title, cursor)) {
        matched = title;
        break;
      }
    }
    if (matched === undefined) return null;
    cursor += matched.length;
    if (quoted) {
      if (text[cursor] !== closing) return null;
      cursor += 1;
    }
    titleSpans.push({ start: itemStart, end: cursor });
    skipSpace();
    let annotated = false;
    if (text[cursor] === "(" || text[cursor] === "（") {
      const close = text[cursor] === "(" ? ")" : "）";
      const closingOffset = text.slice(cursor + 1, cursor + 257).indexOf(close);
      if (closingOffset === -1) return null;
      const end = cursor + 1 + closingOffset;
      const annotation = text.slice(cursor + 1, end);
      // These are bounded locator-shaped containers, not arbitrary quoted
      // English or parenthesized prose. Their contents remain in text scoring.
      if (!/^(?:locator[ \t]*:[ \t]*[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}|locatorDescriptor[ \t]+kind=product_availability,[ \t]*availableFrom=\d{4}-\d{2}-\d{2},[ \t]*availableTo=(?:\d{4}-\d{2}-\d{2}|null))$/u.test(annotation)) return null;
      cursor = end + 1;
      annotated = true;
      skipSpace();
    }
    if (text[cursor] === "," || text[cursor] === "，" || text[cursor] === "、") {
      cursor += 1;
      skipSpace();
      continue;
    }
    if (/[。.;；]/u.test(text[cursor] ?? "")) {
      const after = cursor + 1;
      if (annotated || /^[ \t]*(?:\r?\n|$)/u.test(text.slice(after))) {
        return { end: after, titleSpans };
      }
    }
    return cursor === text.length || text[cursor] === "\n" || text[cursor] === "\r"
      ? { end: cursor, titleSpans } : null;
  }
  // An oversized list must not be partially neutralized.
  budget.remaining = -1;
  return null;
}

type LocaleCitationEnvelope = {
  citations: readonly { sourceTitle: string; title: string }[];
  evidenceSufficient: boolean;
  status: string;
};

function boundedCitationTitles(titles: readonly string[]): ReadonlySet<string> {
  if (titles.length > maximumCitationTitles) return new Set();
  let totalBytes = 0;
  const candidates = new Set<string>();
  for (const title of titles) {
    const bytes = encoder.encode(title).length;
    totalBytes += bytes;
    if (bytes > maximumCitationTitleBytes || totalBytes > maximumCitationTitleTotalBytes) {
      return new Set();
    }
    // A short status word is not a title-shaped citation. Do not remove raw
    // business values such as ready/effective, even if repeated in metadata.
    if ((title.match(/\p{L}/gu)?.length ?? 0) >= 8 &&
        (/\s/u.test(title) || (title.match(/\p{Script=Han}/gu)?.length ?? 0) >= 8) &&
        !/^(?:not[ _-]+ready|not[ _-]+fit)$/iu.test(title) && !/[\r\n]/u.test(title)) {
      candidates.add(title);
    }
  }
  return candidates;
}

// Call only with schema-validated tool envelopes and a separately derived
// production evidence decision; model-authored source labels are not inputs.
export function liveEvalLocaleCitationTitles(input: {
  evidenceAllowed: boolean;
  toolResults: readonly LocaleCitationEnvelope[];
}): readonly string[] {
  if (!input.evidenceAllowed || input.toolResults.length === 0 ||
      input.toolResults.some((result) => result.status !== "ok" || !result.evidenceSufficient)) {
    return [];
  }
  return [...boundedCitationTitles(input.toolResults.flatMap(({ citations }) =>
    citations.flatMap(({ sourceTitle, title }) => [sourceTitle, title])))];
}

export function projectLiveEvalLocaleText(
  responseText: string,
  evidenceTitles: readonly string[] = [],
): string {
  return projectLiveEvalLocaleResponse(responseText, evidenceTitles).text;
}

/** nonCitationText is only a presence guard; never use it for the language ratio. */
export function projectLiveEvalLocaleResponse(
  responseText: string,
  evidenceTitles: readonly string[] = [],
): LocaleProjection {
  const unchanged = { text: responseText, nonCitationText: responseText };
  const titles = boundedCitationTitles(evidenceTitles);
  if (titles.size === 0 || responseText.length > maximumResponseCharacters) return unchanged;
  const orderedTitles = [...titles].sort((left, right) => right.length - left.length);
  const budget = { remaining: maximumProjectionWork };
  const fencedSpans: Array<{ start: number; end: number }> = [];
  let fence: { character: string; length: number; start: number } | null = null;
  let lineOffset = 0;
  for (const line of responseText.split("\n")) {
    const fenceMarker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence !== null) {
      if (fenceMarker !== null && fenceMarker[1][0] === fence.character &&
          fenceMarker[1].length >= fence.length && fenceMarker[2].trim() === "") {
        fencedSpans.push({ start: fence.start, end: lineOffset + line.length });
        fence = null;
      }
    } else if (fenceMarker !== null) {
      fence = { character: fenceMarker[1][0], length: fenceMarker[1].length, start: lineOffset };
    }
    lineOffset += line.length + 1;
  }
  if (fence !== null) fencedSpans.push({ start: fence.start, end: responseText.length });

  const escaped = (position: number): boolean => {
    let slashes = 0;
    for (let index = position - 1; index >= 0 && responseText[index] === "\\"; index -= 1) slashes += 1;
    return slashes % 2 === 1;
  };
  const output: string[] = [];
  const nonCitationOutput: string[] = [];
  let cursor = 0;
  let fenceIndex = 0;
  while (cursor < responseText.length) {
    while (fencedSpans[fenceIndex]?.end <= cursor) fenceIndex += 1;
    const span = fencedSpans[fenceIndex];
    if (span !== undefined && span.start <= cursor) {
      output.push(responseText.slice(cursor, span.end));
      nonCitationOutput.push(responseText.slice(cursor, span.end));
      cursor = span.end;
      continue;
    }
    const opening = responseText[cursor];
    if (opening === "来" || opening === "s" || opening === "S") {
      const source = sourceContainerAt(responseText, cursor, orderedTitles, budget);
      if (budget.remaining < 0) return unchanged;
      if (source !== null) {
        output.push(replaceTitleSpans(responseText, cursor, source.end, source.titleSpans));
        nonCitationOutput.push(" ");
        cursor = source.end;
        continue;
      }
    }
    if ((opening !== "`" && opening !== '"' && opening !== "“") || escaped(cursor)) {
      output.push(opening);
      nonCitationOutput.push(opening);
      cursor += 1;
      continue;
    }
    let delimiterLength = 1;
    if (opening === "`") {
      while (responseText[cursor + delimiterLength] === "`") delimiterLength += 1;
    }
    const closing = opening === "“" ? "”" : opening.repeat(delimiterLength);
    let end = responseText.indexOf(closing, cursor + delimiterLength);
    while (end !== -1 && (escaped(end) ||
        (opening === "`" && (responseText[end - 1] === "`" || responseText[end + delimiterLength] === "`")))) {
      end = responseText.indexOf(closing, end + closing.length);
    }
    if (end === -1) {
      // An unclosed outer literal protects its remainder, including nested
      // single-line title-shaped fragments. Never recover by stripping inside.
      output.push(responseText.slice(cursor));
      nonCitationOutput.push(responseText.slice(cursor));
      break;
    }
    const content = responseText.slice(cursor + delimiterLength, end);
    const literalEnd = end + closing.length;
    const projected = delimiterLength === 1 && !/[\r\n]/u.test(content) && titles.has(content)
      ? " " : responseText.slice(cursor, literalEnd);
    output.push(projected);
    nonCitationOutput.push(projected);
    cursor = literalEnd;
  }
  return { text: output.join(""), nonCitationText: nonCitationOutput.join("") };
}
