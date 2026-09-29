import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getGovernanceDashboard: vi.fn(),
}));

vi.mock("@/server/services/governance-service", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/server/services/governance-service")
  >();
  return {
    ...actual,
    getGovernanceDashboard: mocks.getGovernanceDashboard,
  };
});

import { GET as getAdminDashboard } from "@/app/api/admin/dashboard/route";
import {
  ADMIN_PRINCIPAL_EMAIL_RESPONSE_HEADER,
  ADMIN_PRINCIPAL_ROLE_RESPONSE_HEADER,
} from "@/features/admin/schemas";

const originalRoleBindings = process.env.ADMIN_ROLE_BINDINGS_JSON;
const principal = {
  email: "reviewer@example.test",
  role: "reviewer" as const,
};
const editorPrincipal = {
  email: "editor@example.test",
  role: "editor" as const,
};

const auditCreatedAt = new Date("2026-09-01T00:00:00.000Z");
const baselinePublishedAt = new Date("2026-08-31T00:00:00.000Z");
const dependencyVerifiedAt = new Date("2026-08-30T00:00:00.000Z");

function validDashboard() {
  const countryPayload = {
    dataCoverageStatus: "covered",
    dataSourceId: "91000000-0000-4000-8000-000000000003",
    isDemo: false,
    iso2: "CN",
    iso3: "CHN",
    nameEn: "China v2",
    nameLocal: "中国",
    regionCode: "EAS",
    subregionCode: "EAS",
    verifiedAt: dependencyVerifiedAt.toISOString(),
  };
  return {
    auditLogs: [
      {
        action: "reviewed",
        actorEmail: "reviewer@example.test",
        actorRole: "reviewer",
        createdAt: auditCreatedAt,
        entityKey: "CHN",
        entityType: "country",
        id: "91000000-0000-4000-8000-000000000001",
        reason: "Review the governed country update.",
      },
    ],
    drafts: [
      {
        changeReason: "Update the governed country name.",
        createdBy: editorPrincipal.email,
        entityKey: "CHN",
        entityType: "country",
        id: "91000000-0000-4000-8000-000000000002",
        payload: countryPayload,
        reviewContext: {
          baselineStatus: "active",
          blockingReasons: [],
          dependencies: [
            {
              isDemo: false,
              kind: "source",
              label: "Official source",
              path: "$.sourceId",
              state: "active",
              url: "https://example.test/source",
              value: "91000000-0000-4000-8000-000000000003",
              verifiedAt: dependencyVerifiedAt,
            },
          ],
          publishedBaseline: {
            payload: { ...countryPayload, nameEn: "China" },
            publishedAt: baselinePublishedAt,
            publishedBy: "reviewer@example.test",
            version: 1,
          },
          publishReady: true,
        },
        version: 2,
        workflowStatus: "reviewed",
      },
    ],
    workflowCounts: { draft: 0, published: 1, reviewed: 1 },
  };
}

function editorDashboard() {
  const dashboard = validDashboard();
  return {
    ...dashboard,
    auditLogs: [],
    drafts: dashboard.drafts.map((draft) => ({
      ...draft,
      createdBy: editorPrincipal.email,
      reviewContext: {
        ...draft.reviewContext,
        publishedBaseline: draft.reviewContext.publishedBaseline
          ? {
              ...draft.reviewContext.publishedBaseline,
              publishedBy: null,
            }
          : null,
      },
    })),
  };
}

function dashboardRequest(
  requestPrincipal: typeof principal | typeof editorPrincipal = principal,
): Request {
  return new Request("http://localhost/api/admin/dashboard", {
    headers: {
      "oai-authenticated-user-email": requestPrincipal.email,
    },
  });
}

function expectPrivateBoundResponse(
  response: Response,
  requestPrincipal: typeof principal | typeof editorPrincipal = principal,
): void {
  expect(response.headers.get("Cache-Control")).toBe(
    "private, no-store, max-age=0",
  );
  expect(response.headers.get("Pragma")).toBe("no-cache");
  expect(response.headers.get(ADMIN_PRINCIPAL_EMAIL_RESPONSE_HEADER)).toBe(
    requestPrincipal.email,
  );
  expect(response.headers.get(ADMIN_PRINCIPAL_ROLE_RESPONSE_HEADER)).toBe(
    requestPrincipal.role,
  );
}

