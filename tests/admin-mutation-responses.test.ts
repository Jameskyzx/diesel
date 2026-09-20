import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  archiveGovernedEntity: vi.fn(),
  createGovernanceDraft: vi.fn(),
  publishGovernanceDraft: vi.fn(),
  reviewGovernanceDraft: vi.fn(),
  verifyDataSource: vi.fn(),
}));

vi.mock("@/server/services/governance-service", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/server/services/governance-service")
  >();
  return { ...actual, ...mocks };
});

import { POST as createDraft } from "@/app/api/admin/drafts/route";
import { POST as publishDraft } from "@/app/api/admin/drafts/[draftId]/publish/route";
import { POST as reviewDraft } from "@/app/api/admin/drafts/[draftId]/review/route";
import { POST as archiveEntity } from "@/app/api/admin/entities/[entityType]/[entityKey]/archive/route";
import { POST as verifySource } from "@/app/api/admin/sources/[sourceId]/verify/route";
import {
  ADMIN_EXPECTED_PRINCIPAL_EMAIL_REQUEST_HEADER,
  ADMIN_EXPECTED_PRINCIPAL_ROLE_REQUEST_HEADER,
  type AdminPrincipal,
} from "@/features/admin/schemas";

const originalRoleBindings = process.env.ADMIN_ROLE_BINDINGS_JSON;
const draftId = "84000000-0000-4000-8000-000000000001";
const sourceId = "84000000-0000-4000-8000-000000000002";
const principals = {
  admin: { email: "admin@example.test", role: "admin" },
  editor: { email: "editor@example.test", role: "editor" },
  reviewer: { email: "reviewer@example.test", role: "reviewer" },
} as const satisfies Record<string, AdminPrincipal>;

function mutationRequest(
  path: string,
  principal: AdminPrincipal,
  body: Record<string, unknown> = {
    reason: "Exercise the minimized mutation response.",
  },
): Request {
  return new Request(`http://localhost${path}`, {
    body: JSON.stringify(body),
    headers: {
      [ADMIN_EXPECTED_PRINCIPAL_EMAIL_REQUEST_HEADER]: principal.email,
      [ADMIN_EXPECTED_PRINCIPAL_ROLE_REQUEST_HEADER]: principal.role,
      "content-type": "application/json",
      "oai-authenticated-user-email": principal.email,
    },
    method: "POST",
  });
}

describe("admin mutation response minimization", () => {
  beforeAll(() => {
    process.env.ADMIN_ROLE_BINDINGS_JSON = JSON.stringify(
      Object.fromEntries(
        Object.values(principals).map(({ email, role }) => [email, role]),
      ),
    );
  });

  afterAll(() => {
    if (originalRoleBindings === undefined) {
      delete process.env.ADMIN_ROLE_BINDINGS_JSON;
    } else {
      process.env.ADMIN_ROLE_BINDINGS_JSON = originalRoleBindings;
    }
  });

  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
      mock.mockResolvedValue({
        internalActor: "PRIVATE_CANARY",
        payload: { privateDetail: "PRIVATE_CANARY" },
      });
    }
  });

  it.each([
    {
      expectedBody: { status: "created" },
      expectedStatus: 201,
      invoke: () =>
        createDraft(
          mutationRequest("/api/admin/drafts", principals.editor, {
            changeReason: "Create a minimized response draft.",
          }),
        ),
      name: "draft creation",
    },
    {
      expectedBody: { status: "reviewed" },
      expectedStatus: 200,
      invoke: () =>
        reviewDraft(
          mutationRequest(
            `/api/admin/drafts/${draftId}/review`,
            principals.reviewer,
          ),
          { params: Promise.resolve({ draftId }) },
        ),
      name: "draft review",
    },
    {
      expectedBody: { status: "published" },
      expectedStatus: 200,
      invoke: () =>
        publishDraft(
          mutationRequest(
            `/api/admin/drafts/${draftId}/publish`,
            principals.reviewer,
          ),
          { params: Promise.resolve({ draftId }) },
        ),
      name: "draft publication",
    },
    {
      expectedBody: { status: "verified" },
      expectedStatus: 200,
      invoke: () =>
        verifySource(
          mutationRequest(
            `/api/admin/sources/${sourceId}/verify`,
            principals.editor,
            {
              reason: "Verify a source with a minimized response.",
              verifiedAt: "2026-08-15T00:00:00.000Z",
            },
          ),
          { params: Promise.resolve({ sourceId }) },
        ),
      name: "source verification",
    },
    {
      expectedBody: { status: "archived" },
      expectedStatus: 200,
      invoke: () =>
        archiveEntity(
          mutationRequest(
            "/api/admin/entities/country/CHN/archive",
            principals.admin,
          ),
          {
            params: Promise.resolve({
              entityKey: "CHN",
              entityType: "country",
            }),
          },
        ),
      name: "entity archival",
    },
  ])("returns an exact DTO for $name", async ({ expectedBody, expectedStatus, invoke }) => {
    const response = await invoke();
    const responseBody = await response.text();

    expect(response.status).toBe(expectedStatus);
    expect(JSON.parse(responseBody)).toEqual(expectedBody);
    expect(responseBody).not.toContain("PRIVATE_CANARY");
  });
});
