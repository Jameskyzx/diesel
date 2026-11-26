import Link from "next/link";

import type { RegulationTimelineEvent } from "@/domain/regulation-timeline/build-timeline";
import { applicationScopes } from "@/features/database/schemas";
import {
  regulationTimelineHorizons,
  type RegulationTimelineQuery,
} from "@/features/regulation-timeline/schemas";
import { formatCountryDisplayName } from "@/i18n/country-name";
import { formatUtcDate } from "@/i18n/date";
import type { Dictionary } from "@/i18n/dictionaries";
import type { Locale } from "@/i18n/locale";
import {
  applicationScopeLabel,
  applicationScopeListLabel,
} from "@/i18n/structured-labels";
import type { CountryDirectory } from "@/features/countries/schemas";

type TimelineCopy = ReturnType<typeof timelineCopy>;

export function timelineCopy(locale: Locale) {
  const zh = locale === "zh-CN";
  return {
    title: zh ? "法规变化时间线" : "Regulation timeline",
    description: zh
      ? "按日期列出各国法规的生效和失效，包括过去 12 个月和未来的变化。选择应用和功率后，可查看哪些演示机型尚未声明新法规。"
      : "Every recorded regulation that takes effect or stops applying, across countries, from the last 12 months onward. Choose an application and power to see which demo engines do not yet declare each new rule.",
    application: zh ? "应用" : "Application",
    allApplications: zh ? "全部应用" : "All applications",
    power: zh ? "功率 (kW)" : "Power (kW)",
    powerHelp: zh
      ? "与应用一起填写，用于判断功率范围和机型影响。"
      : "Used together with an application, for power bands and engine impact.",
    horizon: zh ? "向后查看" : "Look ahead",
    months: (count: number) => (zh ? `${count} 个月` : `${count} months`),
    apply: zh ? "更新时间线" : "Update timeline",
    window: (from: string, to: string) =>
      zh ? `时间范围：${from} 至 ${to}` : `Window: ${from} to ${to}`,
    upcoming: zh ? "即将发生" : "Upcoming",
    past: zh ? "近 12 个月已发生" : "In the last 12 months",
    takesEffect: zh ? "生效" : "Takes effect",
    ends: zh ? "停止适用" : "Stops applying",
    status: {
      proposed: zh
        ? "拟议：日期未采纳，不具约束力"
        : "Proposed: date not adopted, not binding",
      adopted: zh ? "已采纳" : "Adopted",
      effective: zh ? "已生效" : "Effective",
      superseded: zh ? "已被取代" : "Superseded",
    },
    demo: zh ? "演示数据（虚构）" : "Demo data (fictional)",
    countries: zh ? "国家" : "Countries",
    applications: zh ? "应用" : "Applications",
    source: zh ? "来源" : "Source",
    verified: zh ? "核验于" : "verified",
    noSourceUrl: zh ? "无公开链接" : "no public link",
    impactHeading: (scope: string, powerKw: number) =>
      zh
        ? `演示机型影响（${scope}，${powerKw} kW）`
        : `Demo engine impact (${scope}, ${powerKw} kW)`,
    impactDeclared: zh ? "已声明" : "Already declared",
    impactGaps: zh ? "生效后存在声明缺口" : "Declaration gap once it applies",
    impactNone: zh
      ? "没有机型的应用和功率范围覆盖此条件。"
      : "No catalogue engine covers this application and power.",
    impactNotice: zh
      ? "依据制造商声明的法规代码逐字比对，不代表认证。产品目录为虚构演示数据。"
      : "Literal match against declared citation codes; a declaration is not certification. The catalogue is fictional demo data.",
    impactHint: zh
      ? "选择应用并填写功率，可查看演示机型影响。"
      : "Choose an application and a power to see the demo engine impact.",
    empty: zh
      ? "此范围内没有已记录的法规变化。没有记录不代表没有变化：许多国家尚无数值法规数据。"
      : "No recorded regulation change in this window. No record does not mean no change: many countries have no numeric regulation data yet.",
    coverageNotice: zh
      ? "只包含已核验并发布的法规记录，不是法律意见。日期以 UTC 计算。"
      : "Only reviewed, published regulation records are shown. Not legal advice. Dates are UTC.",
    unavailable: zh
      ? "时间线数据暂时不可用，请稍后重试。"
      : "Timeline data is temporarily unavailable. Please retry.",
  };
}

