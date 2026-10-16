import { CatalogRecordSpecs, catalogCategoryLabel, catalogFictionalNotice } from "@/components/products/catalog-results";
import type { CatalogFitEvaluation, CatalogFitResult, CatalogFitStatus } from "@/features/product-catalog/schemas";
import { formatUtcDate } from "@/i18n/date";
import { isNavigableEvidenceUrl } from "@/lib/source-link";
import { getDictionary } from "@/i18n/dictionaries";
import type { Locale } from "@/i18n/locale";
import { applicationScopeLabel } from "@/i18n/structured-labels";

const statusCopy: Record<CatalogFitStatus, { en: string; zh: string; tone: string }> = {
  declared_match: { en: "Declaration covers every applicable regulation — certification still to be verified", zh: "声明覆盖全部适用法规 · 仍需核实认证", tone: "border-emerald-600/40" },
  declaration_gap: { en: "Declaration does not name every applicable regulation", zh: "声明未覆盖全部适用法规", tone: "border-amber-600/40" },
  unknown: { en: "No applicable regulation data — compliance cannot be inferred", zh: "未收录适用法规 · 不能推断合规", tone: "border-muted-foreground/40" },
  not_fit: { en: "Outside this model's application scope or rating band", zh: "超出该型号的适用场景或功率带", tone: "border-muted" },
};

const reasonCopy: Record<CatalogFitEvaluation["reason"], { en: string; zh: string }> = {
  DECLARATION_COVERS_ALL_APPLICABLE: { en: "Every applicable citation is named on the spec sheet.", zh: "规格书逐条列出了全部适用法规编号。" },
  DECLARATION_GAP: { en: "Missing from the declaration:", zh: "声明中缺少：" },
  NO_APPLICABLE_REGULATION_DATA: { en: "No regulation record covers this country, scope, power and date. Missing data is not an absence of requirements.", zh: "没有覆盖该国家、场景、功率和日期的法规记录。未收录不等于没有要求。" },
  APPLICATION_SCOPE_MISMATCH: { en: "The model is not declared for this application scope.", zh: "该型号未声明适用于此场景。" },
  POWER_OUT_OF_RANGE: { en: "The requested power is outside the model's half-open rating band.", zh: "所需功率不在该型号的 [min, max) 功率带内。" },
};

function FitCard({ evaluation, result, locale }: { evaluation: CatalogFitEvaluation; result: CatalogFitResult; locale: Locale }) {
  const zh = locale === "zh-CN";
  const missing = result.applicableRegulations.filter(regulation => evaluation.undeclaredRegulationIds.includes(regulation.regulationId));
  return <article className={`rounded-lg border-2 ${statusCopy[evaluation.status].tone} bg-card p-4 space-y-2`} data-testid="catalog-fit-card" data-status={evaluation.status}>
    <h3 className="font-semibold">{evaluation.record.model}</h3>
    <p className="text-sm">{evaluation.record.series} · {catalogCategoryLabel(evaluation.record.category, locale)}</p>
    <p className="text-sm font-medium">{zh ? statusCopy[evaluation.status].zh : statusCopy[evaluation.status].en}</p>
    <p className="text-sm">{zh ? reasonCopy[evaluation.reason].zh : reasonCopy[evaluation.reason].en}</p>
    {missing.length > 0 && <ul className="list-disc pl-5 text-sm">{missing.map(regulation =>
      <li key={regulation.regulationId}>{regulation.citationCode ?? (zh ? "（无法规编号，无法被声明）" : "(no citation code — cannot be declared)")}</li>)}</ul>}
    <CatalogRecordSpecs record={evaluation.record} locale={locale} />
  </article>;
}

