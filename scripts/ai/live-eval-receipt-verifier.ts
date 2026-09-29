import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { z } from "zod";

import { SALES_CHAT_LIVE_EVAL_VERSION } from "../../evals/sales-chat-live-cases";
import {
  LIVE_EVAL_OBSERVATIONS_VERSION,
  MAX_LIVE_EVAL_OBSERVATIONS_BYTES,
  parseCanonicalLiveEvalObservations,
} from "./live-eval-observations";
import {
  captureLiveEvalSourceFingerprint,
  captureLiveEvalSourceFingerprintAtRevision,
  captureLiveEvalRepositoryState,
} from "./live-eval-report";
import { liveEvalReportSchema } from "../portfolio/live-eval-report-schema";
import { parseStatusSnapshot } from "../portfolio/status-snapshot";
import { verifyLiveEvalPassCandidate } from "../portfolio/verify-live-eval";
import { verifyLiveEvalObservations } from "./verify-live-eval-observations";

const MAX_LIVE_EVAL_REPORT_BYTES = 8 * 1024 * 1024;
const reportReceiptSchema = z.object({
  byteLength: z.number().int().positive().max(MAX_LIVE_EVAL_REPORT_BYTES),
  evaluatedAt: z.string().datetime({ offset: false }),
  runId: z.string().uuid(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
}).strict();
const observationsReceiptSchema = z.object({
  byteLength: z.number().int().positive().max(MAX_LIVE_EVAL_OBSERVATIONS_BYTES),
  caseCount: z.literal(18),
  evaluatedAt: z.string().datetime({ offset: false }),
  runId: z.string().uuid(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  version: z.literal(LIVE_EVAL_OBSERVATIONS_VERSION),
}).strict();
const observationsEnvelopeSchema = z.object({
  receipt: observationsReceiptSchema,
  reportText: z.string(),
}).strict();
const verificationRequestSchema = z.object({
  messageId: z.string().uuid(),
  observations: observationsEnvelopeSchema.nullable(),
  protocolVersion: z.literal(2),
  reportReceipt: reportReceiptSchema,
  reportText: z.string(),
  type: z.literal("verify_live_eval_report"),
}).strict();

type VerificationRequest = z.infer<typeof verificationRequestSchema>;

function serializeCanonicalJson(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) {
    throw new Error("Live eval JSON must serialize to a defined value.");
  }
  return `${serialized}\n`;
}

function parseCanonicalJson(text: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Live eval report has invalid JSON.");
  }
  if (serializeCanonicalJson(parsed) !== text) {
    throw new Error("Live eval report does not use canonical JSON bytes.");
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function receiveVerificationRequest(): Promise<VerificationRequest> {
  return new Promise((resolveRequest, rejectRequest) => {
    process.once("message", (input: unknown) => {
      const parsed = verificationRequestSchema.safeParse(input);
      if (!parsed.success) {
        rejectRequest(new Error("Invalid live-eval verification request."));
        return;
      }
      resolveRequest(parsed.data);
    });
  });
}

function sendVerificationResponse(input: {
  messageId: string;
  observationsReceipt: z.infer<typeof observationsReceiptSchema> | null;
  reportCanPass: boolean;
  reportReceipt: VerificationRequest["reportReceipt"];
}): Promise<void> {
  return new Promise((resolveResponse, rejectResponse) => {
    if (typeof process.send !== "function" || !process.connected) {
      rejectResponse(new Error("Live-eval verifier requires an IPC channel."));
      return;
    }
    process.send(
      {
        messageId: input.messageId,
        observationsReceipt: input.observationsReceipt,
        protocolVersion: 2,
        reportCanPass: input.reportCanPass,
        reportReceipt: input.reportReceipt,
        type: "live_eval_report_verified",
      },
      (error) => {
        if (error) {
          rejectResponse(error);
          return;
        }
        resolveResponse();
      },
    );
  });
}

async function main(): Promise<void> {
  if (typeof process.send !== "function") {
    throw new Error("Live-eval verifier requires an IPC channel.");
  }
  const request = await receiveVerificationRequest();
  const reportBytes = Buffer.from(request.reportText, "utf8");
  try {
    if (
      reportBytes.byteLength !== request.reportReceipt.byteLength ||
      reportBytes.byteLength > MAX_LIVE_EVAL_REPORT_BYTES ||
      createHash("sha256").update(reportBytes).digest("hex") !==
        request.reportReceipt.sha256
    ) {
      throw new Error("Live-eval verification bytes do not match the receipt.");
    }
  } finally {
    reportBytes.fill(0);
  }
  const report = parseCanonicalJson(request.reportText);
  if (
    !isRecord(report) ||
    report.evaluatedAt !== request.reportReceipt.evaluatedAt ||
    report.runId !== request.reportReceipt.runId
  ) {
    throw new Error("Live-eval verification identity does not match the receipt.");
  }
  const parsedReport = liveEvalReportSchema.parse(report);
  const sourceWorkspace = resolve(
    fileURLToPath(new URL("../..", import.meta.url)),
  );
  const status = parseStatusSnapshot(
    await readFile(resolve(sourceWorkspace, "docs/STATUS.md"), "utf8"),
  );
  const verified = await verifyLiveEvalPassCandidate({
    expectations: {
      expectedModelId: status.liveEval.expectedModelId,
      expectedProviderProfile: status.liveEval.expectedProviderProfile,
      suiteVersion: status.liveEval.suiteVersion,
      suiteCaseCount: status.liveEval.suiteCaseCount,
    },
    report,
  });
  if (verified.thresholdsPassed !== (request.observations !== null)) {
    throw new Error("Live-eval observations do not match the verified outcome.");
  }
  let observationsReceipt: z.infer<typeof observationsReceiptSchema> | null =
    null;
  if (request.observations !== null) {
    const observationBytes = Buffer.from(request.observations.reportText, "utf8");
    try {
      const receipt = request.observations.receipt;
      if (
        observationBytes.byteLength !== receipt.byteLength ||
        createHash("sha256").update(observationBytes).digest("hex") !==
          receipt.sha256 ||
        receipt.runId !== parsedReport.runId ||
        receipt.evaluatedAt !== parsedReport.evaluatedAt
      ) {
        throw new Error("Live-eval observation bytes do not match the receipt.");
      }
      const parsedObservations = parseCanonicalLiveEvalObservations(
        request.observations.reportText,
      );
      verifyLiveEvalObservations({ observations: parsedObservations, report });
      observationsReceipt = receipt;
    } finally {
      observationBytes.fill(0);
    }
  }
  if (parsedReport.version !== SALES_CHAT_LIVE_EVAL_VERSION) {
    throw new Error("Live-eval verifier accepted an incompatible report version.");
  }
  if (parsedReport.runError === null) {
    const [currentSourceFingerprint, currentRepository] = await Promise.all([
      captureLiveEvalSourceFingerprint(sourceWorkspace),
      Promise.resolve(captureLiveEvalRepositoryState(sourceWorkspace)),
    ]);
    const reportRepository = parsedReport.provenance.repository;
    if (
      currentSourceFingerprint.status !== "captured" ||
      JSON.stringify(currentSourceFingerprint) !==
        JSON.stringify(parsedReport.provenance.sourceFingerprint) ||
      currentRepository.worktreeState === "unavailable" ||
      reportRepository.worktreeState === "unavailable" ||
      currentRepository.baseHeadCommit !== reportRepository.baseHeadCommit
    ) {
      throw new Error("Live-eval source provenance could not be verified.");
    }
    if (reportRepository.worktreeState === "dirty") {
      if (reportRepository.evaluatedCommit !== null) {
        throw new Error("Dirty live-eval provenance cannot claim an exact commit.");
      }
    } else if (
      reportRepository.evaluatedCommit !== reportRepository.baseHeadCommit
    ) {
      throw new Error("Clean live-eval provenance must bind its HEAD commit.");
    }
    const commitSourceFingerprint =
      await captureLiveEvalSourceFingerprintAtRevision(
        sourceWorkspace,
        reportRepository.baseHeadCommit,
      );
    if (
      commitSourceFingerprint.status !== "captured" ||
      (reportRepository.worktreeState === "clean" &&
        JSON.stringify(commitSourceFingerprint) !==
          JSON.stringify(parsedReport.provenance.sourceFingerprint))
    ) {
      throw new Error("Live-eval repository provenance could not be verified.");
    }
  }
  await sendVerificationResponse({
    messageId: request.messageId,
    observationsReceipt,
    reportCanPass: verified.thresholdsPassed,
    reportReceipt: request.reportReceipt,
  });
  if (process.connected) {
    process.disconnect();
  }
  process.exit(0);
}

void main().catch(() => {
  process.stderr.write("Live-eval report consistency verification failed.\n");
  if (process.connected) {
    process.disconnect();
  }
  process.exit(1);
});
