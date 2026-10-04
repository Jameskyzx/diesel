import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { z } from "zod";

import { liveEvalProviderProfileSchema } from "./live-eval-report-schema";
import {
  PLAYWRIGHT_EVIDENCE_VERSION,
  playwrightEvidencePath,
  playwrightResultCountsSchema,
  playwrightRunContracts,
  playwrightSourceFingerprintSchema,
  sha256Text,
  type PlaywrightEvidence,
  type PlaywrightResultCounts,
  type PlaywrightRunId,
} from "./playwright-evidence";
import { assertVerificationEqual } from "./verification-issues";
import {
  VITEST_EXECUTION_EVIDENCE_VERSION,
  vitestExecutionEvidencePath,
} from "./vitest-execution-evidence";

const gitShaSchema = z.string().regex(/^[0-9a-f]{40}$/);
const minutePrecisionTimestampSchema = z.iso.datetime({
  offset: true,
  precision: -1,
});
const timestampSchema = z.iso.datetime({ offset: true });
const portfolioSnapshotStart = "<!-- portfolio-verification:start -->";
const portfolioSnapshotEnd = "<!-- portfolio-verification:end -->";
const playwrightRunIdSchema = z.enum(
  playwrightRunContracts.map(({ id }) => id) as [
    PlaywrightRunId,
    ...PlaywrightRunId[],
  ],
);

const browserRunSnapshotSchema = playwrightResultCountsSchema.extend({
  id: playwrightRunIdSchema,
}).strict();

const statusSnapshotSchema = z.object({
  browserSnapshot: z.object({
    artifactByteLength: z.number().int().positive().max(2 * 1024 * 1024),
    artifactPath: z.literal(playwrightEvidencePath),
    artifactSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    baseHeadCommit: gitShaSchema,
    evaluatedCommit: gitShaSchema.nullable(),
    observedAt: timestampSchema,
    runId: z.string().uuid(),
    runs: z.array(browserRunSnapshotSchema).length(
      playwrightRunContracts.length,
    ),
    sourceFingerprint: playwrightSourceFingerprintSchema,
    version: z.literal(PLAYWRIGHT_EVIDENCE_VERSION),
    worktreeState: z.enum(["clean", "dirty"]),
  }).strict(),
  currentPublicRelease: z.object({
    commit: gitShaSchema,
    evidenceKind: z.literal("historical-operator-record-only"),
    id: gitShaSchema,
    observedAt: minutePrecisionTimestampSchema,
    releasePath: z.string().startsWith("/opt/diesel/releases/"),
  }).strict(),
  evidenceSummary: z.object({
    approvedRealCertifications: z.number().int().nonnegative(),
    approvedRealProducts: z.number().int().nonnegative(),
    jurisdictions: z.number().int().nonnegative(),
    limits: z.number().int().nonnegative(),
    regulations: z.number().int().nonnegative(),
    sources: z.number().int().nonnegative(),
  }).strict(),
  liveEval: z.object({
    archivePath: z.string().regex(
      /^docs\/evals\/archive\/ai-live-eval-\d{8}T\d{9}Z-[0-9a-f-]{36}\.json$/u,
    ),
    attemptCount: z.number().int().nonnegative(),
    complete: z.boolean(),
    completedCount: z.number().int().nonnegative(),
    evaluatedAt: timestampSchema,
    expectedModelId: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._/@:-]*$/u),
    expectedProviderProfile: liveEvalProviderProfileSchema,
    latestOutcome: z.enum(["failed", "passed"]),
    latestSampleCount: z.number().int().nonnegative(),
    modelStepCount: z.number().int().nonnegative(),
    reportVersion: z.string().min(1),
    runError: z.object({
      code: z.literal("INITIALIZATION_ERROR"),
      errorName: z.string().min(1),
      stage: z.string().min(1),
    }).strict().nullable(),
    runId: z.string().uuid(),
    sourceFingerprint: z.object({
      algorithm: z.literal("sha256"),
      digest: z.string().regex(/^[0-9a-f]{64}$/u),
      fileCount: z.number().int().positive(),
      status: z.literal("captured"),
    }).strict(),
    suiteVersion: z.string().min(1),
    suiteCaseCount: z.number().int().positive(),
    terminationReason: z.string().min(1),
    thresholdsPassed: z.boolean(),
    tokenUsageComplete: z.boolean(),
    totalTokens: z.number().int().nonnegative(),
  }).strict(),
  lastDocumentedRelease: z.object({
    commit: gitShaSchema,
    id: z.string().regex(/^\d{14}$/),
  }).strict(),
  publicRuntime: z.object({
    evidenceKind: z.literal("historical-operator-record-only"),
    readbackAt: minutePrecisionTimestampSchema,
    status: z.literal("ok"),
    version: gitShaSchema,
  }).strict(),
  qualitySnapshot: z.object({
    artifactPath: z.literal(vitestExecutionEvidencePath),
    version: z.literal(VITEST_EXECUTION_EVIDENCE_VERSION),
  }).strict(),
  repositoryHead: z.object({
    local: gitShaSchema,
    observedAt: minutePrecisionTimestampSchema,
    remote: gitShaSchema,
  }).strict(),
}).strict();

export type StatusSnapshot = z.infer<typeof statusSnapshotSchema>;
export type EvidenceSummary = StatusSnapshot["evidenceSummary"];
export type EvidenceSummaryProseSnapshot = {
  approvedRealFixtures: number;
  jurisdictions: number;
  limits: number;
  regulations: number;
  sources: number;
};
export type QualityProseSnapshot = {
  artifactPath: string;
  version: string;
};
export type BrowserProseSnapshot = {
  artifactByteLength: number;
  artifactSha256: string;
  baseHeadCommit: string;
  evaluatedCommit: string | null;
  observedAt: string;
  runId: string;
  runs: Array<PlaywrightResultCounts & { id: PlaywrightRunId }>;
  sourceFingerprint: z.infer<typeof playwrightSourceFingerprintSchema>;
  totals: PlaywrightResultCounts;
  version: string;
  worktreeState: "clean" | "dirty";
};
export type ReleaseProseSnapshot = {
  currentPublicReleaseCommit: string;
  currentPublicReleaseEvidenceKind: "historical-operator-record-only";
  currentPublicReleaseObservedAt: string;
  currentPublicReleasePath: string;
  lastDocumentedReleaseCommit: string;
  lastDocumentedReleaseId: string;
  publicRuntimeReadbackAt: string;
  publicRuntimeEvidenceKind: "historical-operator-record-only";
  publicRuntimeStatus: "ok";
  publicRuntimeVersion: string;
};

