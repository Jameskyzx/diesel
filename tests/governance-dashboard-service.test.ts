import { describe, expect, it, vi } from "vitest";

import type { AdminPrincipal } from "@/features/admin/schemas";
import type { GovernanceDashboardRepository } from "@/server/repositories/governance-dashboard-repository";
import { getGovernanceDashboardFromRepository } from "@/server/services/governance-service";

const editor = {
  email: "editor@example.test",
  role: "editor",
} as const satisfies AdminPrincipal;
const reviewer = {
  email: "reviewer@example.test",
  role: "reviewer",
} as const satisfies AdminPrincipal;

const draft = {
  changeReason: "Review the scoped governance revision.",
  createdBy: editor.email,
  entityKey: "CHN",
  entityType: "country",
  id: "91000000-0000-4000-8000-000000000010",
  payload: { iso3: "CHN" },
  version: 2,
  workflowStatus: "reviewed",
} as const;

const reviewContext = {
  baselineStatus: "active",
  blockingReasons: [],
  dependencies: [],
  draftId: draft.id,
  publishedBaseline: {
    payload: { iso3: "CHN" },
    publishedAt: new Date("2026-09-01T00:00:00.000Z"),
    publishedBy: reviewer.email,
    version: 1,
  },
  publishReady: true,
} as const;

type DashboardTestDraft = Omit<
  typeof draft,
  "createdBy" | "workflowStatus"
> & {
  createdBy: string;
  workflowStatus: "draft" | "published" | "reviewed";
};

function repositoryWith(
  rows: readonly DashboardTestDraft[] = [draft],
): GovernanceDashboardRepository {
  return {
    getDraftReviewContexts: vi.fn().mockResolvedValue(
      rows.map((row) => ({
        ...reviewContext,
        draftId: row.id,
      })),
    ),
    getWorkflowCounts: vi.fn().mockResolvedValue({
      draft: 1,
      published: 3,
      reviewed: 2,
    }),
    listActiveDrafts: vi.fn().mockResolvedValue(rows),
    listDashboardAuditLogs: vi.fn().mockResolvedValue([
      {
        action: "published",
        actorEmail: reviewer.email,
        actorRole: reviewer.role,
        createdAt: new Date("2026-09-01T01:00:00.000Z"),
        entityKey: "CHN",
        entityType: "country",
        id: "91000000-0000-4000-8000-000000000011",
        reason: "Publish the reviewed revision.",
      },
    ]),
  } as unknown as GovernanceDashboardRepository;
}

describe("governance dashboard service scope", () => {
  it("does not query global audit identities for an editor and scrubs the baseline publisher", async () => {
    const repository = repositoryWith();

    const result = await getGovernanceDashboardFromRepository(
      repository,
      editor,
    );

    expect(repository.listActiveDrafts).toHaveBeenCalledWith(editor);
    expect(repository.getWorkflowCounts).toHaveBeenCalledWith(editor);
    expect(repository.listDashboardAuditLogs).not.toHaveBeenCalled();
    expect(result.auditLogs).toEqual([]);
    expect(result.workflowCounts).toEqual({
      draft: 1,
      published: 3,
      reviewed: 2,
    });
    expect(
      result.drafts[0]?.reviewContext.publishedBaseline?.publishedBy,
    ).toBeNull();
  });

  it("retains the global audit summary and baseline publisher for a reviewer", async () => {
    const repository = repositoryWith();

    const result = await getGovernanceDashboardFromRepository(
      repository,
      reviewer,
    );

    expect(repository.listDashboardAuditLogs).toHaveBeenCalledOnce();
    expect(result.auditLogs).toHaveLength(1);
    expect(
      result.drafts[0]?.reviewContext.publishedBaseline?.publishedBy,
    ).toBe(reviewer.email);
  });

  it("fails closed when an editor repository row belongs to another creator", async () => {
    const repository = repositoryWith([
      { ...draft, createdBy: "another-editor@example.test" },
    ]);

    await expect(
      getGovernanceDashboardFromRepository(repository, editor),
    ).rejects.toThrow(
      "Governance dashboard repository returned an out-of-scope draft.",
    );
    expect(repository.getDraftReviewContexts).not.toHaveBeenCalled();
  });

  it("fails closed when the active queue contains a published row", async () => {
    const repository = repositoryWith([
      { ...draft, workflowStatus: "published" },
    ]);

    await expect(
      getGovernanceDashboardFromRepository(repository, reviewer),
    ).rejects.toThrow(
      "Governance dashboard repository returned an out-of-scope draft.",
    );
    expect(repository.getDraftReviewContexts).not.toHaveBeenCalled();
  });
});
