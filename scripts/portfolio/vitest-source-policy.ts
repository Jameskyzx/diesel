import { z } from "zod";

/** Operator observations are not execution inputs or signed release evidence.
 * All executable files and non-operator evidence remain in the fingerprint. */
export function isIndependentOperatorRecord(path: string): boolean {
  return /^docs\/evidence\/operations\/[a-z0-9][a-z0-9.-]*\.json$/u.test(path);
}

const observationFields = [
  "currentPublicRelease", "lastDocumentedRelease", "publicRuntime", "repositoryHead",
] as const;
const statusObjectSchema = z.record(z.string(), z.unknown());

/** Only the release-observation ledger is mutable independently of execution.
 * portfolio:verify always parses and checks the unmodified STATUS bytes again.
 * Test/browser/model evidence, fixtures, prose and deployment rules stay bound. */
export function normalizeVitestSourceBytes(path: string, bytes: Buffer): Buffer {
  if (path !== "docs/STATUS.md") return bytes;
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const block = /<!-- portfolio-verification:start -->\n```json\n([\s\S]*?)\n```\n<!-- portfolio-verification:end -->/gu;
  const matches = [...text.matchAll(block)];
  if (matches.length !== 1 || !matches[0]?.[1]) {
    throw new Error("STATUS requires exactly one canonical snapshot before source normalization.");
  }
  const snapshot = statusObjectSchema.parse(JSON.parse(matches[0][1]));
  for (const field of observationFields) {
    if (!Object.hasOwn(snapshot, field)) throw new Error(`STATUS is missing ${field}.`);
    snapshot[field] = "independently-verified-release-observation";
  }
  let normalized = text.replace(matches[0][0],
    `<!-- portfolio-verification:start -->\n\`\`\`json\n${JSON.stringify(snapshot, null, 2)}\n\`\`\`\n<!-- portfolio-verification:end -->`);
  for (const prefix of [
    "公开只读演示：",
    "最后一个完整记录了发布步骤与独立读回的时间戳 release lineage 仍是",
  ]) {
    const lines = normalized.split("\n");
    const starts = lines.flatMap((line, index) => line.startsWith(`- ${prefix}`) ? [index] : []);
    if (starts.length !== 1) throw new Error("STATUS release observation bullet is missing or duplicated.");
    const start = starts[0];
    let end = start + 1;
    while (end < lines.length && /^  /u.test(lines[end])) end += 1;
    lines.splice(start, end - start, `- ${prefix} [independently verified]`);
    normalized = lines.join("\n");
  }
  return Buffer.from(normalized, "utf8");
}
