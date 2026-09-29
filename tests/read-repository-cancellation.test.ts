import { describe, expect, it, vi } from "vitest";

import { createKnowledgeRepository } from "@/server/repositories/knowledge-repository";
import { createMarketRepository } from "@/server/repositories/market-repository";

function canceledSignal(): AbortSignal {
  const controller = new AbortController();
  controller.abort("must not escape");
  return controller.signal;
}

describe("read repository cancellation", () => {
  it("rejects a canceled market read before touching the database", async () => {
    const repository = createMarketRepository({} as never);

    await expect(
      repository.findForComparison(
        {
          applicationScope: "non-road",
          countryIso3s: ["CHN", "BRA"],
          metricCodes: ["DEMO_ADDRESSABLE_UNITS"],
        },
        { signal: canceledSignal() },
      ),
    ).rejects.toMatchObject({
      message: "The request was canceled.",
      name: "AbortError",
    });
  });

  it("rejects a canceled knowledge read before touching the database", async () => {
    const repository = createKnowledgeRepository({} as never);

    await expect(
      repository.searchCandidates(
        {
          applicationScope: "non-road",
          asOf: "2026-08-20",
          countryIso3: "CHN",
          jurisdictionId: null,
          limit: 5,
          query: "CHN non-road emissions source",
        },
        [0, 1],
        { signal: canceledSignal() },
      ),
    ).rejects.toMatchObject({
      message: "The request was canceled.",
      name: "AbortError",
    });
  });

  it("does not start retrieval when cancellation arrives during native spelling parsing", async () => {
    const controller = new AbortController();
    const from = vi.fn(async () => { controller.abort(); return [{ query: "'nonroad'" }]; });
    const select = vi.fn(() => ({ from }));
    const repository = createKnowledgeRepository({ select } as never);
    await expect(repository.searchCandidates({
      applicationScope: "non-road", asOf: "2026-08-20", countryIso3: "CHN",
      jurisdictionId: null, limit: 5, query: "nonroad emissions source",
    }, [0, 1], { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(select).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledTimes(1);
  });
});
