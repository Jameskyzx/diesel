import { randomUUID } from "node:crypto";

import { z } from "zod";

import { safeLiveEvalErrorName } from "./live-eval-error";
import { runLiveEval } from "./live-eval";
import type { InMemoryLiveEvalObservations } from "./live-eval-observations";
import type { LiveEvalReportReceipt } from "./live-eval-report";
import {
  formatFailedPublicResponseDiagnostic,
  liveEvalPublicDiagnosticsEnabled,
  type FailedPublicResponseDiagnostic,
} from "./live-eval-diagnostics";
import {
  formatFailedSourceEvidenceDiagnostic,
  type FailedSourceEvidenceDiagnostic,
} from "./live-eval-source-diagnostics";

const bootstrapAcknowledgmentSchema = z.object({
  messageId: z.string().uuid(),
  type: z.literal("bootstrap_ack"),
}).strict();
const reportAcknowledgmentSchema = bootstrapAcknowledgmentSchema.extend({
  exitCode: z.union([z.literal(0), z.literal(1)]),
}).strict();
const PROVIDER_ACKNOWLEDGMENT_TIMEOUT_MS = 10_000;
const REPORT_ACKNOWLEDGMENT_TIMEOUT_MS = 20_000;

type BootstrapMessage =
  | { type: "initialization_ready" }
  | {
      type: "provider_may_have_started";
    }
  | {
      observations: InMemoryLiveEvalObservations | null;
      protocolVersion: 2;
      reportReceipt: LiveEvalReportReceipt;
      type: "report_persisted";
    };

function sendBootstrapMessage<Result>(
  message: BootstrapMessage,
  parseAcknowledgment: (input: unknown, messageId: string) => Result | null,
  acknowledgmentTimeoutMs: number,
): Promise<Result> {
  return new Promise((resolveMessage, rejectMessage) => {
    if (typeof process.send !== "function") {
      rejectMessage(new Error("Live-eval child requires an IPC channel."));
      return;
    }
    const messageId = randomUUID();
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      process.off("disconnect", onDisconnect);
      process.off("message", onMessage);
    };
    const reject = (error: Error) => {
      if (!settled) {
        settled = true;
        cleanup();
        rejectMessage(error);
      }
    };
    const onDisconnect = () => {
      reject(new Error("Live-eval bootstrap disconnected before acknowledgment."));
    };
    const onMessage = (input: unknown) => {
      const acknowledgment = parseAcknowledgment(input, messageId);
      if (acknowledgment !== null && !settled) {
        settled = true;
        cleanup();
        resolveMessage(acknowledgment);
      }
    };
    const timeout = setTimeout(() => {
      reject(new Error("Live-eval bootstrap acknowledgment timed out."));
    }, acknowledgmentTimeoutMs);
    process.on("disconnect", onDisconnect);
    process.on("message", onMessage);
    process.send({ ...message, messageId }, (error) => {
      if (error) {
        reject(error);
      }
    });
  });
}

function parseProviderAcknowledgment(
  input: unknown,
  messageId: string,
): true | null {
  const parsed = bootstrapAcknowledgmentSchema.safeParse(input);
  return parsed.success && parsed.data.messageId === messageId ? true : null;
}

function parseReportAcknowledgment(
  input: unknown,
  messageId: string,
): 0 | 1 | null {
  const parsed = reportAcknowledgmentSchema.safeParse(input);
  return parsed.success && parsed.data.messageId === messageId
    ? parsed.data.exitCode
    : null;
}

async function main(): Promise<void> {
  await sendBootstrapMessage(
    { type: "initialization_ready" },
    parseProviderAcknowledgment,
    PROVIDER_ACKNOWLEDGMENT_TIMEOUT_MS,
  );
  let providerBoundarySent = false;
  const diagnostics: FailedPublicResponseDiagnostic[] = [];
  const sourceDiagnostics: FailedSourceEvidenceDiagnostic[] = [];
  const { observations, reportReceipt } = await runLiveEval({
    ...(liveEvalPublicDiagnosticsEnabled(process.env.DIESEL_LIVE_EVAL_DIAGNOSTICS)
      ? { onFailedPublicResponse: (diagnostic: FailedPublicResponseDiagnostic) => {
          diagnostics.push(diagnostic);
          return undefined;
        },
        onFailedSourceEvidence: (diagnostic: FailedSourceEvidenceDiagnostic) => {
          sourceDiagnostics.push(diagnostic);
          return undefined;
        } }
      : {}),
    onProviderMayStart: async () => {
      if (!providerBoundarySent) {
        await sendBootstrapMessage(
          { type: "provider_may_have_started" },
          parseProviderAcknowledgment,
          PROVIDER_ACKNOWLEDGMENT_TIMEOUT_MS,
        );
        providerBoundarySent = true;
      }
    },
  });
  const exitCode = await sendBootstrapMessage(
    {
      observations,
      protocolVersion: 2,
      reportReceipt,
      type: "report_persisted",
    },
    parseReportAcknowledgment,
    REPORT_ACKNOWLEDGMENT_TIMEOUT_MS,
  );
  // Best effort only, after the independent report ACK. No diagnostic payload
  // enters IPC or the formal report; the existing exit deadline is unchanged.
  for (const diagnostic of diagnostics) {
    try {
      process.stdout.write(formatFailedPublicResponseDiagnostic(diagnostic));
    } catch {
      // Do not replace the independently verified exit code with a sink error.
    }
  }
  for (const diagnostic of sourceDiagnostics) {
    try {
      process.stdout.write(formatFailedSourceEvidenceDiagnostic(diagnostic));
    } catch {
      // Source diagnostics have the same best-effort, post-ACK boundary.
    }
  }
  if (process.connected) {
    process.disconnect();
  }
  process.exit(exitCode);
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Live eval report persistence failed (${safeLiveEvalErrorName(error)}).\n`,
  );
  process.exitCode = 1;
});
