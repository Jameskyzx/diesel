import Link from "next/link";
import type { CatalogResult } from "@/features/product-catalog/schemas";
import type { Locale } from "@/i18n/locale";

export function CatalogResults({ result, locale }: { result: CatalogResult; locale: Locale }) {
  const zh = locale === "zh-CN";
  return <section className="space-y-3" aria-label={zh ? "产品目录结果" : "Product catalogue results"}>
    <p className="text-sm text-muted-foreground">{zh ? `找到 ${result.total} 条配置记录、${result.modelCount} 个型号。` : `${result.total} configuration records / ${result.modelCount} model codes found.`}</p>
    <p className="text-sm rounded-md border bg-muted/30 p-3">{zh ? "授权展示的来源资料，尚未独立核验。排放等级是目录宣称，不是认证或市场准入结论。同一型号的不同配置不可合并。" : "Authorized source-reported data, not independently verified. Emission labels are catalogue claims, not certification or market-entry approval. Keep different configurations separate."}</p>
    {result.records.length === 0 && <p>{zh ? "没有匹配记录。可尝试只输入型号前缀，或取消筛选；这不代表市场上不存在该产品。" : "No matching records. Try a model prefix or fewer filters; this does not establish that the product does not exist."}</p>}
    <div className="grid gap-3 md:grid-cols-2">
      {result.records.map(record => <article key={record.id} className="rounded-lg border bg-card p-4 space-y-2" data-testid="catalog-record">
        <h2 className="font-semibold">{record.model}</h2>
        <p className="text-sm">{record.category} · {record.application}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt>{zh ? "功率 / 转速（原文）" : "Power / speed (source)"}</dt><dd>{record.raw.power || "—"}</dd>
          <dt>{zh ? "归一化功率" : "Normalized power"}</dt><dd>{record.ratedPowerKw === null ? zh ? "未确认单位或格式" : "Unit / format unconfirmed" : `${record.ratedPowerKw} kW`}</dd>
          <dt>{zh ? "系列燃料" : "Family fuel"}</dt><dd>{record.familyFuel || "—"}</dd>
          <dt>{zh ? "排量（原文）" : "Displacement (source)"}</dt><dd>{record.raw.displacement || "—"}</dd>
          <dt>{zh ? "排放宣称" : "Emission claim"}</dt><dd>{record.raw.emissionClaim || "—"}</dd>
          <dt>{zh ? "技术路线" : "Technical route"}</dt><dd>{record.raw.technicalRoute || "—"}</dd>
        </dl>
        {record.issues.includes("multiple_model_records") && <p className="text-sm text-amber-700 dark:text-amber-400">{zh ? "存在同型号其他用途/配置，请按来源行选择。" : "Other application/configuration records exist for this model. Select by source row."}</p>}
        <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{zh ? "完整原文与来源" : "Full source fields and provenance"}</summary>
          <dl className="space-y-1 mt-2">{Object.entries(record.raw).map(([key, value]) => <div key={key}><dt className="font-medium inline">{key}: </dt><dd className="inline break-words">{value || "—"}</dd></div>)}</dl>
          <p className="font-medium mt-3">{zh ? "系列级原文，不覆盖具体型号参数" : "Family-level source values, not substitutes for model-specific parameters"} · {record.source.familyRow}</p>
          <dl>{Object.entries(record.family).map(([key, value]) => <div key={key}><dt className="font-medium inline">{key}: </dt><dd className="inline break-words">{value || "—"}</dd></div>)}</dl>
          <p className="mt-2 break-all">{result.workbook} · {record.source.sheet} · {zh ? "行" : "row"} {record.source.row} · SHA256 {result.sha256}</p>
        </details>
        <div className="flex flex-wrap gap-4 text-sm text-primary"><a href={record.source.url} target="_blank" rel="noopener noreferrer">{zh ? "厂商来源链接" : "Manufacturer source link"}</a>
          <Link href={`/chat?prompt=${encodeURIComponent(zh ? `请查看产品资料记录 ${record.id}（${record.model}，${record.application}），再帮我逐步核对目标市场适配。不要将目录排放宣称当成认证。` : `Review catalogue record ${record.id} (${record.model}, ${record.application}), then help assess target-market fit. Do not treat catalogue emission claims as certification.`)}`}>{zh ? "用此配置开始分析" : "Analyze this configuration"}</Link></div>
      </article>)}
    </div>
  </section>;
}
