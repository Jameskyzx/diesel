import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type {
  AiCitation,
  AiToolName,
} from "@/features/ai/schemas";
import * as schema from "@/server/db/schema";
import {
  aiChatSessions,
  aiCitations,
  aiToolCalls,
} from "@/server/db/schema";

type AuditJson = Record<string, unknown>;

export type AiToolCallAuditInput = {
  citations: AiCitation[];
  completedAt: Date;
  durationMs: number;
  errorCode: string | null;
  input: AuditJson;
  resultSummary: AuditJson;
  sessionId: string;
  startedAt: Date;
  status: "success" | "no_data" | "error";
  toolCallId: string;
  toolName: AiToolName;
};

export function createAiAuditRepository<
  TQueryResult extends PgQueryResultHKT,
>(database: PgDatabase<TQueryResult, typeof schema>) {
  return {
    async ensureSession(input: {
      modelId: string;
      selectedCountryIso3: string | null;
      sessionId: string;
    }): Promise<void> {
      await database
        .insert(aiChatSessions)
        .values({
          id: input.sessionId,
          modelId: input.modelId,
          selectedCountryIso3: input.selectedCountryIso3,
        })
        .onConflictDoUpdate({
          set: {
            modelId: input.modelId,
            selectedCountryIso3: input.selectedCountryIso3,
            updatedAt: new Date(),
          },
          target: aiChatSessions.id,
        });
    },

    async recordToolCall(input: AiToolCallAuditInput): Promise<void> {
      await database.transaction(async (transaction) => {
        const [toolCall] = await transaction
          .insert(aiToolCalls)
          .values({
            completedAt: input.completedAt,
            durationMs: input.durationMs,
            errorCode: input.errorCode,
            input: input.input,
            resultSummary: input.resultSummary,
            sessionId: input.sessionId,
            startedAt: input.startedAt,
            status: input.status,
            toolCallId: input.toolCallId,
            toolName: input.toolName,
          })
          .returning({ id: aiToolCalls.id });

        if (!toolCall) {
          throw new Error("AI tool-call audit row was not returned.");
        }

        if (input.citations.length > 0) {
          await transaction.insert(aiCitations).values(
            input.citations.map((citation) => ({
              chunkId: citation.chunkId,
              countryIso3: citation.countryIso3,
              documentId: citation.documentId,
              isDemo: citation.isDemo,
              locator: citation.locator,
              pageFrom: citation.pageFrom,
              pageTo: citation.pageTo,
              productCertificationId: citation.productCertificationId,
              publishedOn: citation.publishedOn,
              regulationId: citation.regulationId,
              regulationStatus: citation.regulationStatus,
              sectionLocator: citation.sectionLocator,
              sessionId: input.sessionId,
              sourceId: citation.sourceId,
              sourceUrl: citation.sourceUrl,
              title: citation.title,
              toolCallAuditId: toolCall.id,
              verifiedAt: new Date(citation.verifiedAt),
            })),
          );
        }
      });
    },
  };
}

export type AiAuditRepository = ReturnType<typeof createAiAuditRepository>;