export function formatStatusLiveEvalProse(
  snapshot: StatusSnapshot["liveEval"],
): string {
  const runError = snapshot.runError === null
    ? "none"
    : `${snapshot.runError.stage}/${snapshot.runError.code}/${snapshot.runError.errorName}`;
  return [
    `- 当前 live-eval 证据台账：\`${snapshot.latestOutcome}\`；evaluatedAt \`${snapshot.evaluatedAt}\`；run ID \`${snapshot.runId}\`；` +
      `\`${snapshot.latestSampleCount}/${snapshot.suiteCaseCount} cases\`；\`complete=${snapshot.complete}\`；` +
      `\`terminationReason=${snapshot.terminationReason}\`；\`${snapshot.attemptCount} provider attempts\`；` +
      `\`${snapshot.completedCount} completed provider calls\`；\`${snapshot.modelStepCount} model steps\`；`,
    `  \`${snapshot.totalTokens} known tokens\`；\`tokenUsageComplete=${snapshot.tokenUsageComplete}\`；` +
      `\`thresholdsPassed=${snapshot.thresholdsPassed}\`；\`runError=${runError}\`；` +
      `\`suiteVersion=${snapshot.suiteVersion}\`；\`reportVersion=${snapshot.reportVersion}\`；`,
    `  archive \`${snapshot.archivePath}\`；source fingerprint ` +
      `\`${snapshot.sourceFingerprint.digest}\` across \`${snapshot.sourceFingerprint.fileCount}\` files。`,
  ].join("\n");
}

export function assertStatusLiveEvalProseConsistency(
  snapshot: StatusSnapshot["liveEval"],
  markdown: string,
): void {
  const prose = visibleStatusProse(markdown);
  const actual = findUniqueStatusBullet(
    prose,
    "当前 live-eval 证据台账：",
    "current live-eval evidence ledger bullet",
  );
  assertVerificationEqual(
    actual,
    formatStatusLiveEvalProse(snapshot),
    "STATUS live-eval prose",
  );
  const proseWithoutLedger = prose.replace(actual, "");
  for (const retiredCurrentResultPrefix of [
    "- 当前 `sales-chat-live-",
    "- 当前报告 run ID 为",
  ]) {
    if (proseWithoutLedger.includes(retiredCurrentResultPrefix)) {
      throw new Error(
        "STATUS must keep current live-eval identities and result values only in the canonical ledger.",
      );
    }
  }
  assertNoConcreteCurrentLiveEvalClaims({
    documentLabel: "STATUS",
    markdown: proseWithoutLedger,
  });
}

function countLiteral(value: string, literal: string): number {
  return value.split(literal).length - 1;
}