export function CatalogFitResults({ result, countryName, locale }: { result: CatalogFitResult; countryName: string; locale: Locale }) {
  const zh = locale === "zh-CN";
  const dictionary = getDictionary(locale);
  const { query } = result;
  const realRegulations = result.applicableRegulations.some(regulation => !regulation.isDemo);
  const group = (status: CatalogFitStatus) => result.evaluations.filter(evaluation => evaluation.status === status);
  const condition = `${countryName} (${query.countryIso3}) · ${applicationScopeLabel(query.applicationScope, dictionary)} · ${query.powerKw} kW · ${query.asOf}`;

  return <section className="space-y-4" aria-label={zh ? "目标市场候选型号" : "Candidate models for the target market"} data-testid="catalog-fit-results">
    <h2 className="text-lg font-semibold">{zh ? "候选型号" : "Candidate models"} · {condition}</h2>
    <div className="text-sm rounded-md border bg-muted/30 p-3 space-y-1">
      <p>{catalogFictionalNotice(locale)}</p>
      <p>{zh ? `规则 ${result.rulesetVersion}：逐条比对型号声明的法规编号与查询日适用法规，按字面匹配，不推断跨地区等效。` : `Ruleset ${result.rulesetVersion}: each model's declared citation codes are matched literally against the regulations in force on the query date. No cross-jurisdiction equivalence is inferred.`}</p>
      {realRegulations && <p className="font-medium">{zh ? "法规记录来自真实来源，产品是虚构的，因此结果只演示流程，不构成可销售结论。" : "Regulation records come from real sources while the products are fictional, so the result demonstrates the workflow and is not a sales conclusion."}</p>}
    </div>

    <section className="space-y-2" aria-label={zh ? "适用法规" : "Applicable regulations"}>
      <h3 className="font-semibold">{zh ? `适用法规（${result.applicableRegulations.length}）` : `Applicable regulations (${result.applicableRegulations.length})`}</h3>
      {result.applicableRegulations.length === 0
        ? <p className="text-sm" role="status">{zh ? "未收录该条件下生效的法规。未收录不等于没有要求，也不能据此推断任何型号合规。" : "No regulation in force is recorded for these conditions. Missing data is not an absence of requirements and supports no compliance conclusion."}</p>
        : <ul className="space-y-2 text-sm">{result.applicableRegulations.map(regulation =>
          <li key={regulation.regulationId} className="rounded-md border p-3" data-testid="catalog-fit-regulation">
            <p className="font-medium">{regulation.citationCode ?? "—"} · {regulation.canonicalName}</p>
            <p>{zh ? "状态" : "Status"}: {regulation.recordStatus === "effective" ? (zh ? "生效" : "effective") : (zh ? "已被取代（查询日仍在有效期内）" : "superseded (in force on the query date)")}
              {" · "}[{regulation.effectiveFrom}, {regulation.effectiveTo ?? "…"})
              {" · "}{zh ? "来源核验" : "Source verified"} {formatUtcDate(regulation.source.verifiedAt, locale)}
              {regulation.isDemo && <> · <strong>DEMO</strong></>}</p>
            {isNavigableEvidenceUrl(regulation.source.url)
              ? <a className="text-primary break-all" href={regulation.source.url} target="_blank" rel="noopener noreferrer">{regulation.source.title}</a>
              : <p className="break-words">{regulation.source.title}</p>}
          </li>)}</ul>}
    </section>

    <p className="text-sm" data-testid="catalog-fit-counts">{zh
      ? `声明覆盖 ${result.counts.declared_match} · 声明缺口 ${result.counts.declaration_gap} · 无法规数据 ${result.counts.unknown} · 不适配 ${result.counts.not_fit}`
      : `Declared match ${result.counts.declared_match} · Declaration gap ${result.counts.declaration_gap} · No regulation data ${result.counts.unknown} · Not fit ${result.counts.not_fit}`}</p>

    {(["declared_match", "declaration_gap", "unknown"] as const).map(status => group(status).length > 0 &&
      <section key={status} className="space-y-2" aria-label={zh ? statusCopy[status].zh : statusCopy[status].en}>
        <h3 className="font-semibold">{zh ? statusCopy[status].zh : statusCopy[status].en}</h3>
        <div className="grid gap-3 md:grid-cols-2">{group(status).map(evaluation =>
          <FitCard key={evaluation.record.id} evaluation={evaluation} result={result} locale={locale} />)}</div>
      </section>)}
    {group("not_fit").length > 0 && <details className="space-y-2">
      <summary className="cursor-pointer font-semibold">{zh ? `不适配的型号（${group("not_fit").length}）` : `Models that do not fit (${group("not_fit").length})`}</summary>
      <ul className="list-disc pl-5 text-sm mt-2">{group("not_fit").map(evaluation =>
        <li key={evaluation.record.id}>{evaluation.record.model} — {zh ? reasonCopy[evaluation.reason].zh : reasonCopy[evaluation.reason].en}</li>)}</ul>
    </details>}
  </section>;
}
