

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDemoDatabase } from "@/server/db/demo-client";
import { knowledgeQueryConstraintsMatch } from "@/server/services/knowledge-service";

const originalDatabaseMode = process.env.DATABASE_MODE;

beforeAll(async () => {
  process.env.DATABASE_MODE = "pglite-demo";
  await getDemoDatabase();
}, 15_000);
afterAll(() => {
  if (originalDatabaseMode === undefined) delete process.env.DATABASE_MODE;
  else process.env.DATABASE_MODE = originalDatabaseMode;
});

describe("knowledge query constraint matcher", () => {
  it("validates external comparison inputs and cancellation before the equality fast path", async () => {
    await expect(knowledgeQueryConstraintsMatch({ expected: "", actual: "" })).rejects.toThrow();
    await expect(knowledgeQueryConstraintsMatch({ expected: "source", actual: "source", extra: true })).rejects.toThrow();
    const controller = new AbortController(); controller.abort();
    await expect(knowledgeQueryConstraintsMatch({ expected: "source", actual: "source" }, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
