"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { ComparisonResults } from "./comparison-results";
import { SaveAnalysis } from "./save-analysis";
import { comparisonSnapshotSchema, type ComparisonQuery, type ComparisonSnapshot } from "@/features/analyses/schemas";
import type { CountryDirectory } from "@/features/countries/schemas";
import { applicationScopes } from "@/features/database/schemas";
import { applicationScopeLabel } from "@/i18n/structured-labels";
import { formatCountryDisplayName } from "@/i18n/country-name";

export function ComparisonWorkspace({ countries, query, invalid, today }: {
  countries: CountryDirectory; query: ComparisonQuery | null; invalid: boolean; today: string;
}) {
  const { dictionary, locale } = useLocale();
  const copy = dictionary.analysis;
  const [state, setState] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; snapshot: ComparisonSnapshot }>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const queryKey = JSON.stringify(query);
  useEffect(() => {
    if (!query) return;
    let retired = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const params = new URLSearchParams({ applicationScope: query.applicationScope, asOf: query.asOf, powerKw: String(query.powerKw) });
    Promise.all(query.countryIso3s.map(async iso3 => {
      const response = await fetch(`/api/countries/${iso3}?${params}`, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("Comparison request failed");
      return response.json() as Promise<unknown>;
    })).then(responses => {
      const snapshot = comparisonSnapshotSchema.parse({ query, responses });
      if (!controller.signal.aborted) setState({ status: "ready", snapshot });
    }).catch(() => {
      if (!retired) setState({ status: "error" });
      controller.abort();
    }).finally(() => clearTimeout(timeout));
    return () => { retired = true; clearTimeout(timeout); controller.abort(); };
    // Page navigation keys this component by the validated query. Locale changes
    // only relabel existing facts; they must not issue new data requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, attempt]);

  const inputClass = "h-10 w-full min-w-0 rounded-md border bg-background px-2 text-sm";
  return <div className="space-y-5">
    <form action="/compare" method="get" className="surface-panel space-y-4 rounded-md p-4" aria-label={copy.comparisonTitle}>
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map(index => <label className="grid min-w-0 gap-1 text-sm" key={index}>
          {copy.countrySlot.replace("{number}", String(index + 1))}{index === 2 ? ` · ${copy.optional}` : ""}
          <select aria-label={copy.countrySlot.replace("{number}", String(index + 1))} className={inputClass} name="countryIso3s" defaultValue={query?.countryIso3s[index] ?? ""} required={index < 2}>
            <option value="">{copy.chooseCountry}</option>
            {countries.map(country => <option key={country.iso3} value={country.iso3}>{formatCountryDisplayName({ isDemo: false, iso2: country.iso2, iso3: country.iso3, nameEn: country.name }, locale)} · {country.iso3}</option>)}
          </select>
        </label>)}
        <label className="grid gap-1 text-sm">{dictionary.queryEditor.scope}<select aria-label={dictionary.queryEditor.scope} className={inputClass} name="applicationScope" defaultValue={query?.applicationScope ?? "construction"} required>{applicationScopes.map(scope => <option key={scope} value={scope}>{applicationScopeLabel(scope, dictionary)}</option>)}</select></label>
        <label className="grid gap-1 text-sm">{dictionary.queryEditor.power}<input className={inputClass} name="powerKw" type="number" min="0" max="100000" step="0.001" defaultValue={query?.powerKw ?? 120} required /></label>
        <label className="grid gap-1 text-sm">{dictionary.queryEditor.date}<input className={inputClass} name="asOf" type="date" defaultValue={query?.asOf ?? today} required /></label>
      </div>
      <Button type="submit">{copy.runComparison}</Button>
      {invalid ? <p role="alert" className="text-sm text-destructive">{copy.invalidComparison}</p> : null}
    </form>
    {query ? state.status === "loading" ? <p role="status">{dictionary.common.loading}</p> : state.status === "error" ? <div role="alert" className="space-y-3 rounded-md border p-4">
      <p>{copy.comparisonError}</p><Button variant="outline" onClick={() => { setState({ status: "loading" }); setAttempt(value => value + 1); }}>{dictionary.common.retry}</Button>
    </div> : <>
      <SaveAnalysis defaultTitle={`${query.countryIso3s.join(" / ")} · ${query.powerKw} kW · ${query.asOf}`} createPayload={() => ({ kind: "comparison", comparison: state.snapshot })} />
      <ComparisonResults snapshot={state.snapshot} />
    </> : <p className="rounded-md border border-dashed p-5 text-sm">{copy.comparisonEmpty}</p>}
  </div>;
}