function visibleStatusProse(markdown: string): string {
  let activeFence: { character: "`" | "~"; length: number } | null = null;
  let insideHtmlComment = false;
  const visibleLines: string[] = [];
  for (const line of markdown.split(/\r?\n/u)) {
    if (activeFence !== null) {
      const trimmed = line.trimStart();
      const token = /^(?<fence>`{3,}|~{3,})/u.exec(trimmed)?.groups?.fence;
      if (
        token?.startsWith(activeFence.character) &&
        token.length >= activeFence.length &&
        trimmed.slice(token.length).trim() === ""
      ) {
        activeFence = null;
      }
      visibleLines.push("");
      continue;
    }

    let cursor = 0;
    let visibleLine = "";
    while (cursor < line.length) {
      if (insideHtmlComment) {
        const commentEnd = line.indexOf("-->", cursor);
        if (commentEnd === -1) {
          cursor = line.length;
          continue;
        }
        insideHtmlComment = false;
        cursor = commentEnd + 3;
        continue;
      }
      const commentStart = line.indexOf("<!--", cursor);
      const strayCommentEnd = line.indexOf("-->", cursor);
      if (
        strayCommentEnd !== -1 &&
        (commentStart === -1 || strayCommentEnd < commentStart)
      ) {
        throw new Error("Markdown contains an unmatched HTML comment end.");
      }
      if (commentStart === -1) {
        visibleLine += line.slice(cursor);
        cursor = line.length;
        continue;
      }
      visibleLine += line.slice(cursor, commentStart);
      insideHtmlComment = true;
      cursor = commentStart + 4;
    }

    const trimmed = visibleLine.trimStart();
    const token = /^(?<fence>`{3,}|~{3,})/u.exec(trimmed)?.groups?.fence;
    if (token !== undefined) {
      activeFence = {
        character: token[0] as "`" | "~",
        length: token.length,
      };
      visibleLines.push("");
      continue;
    }
    visibleLines.push(visibleLine);
  }
  if (insideHtmlComment) {
    throw new Error("Markdown contains an unterminated HTML comment.");
  }
  if (activeFence !== null) {
    throw new Error("Markdown contains an unterminated fenced code block.");
  }
  return visibleLines.join("\n");
}

export function assertNoConcreteCurrentLiveEvalClaims(input: {
  documentLabel: string;
  implicitEvalContext?: boolean;
  markdown: string;
}): void {
  const prose = visibleStatusProse(input.markdown)
    .replace(
      /&#(?:(?:x([0-9a-f]{1,6}))|([0-9]{1,7}));/giu,
      (entity, hexadecimal: string | undefined, decimal: string | undefined) => {
        const codePoint = Number.parseInt(
          hexadecimal ?? decimal ?? "",
          hexadecimal === undefined ? 10 : 16,
        );
        return Number.isSafeInteger(codePoint) && codePoint > 0 &&
            codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
          ? String.fromCodePoint(codePoint)
          : entity;
      },
    )
    .normalize("NFKC")
    .replace(/&(?:nbsp|#0*32|#0*160|#x0*a0);/giu, " ")
    .replace(/[‐‑‒–—―−﹘﹣－]/gu, "-")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, "");
  const paragraphBoundaryMarker = "\u{f0000}";
  const sentences = prose
    .replace(/(?:\r?\n){2,}/gu, ` ${paragraphBoundaryMarker} `)
    .replace(/(?=^#{1,6}\s+)/gmu, ` ${paragraphBoundaryMarker} `)
    .replace(
      /(?=^\s*(?:[-+*]|\d+[.)])\s+)/gmu,
      ` ${paragraphBoundaryMarker} `,
    )
    .split(/(?<=[。！？；;])|(?<=[.!?])(?:\s+|$)/gmu);
  let carriedCurrentEvalSubjectSentences = 0;
  let carryAcrossParagraphBoundary = false;
  for (const sentence of sentences) {
    const crossedParagraphBoundary = sentence.includes(paragraphBoundaryMarker);
    if (crossedParagraphBoundary && !carryAcrossParagraphBoundary) {
      carriedCurrentEvalSubjectSentences = 0;
    }
    const visibleNormalized = sentence.replaceAll(paragraphBoundaryMarker, " ")
      .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
      .replace(/\[([^\]]+)\]\[[^\]]*\]/gu, "$1")
      .replace(/\[([^\]]+)\]/gu, "$1")
      .replace(/<[^>]+>/gu, " ")
      .replace(/[`*_~]/gu, "")
      .replace(/\s+/gu, " ")
      .trim();
    if (visibleNormalized.length === 0) continue;
    // Exclude only an explicitly offline noun phrase from live-eval subject
    // detection, never the surrounding sentence or a separate live result.
    // Keep negated/mixed-mode phrases ambiguous and carry their subject forward.
    let hasAmbiguousOfflineEvalSubject = false;
    const normalized = visibleNormalized.replace(
      /\boffline[ -]+(?:ai[ -]+)?eval(?:uation)?\b|离线\s*(?:AI[ -]*eval(?:uation)?\b|(?:AI\s*)?评估)/giu,
      (phrase: string, offset: number) => {
        const prefix = visibleNormalized.slice(0, offset);
        if (/(?:\b(?:not|non)(?:[ -]+(?:merely|only|just|really|solely))?(?:[ -]+(?:an?|the))?[ -]*|[\p{L}\p{N}]\s*[-\/|&]\s*|\b(?:live|online)\s+(?:and|or)\s+(?:the\s+)?|(?:线上|在线|真实|live|online)\s*(?:及|和|与|或)\s*|非|并非|不是|并不是|不属于)\s*$/iu.test(prefix)) {
          hasAmbiguousOfflineEvalSubject = true;
          return phrase;
        }
        return "offline";
      },
    );
    const hasExplicitCurrentEvalSubject = /(?:\b(?:current|latest|newest|most\s+recent)\s+(?:local\s+)?(?:live[- ]?eval(?:uation)?|ai[- ]?eval(?:uation)?|evaluation)\b(?!\s+(?:contract|parser|schema|verifier|policy|rule|test|harness|documentation)\b)|\b(?:live[- ]?eval(?:uation)?|ai[- ]?eval(?:uation)?|evaluation)\s+(?:(?:is\s+|has\s+)?(?:currently|now|today|to\s+date)\b|remains?\b)|\b(?:at present|as of (?:today|now)|to\s+date)\s*,?\s*(?:the\s+)?(?:live[- ]?eval(?:uation)?|ai[- ]?eval(?:uation)?|evaluation)\b(?!\s+(?:contract|parser|schema|verifier|policy|rule|test|harness|documentation)\b)|(?:当前|目前|现在|最新|本次|本轮|最近一次|截至目前|迄今)(?:的|本地)?\s*(?:live[- ]?eval|AI\s*评估|评估)(?!\s*(?:合同|解析器|schema|验证器|策略|规则|测试|文档))|(?:live[- ]?eval|AI\s*评估|评估)\s*(?:当前|目前|现在|最新|本次|本轮|最近一次|截至目前|迄今))/iu
      .test(normalized);
    const hasMechanicsCurrentSubject = /(?:\b(?:current|latest|newest|most\s+recent)\s+(?:local\s+)?(?:live[- ]?eval(?:uation)?|ai[- ]?eval(?:uation)?|evaluation)\s+(?:contract|parser|schema|verifier|policy|rule|test|harness|documentation)\b|(?:当前|目前|现在|最新|本次|本轮|最近一次|截至目前)(?:的|本地)?\s*(?:live[- ]?eval|AI\s*评估|评估)\s*(?:合同|解析器|schema|验证器|策略|规则|测试|文档))/iu
      .test(normalized);
    const hasGenericCurrentSubject = /(?:\b(?:our\s+)?(?:current|latest|newest|most\s+recent)\s+(?:local\s+)?(?:attempt|run|report|result|score)\b|\b(?:at present|as of (?:today|now))\s*,?\s*(?:the\s+)?(?:attempt|run|report|result|score)\b|(?:当前|目前|现在|最新|本次|本轮|最近一次|截至目前)(?:的|本地)?\s*(?:尝试|运行|报告|结果|成绩))/iu
      .test(normalized);
    const hasCurrentSuiteIdentitySubject = /(?:\b(?:current|latest|newest|most\s+recent)\s+(?:sales-chat-live-v\d+|v\d+)\b|\bcurrent\s+sales-chat-live-v\d+\s+(?:attempt|run|report|result)\b|\bsales-chat-live-v\d+\s+(?:is\s+|has\s+)?(?:currently|now|today|to\s+date)\b|(?:当前|目前|现在|最新|本次|本轮|最近一次|截至目前|迄今)(?:的|本地)?\s*(?:sales-chat-live-v\d+|v\d+))/iu
      .test(normalized);
    const startsWithImplicitCurrentSubject = input.implicitEvalContext === true &&
      /^(?:(?:currently|now|today|presently|at present|as of (?:today|now))\b(?:\s|[,，:：])|(?:latest|newest|most\s+recent)\s*[,，:：-]|(?:当前|目前|现在|最新|本次|本轮|最近一次|截至目前)\s*[,，:：-])/iu
      .test(normalized);
    const hasRecentCompletionSubject = /(?:\b(?:just|freshly|newly)\s+(?:completed|finished|ran|released)\b.{0,48}\b(?:live[- ]?eval(?:uation)?|ai[- ]?eval(?:uation)?|evaluation|run|result)\b|\b(?:live[- ]?eval(?:uation)?|ai[- ]?eval(?:uation)?|evaluation|run|result)\b.{0,48}\b(?:just|freshly|newly)\s+(?:completed|finished|ran|released)\b|(?:刚|刚刚|新鲜出炉).{0,24}(?:live[- ]?eval|AI\s*评估|评估|运行|结果)|(?:live[- ]?eval|AI\s*评估|评估|运行|结果).{0,24}(?:刚|刚刚|新鲜出炉))/iu
      .test(normalized);
    const hasAdditionalCurrentSubject = /(?:\b(?:last|new)\s+(?:local\s+)?(?:live[- ]?eval(?:uation)?|ai[- ]?eval(?:uation)?|evaluation|attempt|run|report|result|score)\b|(?:上次|刚才|新出炉)(?:的|本地)?\s*(?:live[- ]?eval|AI\s*评估|评估|尝试|运行|报告|结果|成绩))/iu
      .test(normalized);
    const resultCandidate = normalized
      .replace(
        /\bnot\s+(?:the\s+)?(?:newest|latest)\s+(?:pass(?:ed|ing)|successful)\s+(?:run|report|result|observation)\b/giu,
        "",
      )
      .replace(
        /\b(?:does|do|is|are)\s+not\b.{0,40}\b(?:a\s+)?(?:pass|success)(?:ful)?\s+rate\b/giu,
        "",
      )
      .replace(
        /不(?:会|应|能|可)?(?:冒充|代表|等同于|视为|作为)?.{0,24}(?:成功率|通过率)(?:评估|成绩)?/gu,
        "",
      )
      .replace(
        /\b(?:report|scorer)\s+(?:(?:self[- ]?)?consistency)(?:\s+(?:checks?|verification))?\s+(?:pass(?:ed|ing)?|success)(?:\s+(?:alone|by\s+itself))?\s+(?:does|do|is|are)\s+not\s+(?:itself\s+)?(?:constitute|form|prove|establish|represent).{0,48}\b(?:provider|model)[- ]?(?:quality|performance)\s+evidence\b/giu,
        "",
      )
      .replace(
        /(?:报告|scorer)(?:自洽性|一致性)(?:检查|校验)?(?:通过|成功)?(?:本身|单独)?不(?:会|应|能|可|足以)?(?:形成|构成|代表|证明|等同于|视为).{0,48}(?:provider(?:\s*模型)?|模型).{0,24}(?:质量|性能).{0,16}(?:证据|结论)/giu,
        "",
      );
    const hasOutcome = /(?:\b(?:pass(?:ed|es|ing)?|fail(?:ed|ure|s|ing)?|succeed(?:ed|s|ing)?|successful|success|green|met|cleared|complete(?:d|s|ly)?|incomplete)\b|\bpass\s+rate\b|通过|未通过|失败|成功|达标|全绿|合格|完成|未完成|thresholdsPassed\s*=\s*(?:true|false))/iu
      .test(resultCandidate);
    const hasScoredValue = /(?:\d+\s*(?:\/|\b(?:out\s+)?of\b)\s*\d+|\b(?:all\s+)?eighteen\s+cases?\b|(?:全部|所有)?\s*十八条?\s*(?:case|案例|用例)|\d+(?:\.\d+)?\s*(?:%|percent\b))/iu
      .test(normalized);
    const hasConcreteIdentity = /(?:\bsales-chat-live-v\d+\b|\bv\d+\b|evaluatedAt\s*`?\d{4}-\d{2}-\d{2}T|run\s+ID\s*`?[0-9a-f-]{36}|source\s+fingerprint\s*`?[0-9a-f]{64}|(?:terminationReason|runError)\s*=)/iu
      .test(normalized);
    const hasResidualHtmlEntity = /&(?:#[^;\s]{1,12}|[a-z][a-z0-9]{1,31});/iu
      .test(normalized);
    const hasConcreteResult = hasOutcome || hasScoredValue ||
      hasConcreteIdentity || hasResidualHtmlEntity;
    const hasMechanicsNoun = /(?:\b(?:contract|parser|schema|verifier|verify|verification|policy|rule|test|harness|documentation|gate|consistency|provenance)\b|合同|解析器|schema|验证器|校验|验证|策略|规则|测试|文档|一致性门|校验门|来源证明)/iu
      .test(normalized);
    const hasProtocolMechanicsStatement =
      /(?:\bEVAL_?BUDGET_?STOP\b.{0,96}\b(?:record(?:s|ed)?|write(?:s|written)?|mark(?:s|ed)?|skip(?:s|ped)?)\b|\b(?:budget|usage|token)\b.{0,48}\b(?:stop|termination|guard)\b.{0,96}\b(?:record(?:s|ed)?|write(?:s|written)?|mark(?:s|ed)?|skip(?:s|ped)?)\b|(?:预算|用量|token).{0,24}(?:停止|终止).{0,80}(?:写|记录|标记|跳过))/iu
        .test(normalized);
    const hasNormativeMechanicsVerb = /(?:\b(?:defines?|requires?|enforces?|sets?|checks?|rejects?|validates?|describes?|explains?|tests?|parses?|retains?|archives?|preserves?|derives?|recomputes?|compares?|binds?)\b|定义|要求|强制|设定|检查|拒绝|校验|验证|保留|归档|说明|解释|测试|解析|派生|重算|比较|核对|绑定)/iu
      .test(normalized);
    const hasAllowedMechanicsStatement = hasProtocolMechanicsStatement ||
      ((hasMechanicsCurrentSubject || hasMechanicsNoun) &&
        (hasNormativeMechanicsVerb ||
          /(?:\b(?:contract|parser|schema|verifier|policy|rule|test|harness|documentation)\s+(?:pass(?:ed|es|ing)?|fail(?:ed|ure|s|ing)?|succeed(?:ed|s|ing)?)\s+(?:its?\b|in\b)|(?:合同|解析器|schema|验证器|策略|规则|测试|文档)\s*(?:通过|失败|成功).{0,16}(?:审查|检查|解析))/iu
            .test(normalized)));
    const hasAnyEvalSubject = /(?:\b(?:live[- ]?eval(?:uation)?|ai[- ]?eval(?:uation)?|sales-chat-live-v\d+)\b|AI\s*评估|评估)/iu
      .test(normalized);
    const hasHistoricalEvalContext = /(?:\b(?:historical|legacy|previous|prior|earlier|archived|retained|old)\b.{0,40}\b(?:live[- ]?eval(?:uation)?|ai[- ]?eval(?:uation)?|evaluation|attempt|run|report|result|score|observation)\b|\b(?:live[- ]?eval(?:uation)?|ai[- ]?eval(?:uation)?|evaluation|attempt|run|report|result|score|observation)\s+(?:from\s+)?(?:an?\s+)?(?:historical|legacy|previous|prior|earlier|archived|retained)\b|(?:历史|旧版|此前|先前|早期|归档|曾经|当时)(?:的)?.{0,24}(?:live[- ]?eval|AI\s*评估|评估|尝试|运行|报告|结果|成绩|观测))/iu
      .test(normalized) ||
      (/\barchive\/[^\s)]+/iu.test(normalized) &&
        !hasExplicitCurrentEvalSubject && !hasGenericCurrentSubject &&
        !hasCurrentSuiteIdentitySubject && !hasRecentCompletionSubject &&
        !hasAdditionalCurrentSubject);
    const hasEvalResultRelation = /(?:(?:\b(?:live[- ]?eval(?:uation)?|ai[- ]?eval(?:uation)?|sales-chat-live-v\d+)\b|AI\s*评估|评估).{0,80}(?:\b(?:pass(?:ed|es|ing)?|fail(?:ed|ure|s|ing)?|succeed(?:ed|s|ing)?|successful|success|green|met|cleared|complete(?:d|s|ly)?|incomplete)\b|\d+\s*(?:\/|\b(?:out\s+)?of\b)\s*\d+|\d+(?:\.\d+)?\s*(?:%|percent\b)|通过|未通过|失败|成功|达标|全绿|合格|完成|未完成)|(?:\b(?:pass(?:ed|es|ing)?|fail(?:ed|ure|s|ing)?|successful|complete(?:d|s|ly)?|incomplete)\b|通过|未通过|失败|成功|完成|未完成).{0,16}(?:\b(?:live[- ]?eval(?:uation)?|ai[- ]?eval(?:uation)?|sales-chat-live-v\d+)\b|AI\s*评估|评估))/iu
      .test(resultCandidate);
    const hasUnqualifiedEvalResult = hasAnyEvalSubject &&
      (hasEvalResultRelation || hasResidualHtmlEntity) &&
      !hasHistoricalEvalContext && !hasAllowedMechanicsStatement;
    if (
      hasUnqualifiedEvalResult ||
      (hasConcreteResult && !hasAllowedMechanicsStatement &&
        (hasCurrentSuiteIdentitySubject || hasExplicitCurrentEvalSubject ||
        (hasAmbiguousOfflineEvalSubject && !hasHistoricalEvalContext) ||
        hasRecentCompletionSubject ||
        hasAdditionalCurrentSubject ||
        startsWithImplicitCurrentSubject ||
        carriedCurrentEvalSubjectSentences > 0 ||
        (hasMechanicsCurrentSubject && !hasAllowedMechanicsStatement) ||
        (hasGenericCurrentSubject &&
          (input.implicitEvalContext === true || hasScoredValue))))
    ) {
      throw new Error(
        `${input.documentLabel} must keep every concrete current live-eval result only in the canonical ledger. ` +
          `Offending text: ${JSON.stringify(visibleNormalized.slice(0, 200))}.`,
      );
    }
    if (
      hasExplicitCurrentEvalSubject || hasGenericCurrentSubject ||
      hasCurrentSuiteIdentitySubject || hasRecentCompletionSubject ||
      hasAdditionalCurrentSubject ||
      (hasAmbiguousOfflineEvalSubject && !hasHistoricalEvalContext &&
        !hasAllowedMechanicsStatement)
    ) {
      carriedCurrentEvalSubjectSentences = 2;
      carryAcrossParagraphBoundary = /(?:[:：]\s*$|\b(?:follows|below|next)\b|如下|见下)/iu
        .test(normalized);
    } else {
      carriedCurrentEvalSubjectSentences = Math.max(
        0,
        carriedCurrentEvalSubjectSentences - 1,
      );
      carryAcrossParagraphBoundary = false;
    }
  }
}

function findUniqueStatusBullet(
  markdown: string,
  prefix: string,
  label: string,
): string {
  const lines = markdown.split(/\r?\n/u);
  const starts = lines.flatMap((line, index) => {
    const bulletText = line.replace(/^-\s+/u, "");
    return bulletText !== line && bulletText.startsWith(prefix) ? [index] : [];
  });
  if (starts.length !== 1 || starts[0] === undefined) {
    throw new Error(`docs/STATUS.md must contain exactly one ${label}.`);
  }
  let end = starts[0] + 1;
  while (
    end < lines.length &&
    !/^(?:-\s+|#{1,6}\s+)/u.test(lines[end] ?? "")
  ) {
    end += 1;
  }
  return lines.slice(starts[0], end).join("\n").trimEnd();
}

export function parseStatusSnapshot(markdown: string): StatusSnapshot {
  if (
    countLiteral(markdown, portfolioSnapshotStart) !== 1 ||
    countLiteral(markdown, portfolioSnapshotEnd) !== 1
  ) {
    throw new Error(
      "docs/STATUS.md must contain exactly one portfolio verification snapshot.",
    );
  }
  const matches = [...markdown.matchAll(
    /<!-- portfolio-verification:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- portfolio-verification:end -->/gu,
  )];
  if (matches.length !== 1 || !matches[0]?.[1]) {
    throw new Error(
      "docs/STATUS.md is missing the portfolio verification snapshot.",
    );
  }
  const snapshotText = matches[0][1];
  const snapshotValue: unknown = JSON.parse(snapshotText);
  const normalizedSnapshotText = snapshotText.replaceAll("\r\n", "\n").trim();
  if (normalizedSnapshotText !== JSON.stringify(snapshotValue, null, 2)) {
    throw new Error(
      "docs/STATUS.md portfolio verification snapshot must use canonical two-space JSON without duplicate keys.",
    );
  }
  return statusSnapshotSchema.parse(snapshotValue);
}

export function parseCurrentQualityProse(
  markdown: string,
): QualityProseSnapshot {
  const prose = visibleStatusProse(markdown);
  const qualityBullet = findUniqueStatusBullet(
    prose,
    "当前唯一 Vitest 执行证据指针：",
    "current Vitest execution-evidence pointer bullet",
  );
  const matches = [...qualityBullet.matchAll(
    /^- 当前唯一 Vitest 执行证据指针：artifact `([^`\r\n]+)`；format `([^`\r\n]+)`。\r?\n  动态测试计数、执行时间、HEAD 与 source fingerprint 仅从该 artifact 派生；`STATUS\.md` 不复制这些值。$/gu,
  )];
  const match = matches.length === 1 ? matches[0] : undefined;
  if (!match?.[1] || !match[2]) {
    throw new Error(
      "docs/STATUS.md must contain exactly one canonical Vitest execution-evidence pointer.",
    );
  }
  return {
    artifactPath: match[1],
    version: match[2],
  };
}

export function formatStatusQualityProse(
  snapshot: StatusSnapshot["qualitySnapshot"],
): string {
  return [
    `- 当前唯一 Vitest 执行证据指针：artifact \`${snapshot.artifactPath}\`；format \`${snapshot.version}\`。`,
    "  动态测试计数、执行时间、HEAD 与 source fingerprint 仅从该 artifact 派生；`STATUS.md` 不复制这些值。",
  ].join("\n");
}

export function parseCurrentBrowserProse(
  markdown: string,
): BrowserProseSnapshot {
  const prose = visibleStatusProse(markdown);
  const browserBullet = findUniqueStatusBullet(
    prose,
    "当前浏览器证据快照：",
    "current Playwright evidence bullet",
  );
  const identityMatches = [...browserBullet.matchAll(
    /当前浏览器证据快照：format `([^`]+)`，run ID `([0-9a-f-]{36})`，artifact SHA-256 `([0-9a-f]{64})`；[\s\S]*?observedAt `([^`]+)`，(clean|dirty) worktree \/ base HEAD `([0-9a-f]{40})`；/gu,
  )];
  const identity = identityMatches.length === 1
    ? identityMatches[0]
    : undefined;
  if (
    !identity?.[1] || !identity[2] || !identity[3] || !identity[4] ||
    !identity[5] || !identity[6]
  ) {
    throw new Error(
      "docs/STATUS.md must contain exactly one canonical Playwright evidence identity.",
    );
  }
  const runs = playwrightRunContracts.map(({ id }) => {
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const matches = [...browserBullet.matchAll(
      new RegExp(
        `\`${escapedId}\` = \`(\\d+) passed / (\\d+) skipped / (\\d+) failed / (\\d+) flaky / (\\d+) collected\``,
        "gu",
      ),
    )];
    const match = matches.length === 1 ? matches[0] : undefined;
    if (!match?.[1] || !match[2] || !match[3] || !match[4] || !match[5]) {
      throw new Error(`docs/STATUS.md is missing the ${id} Playwright result.`);
    }
    return {
      collected: Number(match[5]),
      failed: Number(match[3]),
      flaky: Number(match[4]),
      passed: Number(match[1]),
      skipped: Number(match[2]),
      id,
    };
  });
  const aggregateMatches = [...browserBullet.matchAll(
    /聚合为 (\d+) passed \/ (\d+) skipped \/ (\d+) failed \/ (\d+) flaky \/ (\d+) collected。artifact 为 (\d+) bytes；[\s\S]*?browser source fingerprint 为 (\d+) files \/ `([0-9a-f]{64})`。[\s\S]*?因运行发生在 (clean|dirty) worktree，`evaluatedCommit=(null|[0-9a-f]{40})`；/gu,
  )];
  const aggregate = aggregateMatches.length === 1
    ? aggregateMatches[0]
    : undefined;
  if (
    !aggregate?.[1] || !aggregate[2] || !aggregate[3] || !aggregate[4] ||
    !aggregate[5] || !aggregate[6] || !aggregate[7] || !aggregate[8] ||
    !aggregate[9] || !aggregate[10] || aggregate[9] !== identity[5]
  ) {
    throw new Error(
      "docs/STATUS.md must contain exactly one canonical Playwright aggregate observation.",
    );
  }
  return {
    artifactByteLength: Number(aggregate[6]),
    artifactSha256: identity[3],
    baseHeadCommit: identity[6],
    evaluatedCommit: aggregate[10] === "null" ? null : aggregate[10],
    observedAt: identity[4],
    runId: identity[2],
    runs,
    sourceFingerprint: {
      algorithm: "sha256",
      digest: aggregate[8],
      fileCount: Number(aggregate[7]),
    },
    totals: {
      collected: Number(aggregate[5]),
      failed: Number(aggregate[3]),
      flaky: Number(aggregate[4]),
      passed: Number(aggregate[1]),
      skipped: Number(aggregate[2]),
    },
    version: identity[1],
    worktreeState: identity[5] as "clean" | "dirty",
  };
}

export function parseCurrentReleaseProse(
  markdown: string,
): ReleaseProseSnapshot {
  const prose = visibleStatusProse(markdown);
  const currentReleaseBullet = findUniqueStatusBullet(
    prose,
    "公开只读演示：",
    "current public release observation bullet",
  );
  const documentedReleaseBullet = findUniqueStatusBullet(
    prose,
    "最后一个完整记录了发布步骤与独立读回的时间戳 release lineage 仍是",
    "last documented release bullet",
  );
  const currentMatches = [...currentReleaseBullet.matchAll(
    /observedAt=`([^`]+)`；`\/api\/health` readbackAt=`([^`]+)` returned `status=(ok)`,\s*`version=([0-9a-f]{40})`；服务器当前 release 链接解析为\s*`(\/opt\/diesel\/releases\/[0-9a-f]{40})`[\s\S]*?当前公开 release ID\s*与 Git commit 均为该完整 SHA；同时观测的本地 `master` 和只读\s*`git ls-remote origin master` 也均为该 SHA/gu,
  )];
  const evidenceKindMatches = [...currentReleaseBullet.matchAll(
    /该记录的证据类型固定为\s*`(historical-operator-record-only)`/gu,
  )];
  const documentedMatches = [...documentedReleaseBullet.matchAll(
    /release\s*`(\d{14})`\s*\/\s*Git\s*`([0-9a-f]{40})`/gu,
  )];
  const current = currentMatches[0];
  const documented = documentedMatches[0];
  if (
    currentMatches.length !== 1 ||
    documentedMatches.length !== 1 ||
    !current?.[1] ||
    !current[2] ||
    !current[3] ||
    !current[4] ||
    !current[5] ||
    evidenceKindMatches.length !== 1 ||
    !evidenceKindMatches[0]?.[1] ||
    !documented?.[1] ||
    !documented[2]
  ) {
    throw new Error(
      "docs/STATUS.md must contain exactly one canonical current public release observation.",
    );
  }
  const observedAt = minutePrecisionTimestampSchema.parse(current[1]);
  const readbackAt = minutePrecisionTimestampSchema.parse(current[2]);
  return {
    currentPublicReleaseCommit: current[4],
    currentPublicReleaseEvidenceKind: evidenceKindMatches[0][1] as "historical-operator-record-only",
    currentPublicReleaseObservedAt: observedAt,
    currentPublicReleasePath: current[5],
    lastDocumentedReleaseCommit: documented[2],
    lastDocumentedReleaseId: documented[1],
    publicRuntimeReadbackAt: readbackAt,
    publicRuntimeEvidenceKind: evidenceKindMatches[0][1] as "historical-operator-record-only",
    publicRuntimeStatus: current[3] as "ok",
    publicRuntimeVersion: current[4],
  };
}

export function parseEvidenceSummaryProse(
  markdown: string,
): EvidenceSummaryProseSnapshot {
  const prose = visibleStatusProse(markdown);
  const closureBullet = findUniqueStatusBullet(
    prose,
    "`ACCEPTANCE.md` #166–#264",
    "current evidence-closure bullet",
  );
  const closureMatches = [...closureBullet.matchAll(
    /`(\d+) jurisdictions \/ (\d+) regulations \/ (\d+) limits \/ (\d+) sources`/gu,
  )];
  const closure = closureMatches.length === 1 ? closureMatches[0] : undefined;
  const approvalRows = [...prose.matchAll(
    /^\|\s*真实产品\/认证\s*\|\s*(\d+)\s*条获准公开 fixture\s*\|.*$/gmu,
  )];
  const approvals = approvalRows.length === 1 ? approvalRows[0] : undefined;
  if (
    !closure?.[1] ||
    !closure[2] ||
    !closure[3] ||
    !closure[4] ||
    !approvals?.[1]
  ) {
    throw new Error(
      "docs/STATUS.md is missing the current public evidence summary.",
    );
  }
  return {
    approvedRealFixtures: Number(approvals[1]),
    jurisdictions: Number(closure[1]),
    limits: Number(closure[3]),
    regulations: Number(closure[2]),
    sources: Number(closure[4]),
  };
}

const vitestRunnableJsonSchema = z.array(
  z.object({
    file: z.string().min(1).max(4_096),
    name: z.string().min(1).max(20_000),
  }).strict(),
).min(1).max(100_000);

export type VitestRunnableInventory = {
  runnableFiles: number;
  runnableTests: number;
  sourcePaths: string[];
};

export function countVitestRunnableJson(
  output: string,
  workspace: string,
): VitestRunnableInventory {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(output);
  } catch (cause: unknown) {
    throw new Error("Vitest list output was not valid JSON.", { cause });
  }
  const rows = vitestRunnableJsonSchema.parse(parsedJson);
  const normalizedWorkspace = resolve(workspace);
  let physicalWorkspace: string;
  try {
    physicalWorkspace = realpathSync(normalizedWorkspace);
  } catch (cause: unknown) {
    throw new Error("Vitest workspace could not be resolved.", { cause });
  }
  if (physicalWorkspace !== normalizedWorkspace) {
    throw new Error("Vitest workspace must not traverse a symbolic link.");
  }
  const files = new Set<string>();
  for (const row of rows) {
    if (!isAbsolute(row.file) || resolve(row.file) !== row.file) {
      throw new Error("Vitest list contains a noncanonical test file path.");
    }
    const repositoryPath = relative(normalizedWorkspace, row.file);
    if (
      repositoryPath.length === 0 ||
      repositoryPath === ".." ||
      repositoryPath.startsWith(`..${sep}`) ||
      isAbsolute(repositoryPath)
    ) {
      throw new Error("Vitest list contains a test outside the workspace.");
    }
    const portablePath = repositoryPath.split(sep).join("/");
    if (!/^tests\/(?:[^/]+\/)*[^/]+\.test\.ts$/u.test(portablePath)) {
      throw new Error("Vitest list contains a source outside the canonical test suite.");
    }
    let metadata: ReturnType<typeof lstatSync>;
    let physicalFile: string;
    try {
      metadata = lstatSync(row.file);
      physicalFile = realpathSync(row.file);
    } catch (cause: unknown) {
      throw new Error(`Vitest test source is missing: ${portablePath}`, { cause });
    }
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`Vitest test source is not a regular file: ${portablePath}`);
    }
    if (physicalFile !== resolve(physicalWorkspace, repositoryPath)) {
      throw new Error(`Vitest test source traverses a symbolic link: ${portablePath}`);
    }
    files.add(portablePath);
  }
  return {
    runnableFiles: files.size,
    runnableTests: rows.length,
    sourcePaths: [...files].sort(),
  };
}

