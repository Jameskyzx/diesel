import { describe, expect, it } from "vitest";
import { searchKnowledgeBaseInputSchema } from "@/features/ai/schemas";
import { buildSalesChatEvidenceContract, knowledgeTermsIn, knowledgeTermsMatch } from "@/server/ai/evidence-contract";
import { selectPortfolioDemoTool } from "@/server/ai/portfolio-demo-model";
import { buildConversationBusinessContext } from "@/server/ai/conversation-context";
import { buildDirectChatResponse } from "@/server/ai/chat-turn-guidance";

const initial = "Retrieve CHN non-road emissions regulations original text sections source evidence.";
const contract = (turns: string[]) => buildSalesChatEvidenceContract({ selectedCountryIso3: null, userTexts: turns });
const terms = (turns: string[]) => contract(turns).requirements[0]?.query.knowledgeTerms ?? [];

describe("knowledge follow-ups retain the substantive request", () => {
  it.each(["-China", "- China", "--China", "-BRA", "- 巴西", "-(Brazil)", "- ( China )", "- ) Brazil"])("keeps the signed operand %s literal and out of country metadata", (literal) => {
    const first = `${initial.slice(0, -1)} ${literal} as of 2026-08-20.`;
    expect(buildConversationBusinessContext([first]).countryIso3s).toEqual(["CHN"]);
    expect(contract([first]).requirements.map((requirement) => requirement.query.countryIso3s)).toEqual([["CHN"]]);
    expect(selectPortfolioDemoTool(first, [first]).input.query).toContain(literal);
    const turns = [first, "Now BRA."];
    const selected = selectPortfolioDemoTool(turns[1]!, turns);
    expect(selected.input.countryIso3).toBe("BRA");
    expect(selected.input.query).toContain(literal);
  });

  it("does not turn signed source operands into scope, date or reference overrides", () => {
    const first = `${initial} - marine -2024-01-01 -section.1 section 2 as of 2026-08-20.`;
    expect(buildConversationBusinessContext([first])).toMatchObject({
      applicationScope: "non-road", hasScopeConflict: false, asOf: "2026-08-20",
    });
    const turns = [first, "Continue with section 3.", "Now BRA."];
    const query = selectPortfolioDemoTool(turns[2]!, turns).input.query;
    expect(query).toContain("- marine -2024-01-01 -section.1");
    expect(query).toContain("section 3");
    expect(terms(turns)).toContain("literal:ref:section:1");
    expect(knowledgeTermsIn("source -CHN -China", ["CHN"])).toEqual(expect.arrayContaining(["chn", "china"]));
  });

  it.each([",as of 2026-08-20.", "，截至 2026-08-20。"])("separates explicit metadata after a signed token's punctuation: %s", (dateClause) => {
    const text = `${initial} -CHN${dateClause}`;
    const selected = selectPortfolioDemoTool(text, [text]);
    expect(selected.input.asOf).toBe("2026-08-20");
    expect(selected.input.query).toContain("-CHN");
    expect(selected.input.query).not.toContain("2026-08-20");
    const literal = `"CHN${dateClause}"`;
    expect(selectPortfolioDemoTool(`${initial} -${literal}`, [`${initial} -${literal}`]).input.query).toContain(literal);
  });

  it.each(["Continue -BRA.", "Continue source evidence -BRA."])("retains the topic and new signed operand in %s", (followUp) => {
    const turns = [initial, followUp, "Now CHN."];
    expect(buildConversationBusinessContext(turns).countryIso3s).toEqual(["CHN"]);
    const query = selectPortfolioDemoTool(turns.at(-1)!, turns).input.query;
    expect(query).toContain("emissions regulations original text sections");
    expect(query).toContain("-BRA");
    expect(terms(turns)).toContain("bra");
  });

  it.each([
    "Continue -fictional,as of 2026-08-21.",
    "继续 -fictional，截至 2026-08-21。",
    "Continue -fictional;as of 2026-08-21.",
    "继续 -fictional；截至 2026-08-21。",
    "Continue source evidence -fictional,as of 2026-08-21.",
    "Continue -fictional as of 2026-08-21.",
  ])("separates a signed refinement from date metadata across later turns: %s", (followUp) => {
    const turns = [initial + " as of 2026-08-20.", followUp, "Now BRA."];
    const selected = selectPortfolioDemoTool(turns[2]!, turns);
    expect(selected.input).toMatchObject({ countryIso3: "BRA", applicationScope: "non-road", asOf: "2026-08-21" });
    expect(selected.input.query).toContain("emissions regulations original text sections");
    expect(selected.input.query).toContain("-fictional");
    expect(selected.input.query).not.toMatch(/\bas\b|截至|2026-08-/u);
    expect(contract(turns).missingRequiredParameters).toEqual([]);
    expect(knowledgeTermsMatch(terms(turns), knowledgeTermsIn(`${initial} -fictional`, ["CHN"]))).toBe(true);
  });

  it.each(['"fictional,as of 2024-01-01"', '"fictional，截至 2024-01-01"', '“fictional，截至 2024-01-01”'])("keeps the quoted signed refinement %s while updating a separate date", (literal) => {
    const turns = [initial + " as of 2026-08-20.", `Continue -${literal} as of 2026-08-21.`];
    const selected = selectPortfolioDemoTool(turns[1]!, turns);
    expect(selected.input.asOf).toBe("2026-08-21");
    expect(selected.input.query).toContain(`-${literal}`);
    expect(selected.input.query).not.toContain("2026-08-21");
    expect(contract(turns).missingRequiredParameters).toEqual([]);
  });

  it.each([
    "Continue -fictional,as of 2026-08-21.warranties.",
    "继续 -fictional，截至 2026-08-21。保修",
    "继续 -fictional，截至 2026-08-21。现在用 CHN。",
  ])("does not absorb wording after date metadata into a signed refinement: %s", (followUp) => {
    const turns = [initial + " as of 2026-08-20.", followUp];
    expect(contract(turns).missingRequiredParameters).toContain("knowledgeQuery");
    expect(buildDirectChatResponse({ locale: "en", selectedCountryIso3: null, text: followUp, userTexts: turns }))
      .toContain("restate the complete source query");
  });

  it.each(["en", "zh-CN"] as const)("asks for an explicit complete OR refinement in %s", (locale) => {
    const turns = [initial + " OR warranty", "Continue -BRA."];
    expect(contract(turns).missingRequiredParameters).toContain("knowledgeQuery");
    const response = buildDirectChatResponse({ locale, selectedCountryIso3: null, text: turns[1]!, userTexts: turns });
    expect(response).toContain(locale === "en" ? "restate the complete source query" : "重新写出完整来源查询");
    const explicit = `${initial} -BRA OR warranty -BRA`;
    expect(contract([...turns, explicit]).missingRequiredParameters).not.toContain("knowledgeQuery");
    expect(selectPortfolioDemoTool(explicit, [...turns, explicit]).input.query).toContain("-BRA OR warranty -BRA");
  });

  it.each(["Continue -fictional warranties.", "Continue -100 kW.", "Continue -non road."])("does not silently drop unsigned query wording in %s", (followUp) => {
    expect(contract([initial, followUp]).missingRequiredParameters).toContain("knowledgeQuery");
  });

  it.each(["-OR", '"OR source"'])("does not confuse the literal %s with a disjunction", (literal) => {
    const turns = [`${initial} ${literal}`, "Continue -BRA."];
    expect(contract(turns).missingRequiredParameters).toEqual([]);
    expect(selectPortfolioDemoTool(turns[1]!, turns).input.query).toContain(literal);
    expect(selectPortfolioDemoTool(turns[1]!, turns).input.query).toContain("-BRA");
  });

  it("accepts independent metadata changes alongside a signed refinement", () => {
    const turns = [initial, "Continue with section 3 for BRA at 200 kW as of 2026-08-21 -China."];
    expect(contract(turns).missingRequiredParameters).toEqual([]);
    const selected = selectPortfolioDemoTool(turns[1]!, turns);
    expect(selected.input).toMatchObject({ countryIso3: "BRA", applicationScope: "non-road", asOf: "2026-08-21" });
    expect(selected.input.query).toContain("-China");
    expect(selected.input.query).toContain("section 3");
    expect(selected.input.query).toContain("200 kW");
  });

  it.each(['"China non-road"', '"中国 非道路"', '“Brazil marine”'])("preserves the literal %s instead of treating it as a metadata alias", (literal) => {
    const first = `${initial} ${literal}`;
    const turns = [first, "Now BRA."];
    expect(selectPortfolioDemoTool(first, [first]).input.query).toContain(literal);
    const selected = selectPortfolioDemoTool(turns[1]!, turns);
    expect(selected.input.countryIso3).toBe("BRA");
    expect(selected.input.applicationScope).toBe("non-road");
    expect(selected.input.query).toContain(literal);
    expect(contract([first]).countryIso3s).toEqual(["CHN"]);
    expect(contract([first]).missingRequiredParameters).toEqual([]);
  });

  it("keeps quoted locators and power literal while updating independent metadata", () => {
    const literal = '"marine section 1 at 100 kW as of 2024-01-01"';
    const turns = [
      `${initial} ${literal} section 2 at 200 kW as of 2026-08-20.`,
      "Continue with section 3 at 300 kW as of 2026-08-21.",
      "Now BRA.",
    ];
    const context = buildConversationBusinessContext([turns[0]!]);
    expect(context).toMatchObject({ countryIso3s: ["CHN"], applicationScope: "non-road", hasScopeConflict: false,
      powerKw: 200, hasPowerConflict: false, asOf: "2026-08-20" });
    const selected = selectPortfolioDemoTool(turns[2]!, turns);
    expect(selected.input.query).toContain(literal);
    expect(selected.input.query).toContain("section 3");
    expect(selected.input.query).toContain("300 kW");
    expect(selected.input.asOf).toBe("2026-08-21");
    expect(terms(turns)).toEqual(expect.arrayContaining(["literal:ref:section:1", "literal:power:100kw", "ref:section:3", "power:300kw"]));
    if (typeof selected.input.query !== "string") throw new Error("Missing query");
    expect(knowledgeTermsMatch(terms(turns), knowledgeTermsIn(selected.input.query, ["CHN", "BRA"]))).toBe(true);
  });

  it("does not strip dates or append a new scope into an unclosed native phrase", () => {
    const original = 'Retrieve CHN emissions original text source evidence -"China\nnon-road as of 2024-01-01';
    const turns = [original, "Use non-road as of 2026-08-21.", "Now BRA."];
    const selected = selectPortfolioDemoTool(turns[2]!, turns);
    expect(selected.input.query).toContain('-"China\nnon-road as of 2024-01-01');
    expect(selected.input.query).toMatch(/-"China\nnon-road as of 2024-01-01$/u);
    expect(selected.input.applicationScope).toBe("non-road");
    expect(selected.input.asOf).toBe("2026-08-21");
    expect(buildConversationBusinessContext([original]).asOf).toBeNull();
  });

  it("still accepts an explicitly quoted metadata value in a control-only follow-up", () => {
    const turns = [initial.replace("non-road", "marine"), 'Actually use "non-road" for BRA.'];
    expect(buildConversationBusinessContext(turns)).toMatchObject({ applicationScope: "non-road", countryIso3s: ["BRA"] });
  });

  it("requires only unquoted countries, including when the source noun is quoted", () => {
    for (const question of [
      'Retrieve CHN and DEU sources "Brazil marine".',
      'Retrieve CHN and DEU "source evidence for Brazil marine".',
    ]) {
      expect(contract([question]).requirements.map((requirement) => requirement.query.countryIso3s)).toEqual([["CHN"], ["DEU"]]);
    }
    expect(knowledgeTermsIn('source "CHN"', ["CHN"])).toContain("chn");
    expect(knowledgeTermsMatch(knowledgeTermsIn('source "China"', ["CHN"]), knowledgeTermsIn('source "CHN"', ["CHN"]))).toBe(false);
  });

  it.each(["nonroad", "non-road", "non road"])("retains the subject across a %s source follow-up", (spelling) => {
    const turns = [initial, `Retrieve ${spelling} source evidence again.`];
    expect(knowledgeTermsMatch(terms(turns), knowledgeTermsIn(initial, ["CHN"]))).toBe(true);
    expect(terms(turns)).toEqual(expect.arrayContaining(["emissions", "regulations", "original", "text", "sections"]));
  });

  it.each(["Continue with section 2.", "继续检索第 2 节。"])("keeps the topic while updating a locator: %s", (followup) => {
    const turns = [initial, followup, "Now BRA."];
    expect(terms(turns)).toEqual(expect.arrayContaining(["emissions", "regulations", "original", "text", "ref:section:2"]));
    expect(terms(turns)).not.toContain("with");
  });

  it("uses the corrected scope rather than requiring the old scope word", () => {
    const turns = [initial.replace("non-road", "marine"), "Actually use non-road."];
    expect(contract(turns).applicationScope).toBe("non-road");
    expect(knowledgeTermsMatch(terms(turns), knowledgeTermsIn(initial, ["CHN"]))).toBe(true);
    expect(terms(turns)).not.toContain("marine");
  });

  it("preserves exact identifiers containing scope words", () => {
    const turns = [initial.replace("non-road", "marine") + " DEMO-MARINE-100 EU_NONROAD_2026", "Actually use non-road."];
    expect(terms(turns)).toEqual(expect.arrayContaining(["id:demo-marine-100", "id:eu_nonroad_2026"]));
  });

  it("lets an explicit new subject replace the old one", () => {
    expect(terms([initial, "Retrieve CHN market source evidence."])).toContain("market");
    expect(terms([initial, "Retrieve CHN market source evidence."])).not.toContain("emissions");
  });

  it.each(["China", "中国"])("projects the country name %s without changing an opaque identifier", (country) => {
    const turns = [initial.replace("CHN", country) + " DOC-CHN-100 https://example.test/CHN/reference", "Now BRA."];
    const tool = selectPortfolioDemoTool(turns[1]!, turns);
    expect(tool.input.query).toContain("DOC-CHN-100");
    expect(tool.input.query).toContain("https://example.test/CHN/reference");
    if (typeof tool.input.query !== "string") throw new Error("Missing query");
    expect(knowledgeTermsMatch(terms(turns), knowledgeTermsIn(tool.input.query, ["BRA"]))).toBe(true);
  });

  it("binds a newly supplied scope when the original source query was unscoped", () => {
    const turns = [initial.replace("non-road ", ""), "Use non-road."];
    expect(knowledgeTermsMatch(terms(turns), knowledgeTermsIn(initial, ["CHN"]))).toBe(true);
  });

  it("preserves quoted phrases, OR and native negation while updating scope and country", () => {
    const turns = [
      'Retrieve CHN marine emissions "original text" OR "source evidence" -warranty.',
      "Actually use non-road for BRA.",
    ];
    const query = selectPortfolioDemoTool(turns[1]!, turns).input.query;
    expect(query).toContain('"original text" OR "source evidence" -warranty');
    expect(query).toContain("non-road");
    expect(query).toContain("BRA");
  });

  it("retains locator and power updates through a neutral country follow-up", () => {
    const turns = [initial + " Stage IV section 1 at 100 kW as of 2026-08-20.", "Continue with section 2 at 200 kW as of 2026-08-21.", "Now BRA."];
    const selected = selectPortfolioDemoTool(turns[2]!, turns);
    const query = selected.input.query;
    if (typeof query !== "string") throw new Error("Missing query");
    expect(terms(turns)).toEqual(expect.arrayContaining(["ref:stage:iv", "ref:section:2", "power:200kw"]));
    expect(query).toContain("section 2");
    expect(query).toContain("200 kW");
    // The date is a structured validity filter, not a document keyword.
    expect(selected.input.asOf).toBe("2026-08-21");
    expect(query).not.toContain("2026-08-");
    expect(query).not.toContain("section 1");
    expect(knowledgeTermsMatch(terms(turns), knowledgeTermsIn(query, ["CHN", "BRA"]))).toBe(true);
  });

  it.each([
    ["section.1", "section 2", "ref:section:2"],
    ["v2.1", "version 3.1", "ref:version:3.1"],
    ["version 2.1", "v3.1", "ref:version:3.1"],
  ])("replaces the standalone %s shorthand without retaining a stale identifier", (oldReference, replacement, expected) => {
    const turns = [initial + ` ${oldReference} DOC-v2.1 DOC-section.1`, `Continue with ${replacement}.`, "Now BRA."];
    const query = selectPortfolioDemoTool(turns[2]!, turns).input.query;
    if (typeof query !== "string") throw new Error("Missing query");
    expect(terms(turns)).toContain(expected);
    expect(terms(turns)).not.toContain(`id:${oldReference.toLowerCase().replace(" ", "")}`);
    expect(query).toContain("DOC-v2.1 DOC-section.1");
    expect(knowledgeTermsMatch(terms(turns), knowledgeTermsIn(query, ["BRA"]))).toBe(true);
    expect(knowledgeTermsMatch(terms(turns), knowledgeTermsIn(query.replace("DOC-v2.1", "DOC-v3.1"), ["BRA"]))).toBe(false);
  });

  it("keeps dates inside quoted source phrases and URLs verbatim", () => {
    const original = 'Retrieve CHN non-road emissions "as of 2026-08-20" OR https://example.test/2026-08-20/source original text source evidence';
    const turns = [original, "Now BRA as of 2026-08-21."];
    const query = selectPortfolioDemoTool(turns[1]!, turns).input.query;
    expect(query).toContain('"as of 2026-08-20"');
    expect(query).toContain("https://example.test/2026-08-20/source");
  });

  it("rejects an over-cap query instead of silently removing required terms", () => {
    const identifier = `DOC-${"X".repeat(480)}-100`;
    const turns = [initial + ` ${identifier}`, "Now BRA."];
    const selected = selectPortfolioDemoTool(turns[1]!, turns);
    expect(selected.input.query).toContain(identifier);
    expect(terms(turns)).toContain(`id:${identifier.toLowerCase()}`);
    expect(searchKnowledgeBaseInputSchema.safeParse(selected.input).success).toBe(false);
  });

  it.each(["Now BRA.", "Continue.", "Retrieve nonroad source evidence again."])("gives Demo a meaningful complete query for %s", (followup) => {
    const turns = [initial, followup];
    const tool = selectPortfolioDemoTool(followup, turns);
    expect(tool.toolName).toBe("searchKnowledgeBase");
    const query = tool.input.query;
    expect(typeof query).toBe("string");
    if (typeof query !== "string") throw new Error("Missing query");
    expect(knowledgeTermsMatch(terms(turns), knowledgeTermsIn(query, ["CHN", "BRA"]))).toBe(true);
    expect(query).toMatch(/emissions/u);
    expect(query).not.toMatch(/again|continue|now/iu);
  });
});
