import { describe, expect, it } from "vitest";

import { knowledgeTermsIn, knowledgeTermsMatch } from "@/server/ai/evidence-contract";
import { buildConversationBusinessContext } from "@/server/ai/conversation-context";

const query = (scope: string) => `${scope} emissions regulations original text sections source evidence`;

describe("knowledge evidence spelling equivalence", () => {
  it.each(["nonroad", "non-road", "non road"])("retains the explicit %s scope across a country follow-up", (scope) => {
    expect(buildConversationBusinessContext([
      `Retrieve CHN ${scope} emissions original text sections source evidence for 100 kW as of 2026-08-20.`,
      "Now check BRA.",
    ])).toMatchObject({ applicationScope: "non-road", focusedCountryIso3: "BRA", powerKw: 100, asOf: "2026-08-20" });
  });

  it.each(["EU_NONROAD_2026", "nonroad-2026", "nonroad𠮷", "https://nonroad.example.test"])("does not infer a new scope from %s", (identifier) => {
    expect(buildConversationBusinessContext([`Retrieve CHN original text sections source evidence for ${identifier}.`]).applicationScope).toBeNull();
  });

  it("recognizes a scope in a long chat message without applying the 500-character search-query cap", () => {
    expect(buildConversationBusinessContext([`${"Context. ".repeat(70)} Retrieve CHN nonroad regulations.`]).applicationScope).toBe("non-road");
  });

  it.each(["nonroad", "non-road", "non road"])("preserves the complete query for %s", (scope) => {
    for (const other of ["nonroad", "non-road", "non road"]) {
      expect(knowledgeTermsMatch(knowledgeTermsIn(query(scope)), knowledgeTermsIn(query(other)))).toBe(true);
    }
  });

  it.each(["original text", "sections", "source evidence"])("still requires %s", (missing) => {
    expect(knowledgeTermsMatch(knowledgeTermsIn(query("non-road")), knowledgeTermsIn(query("nonroad").replace(missing, "")))).toBe(false);
  });

  it.each(["marine", "road", "non", "nonroadside", "nonroad warranty"])("does not equate %s with non-road", (scope) => {
    expect(knowledgeTermsMatch(knowledgeTermsIn(query("non-road")), knowledgeTermsIn(query(scope)))).toBe(false);
  });

  it("does not discard an exact product identifier when matching scope aliases", () => {
    const expected = knowledgeTermsIn(`${query("non-road")} EU_NONROAD_2026`);
    expect(knowledgeTermsMatch(expected, knowledgeTermsIn(`${query("nonroad")} EU_NONROAD_2026`))).toBe(true);
    expect(knowledgeTermsMatch(expected, knowledgeTermsIn(`${query("nonroad")} EU_NONROAD_2027`))).toBe(false);
  });
});
