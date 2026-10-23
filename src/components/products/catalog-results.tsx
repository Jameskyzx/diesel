import Link from "next/link";
import type { CatalogCategory, CatalogRecord, CatalogResult } from "@/features/product-catalog/schemas";
import { getDictionary } from "@/i18n/dictionaries";
import type { Locale } from "@/i18n/locale";
import { applicationScopeListLabel } from "@/i18n/structured-labels";

const categoryLabels: Record<CatalogCategory, { en: string; zh: string }> = {
  truck: { en: "Truck", zh: "卡车" }, bus: { en: "Bus", zh: "客车" },
  construction: { en: "Construction machinery", zh: "工程机械" }, agriculture: { en: "Agricultural machinery", zh: "农业机械" },
  "generator-set": { en: "Generator set", zh: "发电机组" }, marine: { en: "Marine", zh: "船用" },
};

export function catalogCategoryLabel(category: CatalogCategory, locale: Locale) {
  return locale === "zh-CN" ? categoryLabels[category].zh : categoryLabels[category].en;
}

export function catalogFictionalNotice(locale: Locale) {
  return locale === "zh-CN"
    ? "虚构 Demo 目录：型号、参数和排放声明均为演示而编造，不代表任何制造商。排放声明不是认证，也不是市场准入结论。"
    : "Fictional demo catalogue: models, ratings and emission declarations are invented and represent no manufacturer. A declaration is neither certification nor market-entry approval.";
}

export function CatalogRecordSpecs({ record, locale }: { record: CatalogRecord; locale: Locale }) {
  const zh = locale === "zh-CN";
  const dictionary = getDictionary(locale);
  return <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
    <dt>{zh ? "额定功率 / 转速" : "Rated power / speed"}</dt><dd>{record.ratedPowerKw} kW / {record.ratedSpeedRpm} r/min</dd>
    <dt>{zh ? "可标定功率带" : "Rating band"}</dt><dd>[{record.powerMinKw}, {record.powerMaxKw}) kW</dd>
    <dt>{zh ? "排量 / 缸数" : "Displacement / cylinders"}</dt><dd>{record.displacementL} L / {record.cylinders}</dd>
    <dt>{zh ? "适用场景" : "Application scopes"}</dt><dd>{applicationScopeListLabel(record.applicationScopes, dictionary, locale)}</dd>
    <dt>{zh ? "后处理" : "Aftertreatment"}</dt><dd>{record.aftertreatment}</dd>
    <dt>{zh ? "排放声明" : "Emission declaration"}</dt><dd>{record.emissionLabel}</dd>
    <dt>{zh ? "声明的法规编号" : "Declared citations"}</dt>
    <dd className="break-words">{record.declaredCitationCodes.length ? record.declaredCitationCodes.join("; ") : zh ? "无" : "None"}</dd>
  </dl>;
}

export function CatalogResults({ result, locale }: { result: CatalogResult; locale: Locale }) {
  const zh = locale === "zh-CN";
  return <section className="space-y-3" aria-label={zh ? "产品目录结果" : "Product catalogue results"}>
    <p className="text-sm text-muted-foreground">{zh ? `找到 ${result.total} 个型号。` : `${result.total} model codes found.`}</p>
    <p className="text-sm rounded-md border bg-muted/30 p-3">{catalogFictionalNotice(locale)}</p>
    {result.records.length === 0 && <p>{zh ? "没有匹配记录。可尝试只输入型号前缀，或取消筛选。" : "No matching records. Try a model prefix or fewer filters."}</p>}
    <div className="grid gap-3 md:grid-cols-2">
      {result.records.map(record => <article key={record.id} className="rounded-lg border bg-card p-4 space-y-2" data-testid="catalog-record">
        <h2 className="font-semibold"><Link className="hover:underline" href={`/products/${encodeURIComponent(record.model)}`}>{record.model}</Link></h2>
        <p className="text-sm">{record.series} · {catalogCategoryLabel(record.category, locale)} · <span className="font-mono text-xs">{record.id}</span></p>
        <CatalogRecordSpecs record={record} locale={locale} />
        <div className="flex flex-wrap gap-4 text-sm text-primary">
          <Link href={`/products/${encodeURIComponent(record.model)}`}>{zh ? "参数与客户反馈" : "Specs and customer feedback"}</Link>
          <Link href={`/chat?prompt=${encodeURIComponent(zh ? `请查看产品资料记录 ${record.id}（${record.model}），再帮我逐步核对目标市场适配。不要将目录排放声明当成认证。` : `Review catalogue record ${record.id} (${record.model}), then help assess target-market fit. Do not treat catalogue emission declarations as certification.`)}`}>{zh ? "用此型号开始分析" : "Analyze this model"}</Link></div>
      </article>)}
    </div>
  </section>;
}