describe("admin dashboard route wire admission", () => {
  beforeAll(() => {
    process.env.ADMIN_ROLE_BINDINGS_JSON = JSON.stringify({
      [principal.email]: principal.role,
      [editorPrincipal.email]: editorPrincipal.role,
    });
  });

  afterAll(() => {
    if (originalRoleBindings === undefined) {
      delete process.env.ADMIN_ROLE_BINDINGS_JSON;
    } else {
      process.env.ADMIN_ROLE_BINDINGS_JSON = originalRoleBindings;
    }
  });

  beforeEach(() => {
    mocks.getGovernanceDashboard.mockReset();
    mocks.getGovernanceDashboard.mockResolvedValue(validDashboard());
  });

  it("normalizes database dates and emits only the strict wire response", async () => {
    const response = await getAdminDashboard(dashboardRequest());

    expect(response.status).toBe(200);
    expectPrivateBoundResponse(response);
    expect(mocks.getGovernanceDashboard).toHaveBeenCalledWith(principal);
    await expect(response.json()).resolves.toEqual({
      ...validDashboard(),
      auditLogs: [
        {
          ...validDashboard().auditLogs[0],
          createdAt: auditCreatedAt.toISOString(),
        },
      ],
      drafts: [
        {
          ...validDashboard().drafts[0],
          reviewContext: {
            ...validDashboard().drafts[0].reviewContext,
            dependencies: [
              {
                ...validDashboard().drafts[0].reviewContext.dependencies[0],
                verifiedAt: dependencyVerifiedAt.toISOString(),
              },
            ],
            publishedBaseline: {
              ...validDashboard().drafts[0].reviewContext.publishedBaseline,
              publishedAt: baselinePublishedAt.toISOString(),
            },
          },
        },
      ],
      status: "ok",
    });
  });

  it("forwards the bound editor principal and emits only the editor-scoped response", async () => {
    mocks.getGovernanceDashboard.mockResolvedValue(editorDashboard());

    const response = await getAdminDashboard(
      dashboardRequest(editorPrincipal),
    );

    expect(response.status).toBe(200);
    expectPrivateBoundResponse(response, editorPrincipal);
    expect(mocks.getGovernanceDashboard).toHaveBeenCalledWith(editorPrincipal);
    const body = await response.json();
    expect(body.auditLogs).toEqual([]);
    expect(body.drafts[0].createdBy).toBe(editorPrincipal.email);
    expect(
      body.drafts[0].reviewContext.publishedBaseline.publishedBy,
    ).toBeNull();
  });

  it.each([
    {
      name: "global audit identities",
      pollute(dashboard: ReturnType<typeof editorDashboard>) {
        return { ...dashboard, auditLogs: validDashboard().auditLogs };
      },
    },
    {
      name: "another editor's draft",
      pollute(dashboard: ReturnType<typeof editorDashboard>) {
        return {
          ...dashboard,
          drafts: [
            { ...dashboard.drafts[0], createdBy: "other@example.test" },
          ],
        };
      },
    },
    {
      name: "a published baseline identity",
      pollute(dashboard: ReturnType<typeof editorDashboard>) {
        return {
          ...dashboard,
          drafts: [
            {
              ...dashboard.drafts[0],
              reviewContext: {
                ...dashboard.drafts[0].reviewContext,
                publishedBaseline: {
                  ...dashboard.drafts[0].reviewContext.publishedBaseline,
                  publishedBy: principal.email,
                },
              },
            },
          ],
        };
      },
    },
  ])("fails closed before an editor receives $name", async ({ pollute }) => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.getGovernanceDashboard.mockResolvedValue(
        pollute(editorDashboard()),
      );

      const response = await getAdminDashboard(
        dashboardRequest(editorPrincipal),
      );

      expect(response.status).toBe(500);
      expectPrivateBoundResponse(response, editorPrincipal);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "INTERNAL_ERROR",
          message: "管理操作暂时失败；没有报告为已完成。",
        },
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it.each([
    {
      name: "top-level import history",
      pollute(dashboard: ReturnType<typeof validDashboard>) {
        return { ...dashboard, importBatches: [{ canary: "PRIVATE_CANARY" }] };
      },
    },
    {
      name: "audit snapshots",
      pollute(dashboard: ReturnType<typeof validDashboard>) {
        return {
          ...dashboard,
          auditLogs: [
            { ...dashboard.auditLogs[0], afterData: "PRIVATE_CANARY" },
          ],
        };
      },
    },
    {
      name: "draft storage metadata",
      pollute(dashboard: ReturnType<typeof validDashboard>) {
        return {
          ...dashboard,
          drafts: [{ ...dashboard.drafts[0], reviewedBy: "PRIVATE_CANARY" }],
        };
      },
    },
    {
      name: "published baseline identity",
      pollute(dashboard: ReturnType<typeof validDashboard>) {
        return {
          ...dashboard,
          drafts: [
            {
              ...dashboard.drafts[0],
              reviewContext: {
                ...dashboard.drafts[0].reviewContext,
                publishedBaseline: {
                  ...dashboard.drafts[0].reviewContext.publishedBaseline,
                  entityKey: "PRIVATE_CANARY",
                },
              },
            },
          ],
        };
      },
    },
    {
      name: "dependency storage fields",
      pollute(dashboard: ReturnType<typeof validDashboard>) {
        return {
          ...dashboard,
          drafts: [
            {
              ...dashboard.drafts[0],
              reviewContext: {
                ...dashboard.drafts[0].reviewContext,
                dependencies: [
                  {
                    ...dashboard.drafts[0].reviewContext.dependencies[0],
                    internalId: "PRIVATE_CANARY",
                  },
                ],
              },
            },
          ],
        };
      },
    },
    {
      name: "invalid database dates",
      pollute(dashboard: ReturnType<typeof validDashboard>) {
        return {
          ...dashboard,
          auditLogs: [
            { ...dashboard.auditLogs[0], createdAt: new Date("invalid") },
          ],
        };
      },
    },
    {
      name: "non-JSON payload values",
      pollute(dashboard: ReturnType<typeof validDashboard>) {
        return {
          ...dashboard,
          drafts: [
            {
              ...dashboard.drafts[0],
              payload: { canary: "PRIVATE_CANARY", opaque: BigInt(1) },
            },
          ],
        };
      },
    },
    {
      name: "cyclic payload values",
      pollute(dashboard: ReturnType<typeof validDashboard>) {
        const payload: Record<string, unknown> = {
          canary: "PRIVATE_CANARY",
        };
        payload.self = payload;
        return {
          ...dashboard,
          drafts: [{ ...dashboard.drafts[0], payload }],
        };
      },
    },
    {
      name: "overridden array methods",
      pollute(dashboard: ReturnType<typeof validDashboard>) {
        const items = ["safe"];
        Object.defineProperty(items, "map", {
          value: () => [
            {
              toJSON: () => "PRIVATE_CANARY",
            },
          ],
        });
        return {
          ...dashboard,
          drafts: [
            { ...dashboard.drafts[0], payload: { items } },
          ],
        };
      },
    },
    {
      name: "array subclasses with custom serialization",
      pollute(dashboard: ReturnType<typeof validDashboard>) {
        class LeakyArray extends Array<string> {
          toJSON() {
            return { canary: "PRIVATE_CANARY" };
          }
        }
        return {
          ...dashboard,
          drafts: [
            {
              ...dashboard.drafts[0],
              payload: { items: new LeakyArray("safe") },
            },
          ],
        };
      },
    },
    {
      name: "overridden date serialization",
      pollute(dashboard: ReturnType<typeof validDashboard>) {
        const date = new Date("2026-09-01T00:00:00.000Z");
        Object.defineProperty(date, "toISOString", {
          value: () => ({
            toJSON: () => "PRIVATE_CANARY",
          }),
        });
        return {
          ...dashboard,
          drafts: [
            { ...dashboard.drafts[0], payload: { date } },
          ],
        };
      },
    },
    {
      name: "accessor-backed payload fields",
      pollute(dashboard: ReturnType<typeof validDashboard>) {
        const payload: Record<string, unknown> = {};
        Object.defineProperty(payload, "canary", {
          enumerable: true,
          get: () => "PRIVATE_CANARY",
        });
        return {
          ...dashboard,
          drafts: [{ ...dashboard.drafts[0], payload }],
        };
      },
    },
    {
      name: "sparse payload arrays",
      pollute(dashboard: ReturnType<typeof validDashboard>) {
        return {
          ...dashboard,
          drafts: [
            {
              ...dashboard.drafts[0],
              payload: { items: new Array<unknown>(1) },
            },
          ],
        };
      },
    },
  ])("fails closed before emitting $name", async ({ pollute }) => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.getGovernanceDashboard.mockResolvedValue(
        pollute(validDashboard()),
      );

      const response = await getAdminDashboard(dashboardRequest());
      const body = await response.text();

      expect(response.status).toBe(500);
      expectPrivateBoundResponse(response);
      expect(JSON.parse(body)).toEqual({
        error: {
          code: "INTERNAL_ERROR",
          message: "管理操作暂时失败；没有报告为已完成。",
        },
      });
      expect(body).not.toContain("PRIVATE_CANARY");
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(
        "PRIVATE_CANARY",
      );
      expect(errorSpy).toHaveBeenCalledWith("Admin route failed", {
        errorCode: "AdminDashboardResponseContractError",
      });
    } finally {
      errorSpy.mockRestore();
    }
  });
});
