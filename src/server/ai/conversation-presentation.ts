import "server-only";
import type { Locale } from "@/i18n/locale";

const languageName = /英文|英语|中文|汉语|\bEnglish\b|\bChinese\b/giu;
const outputTarget = /回答|回复|作答|输出|解释|说明|描述|总结|概括|邮件|清单|要点|摘要|短信|版本|译文|\b(?:answer|reply|response|output|explanation|summary|email|message|checklist|bullets?|points?|version|translation)\b/iu;
const outputAction = /回答|回复|作答|输出|解释|说明|描述|总结|概括|翻译|改写|写|起草|\b(?:answer|reply|respond|write|draft|compose|explain|summari[sz]e|translate|rewrite|render)\b/iu;
const negatedLanguageControl = /(?:不要|不用|不必|别|\bnot\b|\bdon['’]t\b|\bavoid\b)\s*(?:(?:再|用|使用|以|写|起草|改成|改为|译成|译为|翻译成|翻译为|切换成|切换为|change|switch|turn|write|draft|compose|answer|reply|respond|translate|it|this|that|the|response|language|a|an|in|into|to|as)\s*){0,8}$/iu;

/** Language names in quoted source text are not response-language edits. Keep
 * quoted bare locale choices (e.g. use "English") but not quoted directives. */
function presentationText(text: string): string {
  return text.replace(/```[\s\S]*?```|`[^`]*`|"[^"\n]*"|“[^”\n]*”|「[^」\n]*」|(?<!\w)'[^'\n]*'(?!\w)/gu,
    span => /^(?:["“「'])(?:English|Chinese|英文|英语|中文|汉语)(?:["”」'])$/iu.test(span)
      ? span.slice(1, -1) : " ".repeat(span.length));
}

/** Presentation is a grounded edit, not an inference from the UI, the prose
 * language, or a model's unsolicited locale. Semantic planning can recognize
 * output requests, but the requested language must occur in current human
 * text, outside quoted data, source-language descriptions and negated edits.
 * Strong explicit controls also work for deterministic/legacy plan callers. */
export function resolveConversationLocale(input: {
  text: string; planned?: Locale | null; previous?: Locale; ui?: Locale;
}): Locale {
  const text = presentationText(input.text);
  const edits: Locale[] = [];
  for (const match of text.matchAll(languageName)) {
    const locale: Locale = /英文|英语|English/iu.test(match[0]) ? "en" : "zh-CN";
    const left = text.slice(0, match.index).split(/[，,。.!?！？;；\n]|\bbut\b|而是/iu).at(-1) ?? "";
    const right = text.slice(match.index + match[0].length).split(/[，,。.!?！？;；\n]/u)[0] ?? "";
    // A source/document's language and a declined language are not edits.
    if (/^\s*(?:的\s*)?(?:原文|来源|资料|文献|标题|法规|文件|句子|段落|文本|sources?\b|originals?\b|documents?\b|titles?\b|regulations?\b|papers?\b|texts?\b|passages?\b|excerpts?\b|sentences?\b)/iu.test(right) ||
      /(?:这段|那段|这份|那份|\bthis|\bthat)\s*$/iu.test(left) ||
      (!outputAction.test(left) && /(?:source|original|document|title|paper|text|passage|excerpt)s?\s*(?:is|are|in|was|were)?\s*$/iu.test(left)) ||
      (!outputAction.test(left) && /(?:检索|查找|查阅|索取|\b(?:find|retrieve|search|fetch|read)\b)/iu.test(left)) ||
      negatedLanguageControl.test(left)) continue;
    const controlBefore = /(?:用|使用|以|改成|改为|译成|译为|翻译成|翻译为)\s*(?:简体)?\s*$|\b(?:in|into|to|use)\s+(?:simplified\s+)?$/iu.test(left);
    const targetAfter = /^\s*(?:的|简短|精简|简洁|简要|短|版|\s|brief|short|concise){0,8}(?:回答|回复|作答|输出|解释|说明|描述|总结|概括|邮件|清单|要点|摘要|短信|版本|译文|\b(?:answer|reply|response|output|explanation|summary|email|message|checklist|bullets?|points?|version|translation)\b)/iu.test(right);
    const bareChoice = /^\s*(?:(?:simplified\s+)?Chinese|English|简体中文|中文|汉语|英文|英语)(?:\s*(?:please|is fine|works|谢谢|即可|就好|就行))?\s*$/iu.test(`${left}${match[0]}${right}`);
    const groundedSemanticEdit = input.planned === locale && outputTarget.test(`${left} ${right}`);
    if (controlBefore || targetAfter || bareChoice || groundedSemanticEdit || (outputAction.test(left) && outputTarget.test(right))) edits.push(locale);
  }
  return edits.at(-1) ?? input.previous ?? input.ui ?? "en";
}