function countryName(
  iso3: string,
  directory: CountryDirectory,
  locale: Locale,
): string {
  const entry = directory.find((country) => country.iso3 === iso3);
  return entry
    ? formatCountryDisplayName(
        { isDemo: false, iso2: entry.iso2, iso3, nameEn: entry.name },
        locale,
      )
    : iso3;
}

export function RegulationTimelineFilters({
  copy,
  dictionary,
  query,
}: {
  copy: TimelineCopy;
  dictionary: Dictionary;
  query: RegulationTimelineQuery;
}) {
  return (
    <form
      action="/timeline"
      className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-start"
      method="get"
    >
      <div className="grid gap-1 text-sm">
        <label className="font-medium" htmlFor="timeline-application">
          {copy.application}
        </label>
        <select
          className="h-10 rounded-md border bg-background px-2"
          defaultValue={query.applicationScope ?? ""}
          id="timeline-application"
          name="applicationScope"
        >
          <option value="">{copy.allApplications}</option>
          {applicationScopes.map((scope) => (
            <option key={scope} value={scope}>
              {applicationScopeLabel(scope, dictionary)}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1 text-sm">
        <label className="font-medium" htmlFor="timeline-power">
          {copy.power}
        </label>
        <input
          aria-describedby="timeline-power-help"
          className="h-10 rounded-md border bg-background px-2"
          defaultValue={query.powerKw ?? ""}
          id="timeline-power"
          inputMode="decimal"
          max={100000}
          min={0}
          name="powerKw"
          step="any"
          type="number"
        />
        <span
          className="text-xs text-muted-foreground"
          id="timeline-power-help"
        >
          {copy.powerHelp}
        </span>
      </div>
      <div className="grid gap-1 text-sm">
        <label className="font-medium" htmlFor="timeline-horizon">
          {copy.horizon}
        </label>
        <select
          className="h-10 rounded-md border bg-background px-2"
          defaultValue={String(query.horizonMonths)}
          id="timeline-horizon"
          name="horizonMonths"
        >
          {regulationTimelineHorizons.map((months) => (
            <option key={months} value={months}>
              {copy.months(months)}
            </option>
          ))}
        </select>
      </div>
      <button
        className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground sm:mt-6"
        type="submit"
      >
        {copy.apply}
      </button>
    </form>
  );
}

function TimelineEventCard({
  copy,
  dictionary,
  directory,
  event,
  locale,
  query,
}: {
  copy: TimelineCopy;
  dictionary: Dictionary;
  directory: CountryDirectory;
  event: RegulationTimelineEvent;
  locale: Locale;
  query: RegulationTimelineQuery;
}) {
  // Opens the country on the event date, keeping the timeline's filters.
  const countryParams = new URLSearchParams({ asOf: event.date });
  if (query.applicationScope) {
    countryParams.set("applicationScope", query.applicationScope);
    if (query.powerKw !== undefined)
      countryParams.set("powerKw", String(query.powerKw));
  }
  const countryQuery = `?${countryParams.toString()}`;
  return (
    <li
      className="rounded-lg border bg-card p-4"
      data-testid="timeline-event"
      data-event-kind={event.kind}
      data-regulation-status={event.status}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <time className="font-semibold text-sm" dateTime={event.date}>
          {formatUtcDate(event.date, locale)}
        </time>
        <span
          className={
            event.kind === "takes_effect"
              ? "rounded-full border border-primary/60 bg-background px-2 py-0.5 font-medium text-foreground"
              : "rounded-full bg-muted px-2 py-0.5 font-medium text-foreground"
          }
        >
          {event.kind === "takes_effect" ? copy.takesEffect : copy.ends}
        </span>
        <span
          className={
            event.status === "proposed"
              ? "rounded-full border border-amber-500/60 px-2 py-0.5 text-amber-700 dark:text-amber-300"
              : "rounded-full border px-2 py-0.5"
          }
        >
          {copy.status[event.status]}
        </span>
        {event.isDemo ? (
          <span className="rounded-full border border-dashed px-2 py-0.5">
            {copy.demo}
          </span>
        ) : null}
      </div>
      <h3 className="mt-2 font-semibold leading-snug">{event.canonicalName}</h3>
      {event.citationCode ? (
        <p className="mt-0.5 text-xs text-muted-foreground">
          {event.citationCode}
        </p>
      ) : null}
      <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-3">
        <dt className="text-muted-foreground">{copy.countries}</dt>
        <dd>
          {event.countryIso3s.map((iso3, index) => (
            <span key={iso3}>
              {index > 0 ? (locale === "en" ? ", " : "、") : null}
              <Link
                className="text-primary underline-offset-2 hover:underline"
                href={`/countries/${iso3}${countryQuery}`}
              >
                {countryName(iso3, directory, locale)}
              </Link>
            </span>
          ))}
        </dd>
        <dt className="text-muted-foreground">{copy.applications}</dt>
        <dd>
          {applicationScopeListLabel(
            event.applicationScopes,
            dictionary,
            locale,
          )}
        </dd>
        <dt className="text-muted-foreground">{copy.source}</dt>
        <dd>
          {event.source.url ? (
            <a
              className="text-primary underline-offset-2 hover:underline"
              href={event.source.url}
              rel="noreferrer"
              target="_blank"
            >
              {event.source.title}
            </a>
          ) : (
            <span>
              {event.source.title} ({copy.noSourceUrl})
            </span>
          )}{" "}
          <span className="text-muted-foreground">
            · {copy.verified} {formatUtcDate(event.source.verifiedAt, locale)}
          </span>
        </dd>
      </dl>
      {event.catalogImpact && query.applicationScope && query.powerKw ? (
        <section
          className="mt-3 rounded-md bg-muted/40 p-3 text-sm"
          data-testid="timeline-catalog-impact"
        >
          <h4 className="font-medium">
            {copy.impactHeading(
              applicationScopeLabel(query.applicationScope, dictionary),
              query.powerKw,
            )}
          </h4>
          {event.catalogImpact.declared.length === 0 &&
          event.catalogImpact.gaps.length === 0 ? (
            <p className="mt-1">{copy.impactNone}</p>
          ) : (
            <dl className="mt-1 grid gap-1 sm:grid-cols-[auto_1fr] sm:gap-x-3">
              <dt className="text-muted-foreground">{copy.impactGaps}</dt>
              <dd data-testid="timeline-impact-gaps">
                <ModelLinks locale={locale} models={event.catalogImpact.gaps} />
              </dd>
              <dt className="text-muted-foreground">{copy.impactDeclared}</dt>
              <dd>
                <ModelLinks
                  locale={locale}
                  models={event.catalogImpact.declared}
                />
              </dd>
            </dl>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {copy.impactNotice}
          </p>
        </section>
      ) : null}
    </li>
  );
}

function ModelLinks({
  locale,
  models,
}: {
  locale: Locale;
  models: readonly string[];
}) {
  if (models.length === 0) return <span>–</span>;
  return (
    <>
      {models.map((model, index) => (
        <span key={model}>
          {index > 0 ? (locale === "en" ? ", " : "、") : null}
          <Link
            className="text-primary underline-offset-2 hover:underline"
            href={`/products/${encodeURIComponent(model)}`}
          >
            {model}
          </Link>
        </span>
      ))}
    </>
  );
}

export function RegulationTimelineList({
  copy,
  dictionary,
  directory,
  events,
  locale,
  query,
}: {
  copy: TimelineCopy;
  dictionary: Dictionary;
  directory: CountryDirectory;
  events: readonly RegulationTimelineEvent[];
  locale: Locale;
  query: RegulationTimelineQuery;
}) {
  if (events.length === 0) {
    return (
      <p className="rounded-lg border bg-card p-4 text-sm" role="status">
        {copy.empty}
      </p>
    );
  }
  const groups = [
    {
      id: "timeline-upcoming",
      heading: copy.upcoming,
      events: events.filter((event) => event.timing === "upcoming"),
    },
    {
      id: "timeline-past",
      heading: copy.past,
      // Most recent first, so the latest change sits next to "upcoming".
      events: events.filter((event) => event.timing === "past").toReversed(),
    },
  ];
  return (
    <>
      {!query.applicationScope || query.powerKw === undefined ? (
        <p className="text-sm text-muted-foreground">{copy.impactHint}</p>
      ) : null}
      {groups.map((group) =>
        group.events.length === 0 ? null : (
          <section
            aria-labelledby={group.id}
            className="space-y-3"
            key={group.id}
          >
            <h2 className="text-lg font-semibold" id={group.id}>
              {group.heading}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                ({group.events.length})
              </span>
            </h2>
            <ol className="space-y-3">
              {group.events.map((event) => (
                <TimelineEventCard
                  copy={copy}
                  dictionary={dictionary}
                  directory={directory}
                  event={event}
                  key={event.key}
                  locale={locale}
                  query={query}
                />
              ))}
            </ol>
          </section>
        ),
      )}
    </>
  );
}
