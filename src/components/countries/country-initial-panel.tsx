import { CalendarDays, Database, FileCheck2, MapPin } from "lucide-react";

import type { CountryDetailResponse } from "@/features/countries/schemas";

const coverageLabels = {
  covered: "已发布核验边界",
  demo: "虚构 Demo",
  no_data: "明确 no-data",
  none: "未设置覆盖",
  planned: "计划覆盖",
} as const;

export function CountryInitialPanel({
  detail,
  hasGeometry,
}: {
  detail: CountryDetailResponse;
  hasGeometry: boolean;
}) {
  if (detail.status === "no_data") {
    return (
      <div className="p-6 sm:p-8">
        <p className="text-xs font-semibold tracking-[0.18em] text-primary">
          SERVER-RENDERED COUNTRY SNAPSHOT
        </p>
        <MapPin aria-hidden="true" className="mt-8 size-7 text-primary" />
        <h2 className="mt-4 text-2xl font-semibold">{detail.iso3} 暂无数据</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {hasGeometry
            ? "该国家存在地图边界，但当前没有可公开的结构化详情。"
            : "该国家属于完整目录，但当前地图资源暂缺其边界，也没有可公开的结构化详情。"}
          系统不会以模型推测补齐事实。
        </p>
      </div>
    );
  }

  const { country } = detail;
  return (
    <div className="space-y-6 p-6 sm:p-8">
      <header>
        <p className="text-xs font-semibold tracking-[0.18em] text-primary">
          SERVER-RENDERED COUNTRY SNAPSHOT
        </p>
        <h2 className="mt-3 text-2xl font-semibold">{country.nameEn}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {country.iso3} · {coverageLabels[country.dataCoverageStatus]}
        </p>
      </header>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-xl border p-3">
          <dt className="flex items-center gap-2 text-xs text-muted-foreground">
            <CalendarDays aria-hidden="true" className="size-3.5" />
            查询截止日期
          </dt>
          <dd className="mt-1 font-semibold">{detail.asOf}</dd>
        </div>
        <div className="rounded-xl border p-3">
          <dt className="flex items-center gap-2 text-xs text-muted-foreground">
            <Database aria-hidden="true" className="size-3.5" />
            最近核验
          </dt>
          <dd className="mt-1 font-semibold">
            {country.lastVerifiedAt.slice(0, 10)}
            {country.isStale ? "（可能过期）" : ""}
          </dd>
        </div>
      </dl>

      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <FileCheck2 aria-hidden="true" className="size-4 text-primary" />
          当前有效法规（{country.currentEffectiveRegulations.length}）
        </h3>
        {country.currentEffectiveRegulations.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {country.currentEffectiveRegulations.slice(0, 4).map((regulation) => (
              <li className="rounded-xl border p-3 text-sm" key={regulation.id}>
                <p className="font-semibold">{regulation.canonicalName}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {regulation.citationCode ?? "无引用编号"} · 生效
                  {regulation.effectiveFrom ?? "日期未提供"}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
            该查询日期没有可展示的当前有效法规。
          </p>
        )}
      </section>

      <section className="rounded-xl border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
        <p className="font-semibold text-foreground">国家记录来源</p>
        <p className="mt-1">{country.source.title}</p>
        <p>{country.source.publisher ?? "发布机构未提供"}</p>
      </section>
    </div>
  );
}
