"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { useLocale } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import type { ChatUrlContext } from "@/features/ai/chat-url-context";
import { buildQueryContextSearch } from "@/features/ai/query-context-form";
import type { CountryDirectory } from "@/features/countries/schemas";
import { applicationScopes } from "@/features/database/schemas";
import { formatCountryDisplayName } from "@/i18n/country-name";
import { applicationScopeLabel } from "@/i18n/structured-labels";

export function QueryContextForm({ context, countries = [], mode, beforeNavigate }: {
  context: ChatUrlContext;
  countries?: CountryDirectory;
  mode: "chat" | "regulations";
  beforeNavigate?: () => void;
}) {
  const { dictionary, locale } = useLocale();
  const copy = dictionary.queryEditor;
  const params = useSearchParams();
  const [invalid, setInvalid] = useState(false);
  const regulations = mode === "regulations";
  const id = regulations ? "regulation-query-form" : "chat-context-form";
  const inputClass = "h-10 w-full min-w-0 rounded-md border bg-background px-2 text-sm";

  return <form
    action={regulations ? `/countries/${context.countryIso3}` : "/chat"}
    aria-label={regulations ? copy.regulationTitle : dictionary.workspace.queryContext}
    className="space-y-3"
    data-testid={id}
    data-vaul-no-drag
    id={id}
    method="get"
    onSubmit={(event) => {
      const search = buildQueryContextSearch(Object.fromEntries(new FormData(event.currentTarget)), params.toString(), mode);
      if (search === null) { event.preventDefault(); setInvalid(true); return; }
      beforeNavigate?.();
      // Native GET navigation isolates chat contexts and cancels pending country
      // requests. Existing server URL validation canonicalizes optional blanks.
    }}
  >
    {[...params.entries()].filter(([name]) => !["applicationScope", "asOf", "countryIso3", "powerKw", "productModelCode"].includes(name)).map(([name, value], index) => <input key={`${name}:${index}`} name={name} type="hidden" value={value} />)}
    {regulations ? <h2 className="font-semibold">{copy.regulationTitle}</h2> : null}
    <p className="text-xs leading-5 text-muted-foreground">{regulations ? copy.regulationHelp : copy.chatHelp}</p>
    <fieldset className="grid min-w-0 gap-3">
      {!regulations ? <label className="grid gap-1.5 text-xs font-medium">
        {dictionary.workspace.contextCountry}
        <select aria-label={dictionary.workspace.contextCountry} className={inputClass} defaultValue={context.countryIso3 ?? ""} name="countryIso3">
          <option value="">{copy.optional}</option>
          {countries.map((country) => <option key={country.iso3} value={country.iso3}>
            {formatCountryDisplayName({ isDemo: false, iso2: country.iso2, iso3: country.iso3, nameEn: country.name }, locale)} · {country.iso3}
          </option>)}
        </select>
      </label> : null}
      <label className="grid gap-1.5 text-xs font-medium">
        {regulations ? copy.scope : dictionary.workspace.contextScope}
        <select aria-label={regulations ? copy.scope : dictionary.workspace.contextScope} className={inputClass} defaultValue={context.applicationScope ?? ""} name="applicationScope" required={regulations}>
          <option value="">{copy.optional}</option>
          {applicationScopes.map((scope) => <option key={scope} value={scope}>{applicationScopeLabel(scope, dictionary)}</option>)}
        </select>
      </label>
      <label className="grid gap-1.5 text-xs font-medium">
        {regulations ? copy.power : dictionary.productFit.power}
        <input aria-label={regulations ? copy.power : dictionary.productFit.power} className={inputClass} defaultValue={context.powerKw ?? ""} max="100000" min="0" name="powerKw" required={regulations} step="0.001" type="number" />
      </label>
      <label className="grid gap-1.5 text-xs font-medium">
        {regulations ? copy.date : dictionary.workspace.contextDate}
        <input aria-label={regulations ? copy.date : dictionary.workspace.contextDate} className={inputClass} defaultValue={context.asOf ?? ""} name="asOf" required={regulations} type="date" />
      </label>
      {!regulations ? <label className="grid gap-1.5 text-xs font-medium">
        {dictionary.workspace.contextProduct}
        <input aria-label={dictionary.workspace.contextProduct} className={inputClass} defaultValue={context.productModelCode ?? ""} maxLength={100} name="productModelCode" placeholder={copy.optional} />
        <span className="font-normal leading-5 text-muted-foreground">{copy.productHelp}</span>
      </label> : null}
      <Button className="h-auto min-h-10 whitespace-normal" type="submit">{regulations ? copy.runRegulations : copy.applyChat}</Button>
    </fieldset>
    {invalid ? <p className="text-xs text-destructive" role="alert">{copy.invalid}</p> : null}
  </form>;
}