export function assertQualitySnapshotConsistency(
  snapshot: StatusSnapshot["qualitySnapshot"],
  prose: QualityProseSnapshot,
): void {
  assertVerificationEqual(snapshot, prose, "STATUS Vitest execution-evidence pointer");
}

export function assertBrowserSnapshotConsistency(
  snapshot: StatusSnapshot["browserSnapshot"],
  prose: BrowserProseSnapshot,
  evidence: PlaywrightEvidence,
  artifactText: string,
): void {
  const evidenceRuns = evidence.runs.map(({ id, totals }) => ({
    collected: totals.collected,
    failed: totals.failed,
    flaky: totals.flaky,
    passed: totals.passed,
    skipped: totals.skipped,
    id,
  }));
  const evidenceTotals = evidenceRuns.reduce<PlaywrightResultCounts>(
    (totals, run) => ({
      collected: totals.collected + run.collected,
      failed: totals.failed + run.failed,
      flaky: totals.flaky + run.flaky,
      passed: totals.passed + run.passed,
      skipped: totals.skipped + run.skipped,
    }),
    { collected: 0, failed: 0, flaky: 0, passed: 0, skipped: 0 },
  );
  const expectedSnapshot = {
    artifactByteLength: Buffer.byteLength(artifactText, "utf8"),
    artifactPath: playwrightEvidencePath,
    artifactSha256: sha256Text(artifactText),
    baseHeadCommit: evidence.provenance.baseHeadCommit,
    evaluatedCommit: evidence.provenance.evaluatedCommit,
    observedAt: evidence.evaluatedAt,
    runId: evidence.runId,
    runs: evidenceRuns,
    sourceFingerprint: evidence.provenance.sourceFingerprint,
    version: evidence.version,
    worktreeState: evidence.provenance.worktreeState,
  };
  assertVerificationEqual(
    snapshot,
    expectedSnapshot,
    "STATUS Playwright artifact snapshot",
  );
  assertVerificationEqual(
    prose,
    {
      artifactByteLength: snapshot.artifactByteLength,
      artifactSha256: snapshot.artifactSha256,
      baseHeadCommit: snapshot.baseHeadCommit,
      evaluatedCommit: snapshot.evaluatedCommit,
      observedAt: snapshot.observedAt,
      runId: snapshot.runId,
      runs: snapshot.runs,
      sourceFingerprint: snapshot.sourceFingerprint,
      totals: evidenceTotals,
      version: snapshot.version,
      worktreeState: snapshot.worktreeState,
    },
    "STATUS Playwright prose",
  );
}

