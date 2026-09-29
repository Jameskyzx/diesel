import { beforeEach, describe, expect, it, vi } from "vitest";

const knowledgeMocks = vi.hoisted(() => ({
  createKnowledgeRepository: vi.fn(),
  searchCandidates: vi.fn(),
  knowledgeQueryConstraintsMatch: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  getDatabase: () => ({}),
}));

vi.mock("@/server/db/environment", () => ({
  getDatabaseMode: () => "postgres",
}));

vi.mock("@/server/repositories/knowledge-repository", () => ({
  createKnowledgeRepository: knowledgeMocks.createKnowledgeRepository,
}));

import { hybridSearchKnowledge, knowledgeQueryConstraintsMatch } from "@/server/services/knowledge-service";

const searchInput = {
  applicationScope: "non-road",
  asOf: "2026-08-20",
  countryIso3: "CHN",
  jurisdictionId: null,
  limit: 5,
  query: "CHN non-road emissions source",
} as const;

describe("knowledge search cancellation", () => {
  beforeEach(() => {
    knowledgeMocks.createKnowledgeRepository.mockReset();
    knowledgeMocks.searchCandidates.mockReset();
    knowledgeMocks.knowledgeQueryConstraintsMatch.mockReset();
    knowledgeMocks.createKnowledgeRepository.mockReturnValue({
      searchCandidates: knowledgeMocks.searchCandidates,
      knowledgeQueryConstraintsMatch: knowledgeMocks.knowledgeQueryConstraintsMatch,
    });
    knowledgeMocks.searchCandidates.mockResolvedValue([]);
  });

  it("checks native constraint comparison cancellation before and after the repository read", async () => {
    const input = { expected: "source -fictional", actual: "source fictional" };
    const controller = new AbortController();
    knowledgeMocks.createKnowledgeRepository.mockImplementationOnce(() => {
      controller.abort();
      return { knowledgeQueryConstraintsMatch: knowledgeMocks.knowledgeQueryConstraintsMatch };
    });
    await expect(knowledgeQueryConstraintsMatch(input, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(knowledgeMocks.knowledgeQueryConstraintsMatch).not.toHaveBeenCalled();
    const duringRead = new AbortController();
    knowledgeMocks.knowledgeQueryConstraintsMatch.mockImplementationOnce(async () => {
      duringRead.abort(); return true;
    });
    await expect(knowledgeQueryConstraintsMatch(input, { signal: duringRead.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(knowledgeMocks.knowledgeQueryConstraintsMatch).toHaveBeenCalledWith(input.expected, input.actual, { signal: duringRead.signal });
  });

  it("does not open the repository for unconstrained text, or swallow its failure", async () => {
    expect(await knowledgeQueryConstraintsMatch({ expected: "non-road source evidence", actual: "非道路来源" })).toBe(true);
    expect(knowledgeMocks.createKnowledgeRepository).not.toHaveBeenCalled();
    const error = new Error("native parse failed");
    knowledgeMocks.knowledgeQueryConstraintsMatch.mockRejectedValueOnce(error);
    await expect(knowledgeQueryConstraintsMatch({ expected: "source -fictional", actual: "source fictional" })).rejects.toBe(error);
  });

  it("does not start the repository search when cancellation arrives during initialization", async () => {
    const controller = new AbortController();
    knowledgeMocks.createKnowledgeRepository.mockImplementation(() => {
      controller.abort("caller-controlled reason");
      return { searchCandidates: knowledgeMocks.searchCandidates };
    });

    await expect(
      hybridSearchKnowledge(searchInput, { signal: controller.signal }),
    ).rejects.toMatchObject({
      message: "The request was canceled.",
      name: "AbortError",
    });

    expect(knowledgeMocks.searchCandidates).not.toHaveBeenCalled();
  });

  it("passes the signal to the repository and checks it again after the read", async () => {
    const controller = new AbortController();
    knowledgeMocks.searchCandidates.mockImplementation(async () => {
      controller.abort("caller-controlled reason");
      return [];
    });

    await expect(
      hybridSearchKnowledge(searchInput, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(knowledgeMocks.searchCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ query: searchInput.query }),
      expect.any(Array),
      { signal: controller.signal },
    );
  });
});
