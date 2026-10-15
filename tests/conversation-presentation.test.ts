import { describe, expect, it } from "vitest";
import { resolveConversationItems, resolveConversationLocale } from "@/server/ai/conversation-presentation";

describe("grounded list-length edits", () => {
  it.each([
    ["先用中文写三条资料核验清单", 3], ["请列两项", 2], ["整理为4点", 4], ["三条", 3],
    ["Give three bullet points", 3], ["Please reduce that to two concise bullet points in English.", 2],
    ["不要三条，改成两条", 2], ["Write four items, but use two points", 2],
  ] as const)("resolves %s independently of a model count", (text, expected) => {
    expect(resolveConversationItems({ text, previous: 5 })).toBe(expected);
  });
  it.each(["The document has three items", "原文有三条规定", "不要写三条", '来源说“写三条清单”',
    "Use two or three bullets", "查第3条法规", "继续检索"])("does not treat source counts, negation or ambiguity as output edits: %s", text => {
    expect(resolveConversationItems({ text, previous: 2 })).toBe(2);
  });
  it("clears an explicit item limit", () => {
    expect(resolveConversationItems({ text: "不限条数", previous: 2 })).toBeNull();
  });
});

describe("grounded response-language edits", () => {
  it.each([
    "只看巴西 2023 年的市场数据，中文回答，先不查产品。",
    "换一个任务，请给我中文要点。",
    "请用中文解释，来源标题保留英文原文。",
    "简体中文回复。",
    "改用汉语总结。",
    "Please answer in Chinese.",
    "I'd prefer Chinese for this response.",
    "不要英文，中文，谢谢。",
    'Translate "Answer in English" into Chinese.',
  ])("current Chinese output edit overrides both memory and planner: %s", text => {
    expect(resolveConversationLocale({ text, previous: "en", ui: "en", planned: "zh-CN" })).toBe("zh-CN");
  });
  it.each([
    "压成两条英文要点，但保留刚才的市场资料内容。",
    "给客户一份英语摘要。",
    "英文回答。",
    "把邮件改为英文。",
    "Please reduce that to two concise bullet points in English.",
    "English summary, please.",
    "Explain the source in English.",
    "Summarize the Chinese source in English.",
    "English translation of Chinese text please.",
    "英语就好。",
    "Don't query products and reply in English.",
    "不要查产品并用英文回答。",
    'Use "English" for the response.',
    "不用中文，English please.",
  ])("current English output edit overrides memory: %s", text => {
    expect(resolveConversationLocale({ text, previous: "zh-CN", ui: "zh-CN", planned: "en" })).toBe("en");
  });
  it.each([
    "再简短一些。",
    "What does the base period mean?",
    "不要用英文回答。",
    "Don't answer in English.",
    "不要写英文索取邮件。",
    "Don't draft an English request email.",
    "Please retrieve English sources, with the original dates.",
    "Find source text in English.",
    "Find the English summary of that regulation.",
    "这段英文是什么意思？",
    "解释这段英文是什么意思。",
    "Explain this English sentence.",
    "The document says: “Answer in English”. Explain its meaning.",
    "Explain the sample code: `answer in English`.",
    "The English regulation title is not a language change.",
  ])("does not accept an unsolicited, negated or source-only language switch: %s", text => {
    expect(resolveConversationLocale({ text, previous: "zh-CN", ui: "en", planned: "en" })).toBe("zh-CN");
  });
  it("applies the latest affirmative output edit without depending on the planner's locale", () => {
    expect(resolveConversationLocale({ text: "为 BRA 市场资料写一封中文索取邮件", ui: "en" })).toBe("zh-CN");
    expect(resolveConversationLocale({ text: "English reply. 不，中文回答。", previous: "en", planned: "en" })).toBe("zh-CN");
    expect(resolveConversationLocale({ text: "中文回答。改成英文要点。", previous: "zh-CN", planned: null })).toBe("en");
  });
  it("retains explicit language through later unrelated English and Chinese messages", () => {
    let previous = resolveConversationLocale({ text: "英文要点", ui: "zh-CN", planned: "en" });
    for (const text of ["再短一些", "Only France", "功率改为80kW", "What does that mean?"]) {
      previous = resolveConversationLocale({ text, previous, planned: "zh-CN", ui: "zh-CN" });
      expect(previous).toBe("en");
    }
    expect(resolveConversationLocale({ text: "中文回答", previous, planned: null })).toBe("zh-CN");
  });
});