export function assertReleaseSnapshotConsistency(
  snapshot: StatusSnapshot,
): void {
  assertVerificationEqual(
    snapshot.repositoryHead.local,
    snapshot.repositoryHead.remote,
    "Observed local/remote repository head",
  );
  assertVerificationEqual(
    snapshot.currentPublicRelease.id,
    snapshot.currentPublicRelease.commit,
    "Current public release ID/commit",
  );
  assertVerificationEqual(
    snapshot.currentPublicRelease.commit,
    snapshot.repositoryHead.remote,
    "Current public release/repository head",
  );
  assertVerificationEqual(
    snapshot.publicRuntime.version,
    snapshot.currentPublicRelease.commit,
    "Public runtime/release version",
  );
  assertVerificationEqual(
    snapshot.currentPublicRelease.releasePath,
    `/opt/diesel/releases/${snapshot.currentPublicRelease.id}`,
    "Current public release path",
  );
  assertVerificationEqual(
    snapshot.repositoryHead.observedAt,
    snapshot.currentPublicRelease.observedAt,
    "Repository/public release observation time",
  );
  assertVerificationEqual(
    snapshot.publicRuntime.readbackAt,
    snapshot.currentPublicRelease.observedAt,
    "Public runtime/release observation time",
  );
}

export function assertReleaseProseConsistency(
  snapshot: StatusSnapshot,
  prose: ReleaseProseSnapshot,
): void {
  assertVerificationEqual(
    prose,
    {
      currentPublicReleaseCommit: snapshot.currentPublicRelease.commit,
      currentPublicReleaseEvidenceKind: snapshot.currentPublicRelease.evidenceKind,
      currentPublicReleaseObservedAt: snapshot.currentPublicRelease.observedAt,
      currentPublicReleasePath: snapshot.currentPublicRelease.releasePath,
      lastDocumentedReleaseCommit: snapshot.lastDocumentedRelease.commit,
      lastDocumentedReleaseId: snapshot.lastDocumentedRelease.id,
      publicRuntimeReadbackAt: snapshot.publicRuntime.readbackAt,
      publicRuntimeEvidenceKind: snapshot.publicRuntime.evidenceKind,
      publicRuntimeStatus: snapshot.publicRuntime.status,
      publicRuntimeVersion: snapshot.publicRuntime.version,
    },
    "STATUS public release prose",
  );
}

export function assertEvidenceSummaryConsistency(
  actual: EvidenceSummary,
  expected: EvidenceSummary,
): void {
  assertVerificationEqual(actual, expected, "Evidence summary");
}

export function assertEvidenceSummaryProseConsistency(
  snapshot: EvidenceSummary,
  prose: EvidenceSummaryProseSnapshot,
): void {
  assertVerificationEqual(
    prose,
    {
      approvedRealFixtures:
        snapshot.approvedRealProducts + snapshot.approvedRealCertifications,
      jurisdictions: snapshot.jurisdictions,
      limits: snapshot.limits,
      regulations: snapshot.regulations,
      sources: snapshot.sources,
    },
    "STATUS public evidence summary prose",
  );
}
