import { describe, expect, it } from "vitest";
import { buildConversationBusinessContext } from "@/server/ai/conversation-context";

const initial = (scope: string) => `Check CHN ${scope} regulations at 100 kW as of 2026-08-20.`;

describe("bounded scope transitions are not scope exclusions", () => {
  it.each([
    ["non-road", "Do not change to marine."],
    ["non-road", "Do not switch to marine."],
    ["non-road", "Don't change the application scope to marine."],
    ["marine", "不要从船用改为非道路。"],
    ["marine", "不要把船用改为非道路。"],
    ["marine", "不要由船用改成非道路。"],
    ["marine", "不要把用途从船用改为非道路。"],
    ["construction", "Do not change from construction to non-road."],
    ["construction", "Do not switch the scope from construction to non-road."],
    ["construction", "不要从工程机械改为非道路。"],
    ["non-road", "不要改为非道路。"],
    ["marine", "Do not change from marine to marine."],
  ])("preserves %s after %s", (scope, followup) => {
    expect(buildConversationBusinessContext([initial(scope), followup, "Now BRA."])).toMatchObject({
      applicationScope: scope, hasScopeConflict: false, focusedCountryIso3: "BRA", powerKw: 100, asOf: "2026-08-20",
    });
  });

  it.each([
    "Change to non-road.", "Switch the application scope to non-road.",
    "Change from marine to non-road.", "Switch the scope from marine to non-road.",
    "从船用改为非道路。", "把船用改为非道路。", "由船用改成非道路。", "把用途从船用改为非道路。",
  ])("applies an affirmative transition: %s", (followup) => {
    expect(buildConversationBusinessContext([initial("marine"), followup])).toMatchObject({ applicationScope: "non-road", hasScopeConflict: false });
  });

  it("does not recover an unresolved conflict from a negated transition", () => {
    expect(buildConversationBusinessContext([initial("marine and non-road"), "Do not switch to marine."])).toMatchObject({ applicationScope: null, hasScopeConflict: true });
  });

  it("does not invent the source scope of a prohibited transition without prior context", () => {
    expect(buildConversationBusinessContext(["Do not switch from marine to non-road."])).toMatchObject({ applicationScope: null, hasScopeConflict: true });
  });

  it("keeps a true exclusion distinct from a no-op transition", () => {
    expect(buildConversationBusinessContext([initial("construction"), "Not non-road."])).toMatchObject({ applicationScope: null, hasScopeConflict: true });
  });
});
