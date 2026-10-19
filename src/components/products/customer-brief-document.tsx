import type { CustomerBrief } from "@/domain/products/customer-brief";
import {
  briefDirection,
  customerBriefCopy,
  formatBriefDate,
  formatBriefNumber,
  type BriefLanguage,
} from "@/i18n/customer-brief";
import { isNavigableEvidenceUrl } from "@/lib/source-link";

/** A print-ready, customer-facing brief. Every fact comes from `brief`. */
export function CustomerBriefDocument({ brief, countryName, language, preparedOn }: {
  brief: CustomerBrief; countryName: string; language: BriefLanguage; preparedOn: string;
}) {
  const copy = customerBriefCopy[language];
  const date = (value: string) => formatBriefDate(value, language);
  const number = (value: number) => formatBriefNumber(value, language);
  const { query } = brief;

  return <article lang={language} dir={briefDirection(language)} data-testid="customer-brief"
    className="customer-brief mx-auto max-w-3xl space-y-6 rounded-lg border bg-white p-8 text-slate-900 shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
    <header className="space-y-3 border-b pb-4">
      <h1 className="text-2xl font-semibold">{copy.title(countryName)}</h1>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div><dt className="inline font-medium">{copy.conditions.market}: </dt><dd className="inline">{countryName} ({query.countryIso3})</dd></div>
        <div><dt className="inline font-medium">{copy.conditions.application}: </dt><dd className="inline">{copy.scopes[query.applicationScope]}</dd></div>
        <div><dt className="inline font-medium">{copy.conditions.power}: </dt><dd className="inline">{copy.kw(number(query.powerKw))}</dd></div>
        <div><dt className="inline font-medium">{copy.conditions.asOf}: </dt><dd className="inline">{date(query.asOf)}</dd></div>
      </dl>
    </header>

    <section className="space-y-2" aria-labelledby="brief-regulations">
      <h2 id="brief-regulations" className="text-lg font-semibold">{copy.sections.regulations}</h2>
      {brief.noRegulationData
        ? <p className="text-sm">{copy.noRegulations}</p>
        : <ul className="space-y-3 text-sm">{brief.regulations.map(regulation =>
          <li key={regulation.regulationId} className="break-inside-avoid rounded-md border p-3" data-testid="brief-regulation">
            <p className="font-medium"><bdi>{regulation.citationCode ?? "—"}</bdi> · <bdi lang="und">{regulation.canonicalName}</bdi></p>
            <p>{copy.regulation.status}: {regulation.recordStatus === "effective" ? copy.regulation.effective : copy.regulation.superseded}
              {" · "}{copy.regulation.validity(date(regulation.effectiveFrom), regulation.effectiveTo ? date(regulation.effectiveTo) : null)}</p>
            <p>{copy.regulation.source}: {isNavigableEvidenceUrl(regulation.source.url)
              ? <a className="break-all text-blue-700 underline" href={regulation.source.url}><bdi lang="und">{regulation.source.title}</bdi></a>
              : <bdi lang="und">{regulation.source.title}</bdi>}
              {" · "}{copy.regulation.verified(date(regulation.source.verifiedAt))}</p>
          </li>)}</ul>}
    </section>

    <section className="space-y-2" aria-labelledby="brief-candidates">
      <h2 id="brief-candidates" className="text-lg font-semibold">{copy.sections.candidates}</h2>
      {brief.candidates.length === 0
        ? <p className="text-sm">{copy.noCandidates}</p>
        : <ul className="space-y-3 text-sm">{brief.candidates.map(({ record, coveredCitations }) =>
          <li key={record.id} className="break-inside-avoid rounded-md border p-3" data-testid="brief-candidate">
            <p className="font-semibold"><bdi>{record.model}</bdi> · {copy.categories[record.category]}</p>
            <p>{copy.candidate.rating(number(record.ratedPowerKw), number(record.ratedSpeedRpm))} · {copy.candidate.band(number(record.powerMinKw), number(record.powerMaxKw))}</p>
            <p>{copy.candidate.declaration}: <bdi>{record.emissionLabel}</bdi> · {copy.candidate.aftertreatment}: <bdi>{record.aftertreatment}</bdi></p>
            <p>{copy.candidate.covers}: <bdi>{coveredCitations.join("; ")}</bdi></p>
          </li>)}</ul>}
      {brief.declarationGapCount > 0 && <p className="text-sm text-slate-600">{copy.gapNote(brief.declarationGapCount)}</p>}
    </section>

    <section className="space-y-2" aria-labelledby="brief-next-steps">
      <h2 id="brief-next-steps" className="text-lg font-semibold">{copy.sections.nextSteps}</h2>
      <ol className="list-decimal space-y-1 ps-5 text-sm">{copy.nextSteps.map(step => <li key={step}>{step}</li>)}</ol>
    </section>

    <section className="space-y-1 border-t pt-4 text-xs text-slate-600" aria-labelledby="brief-notes" data-testid="brief-notes">
      <h2 id="brief-notes" className="text-sm font-semibold text-slate-900">{copy.sections.notes}</h2>
      <p>{copy.notes.fictional}</p>
      <p>{copy.notes.notCertification}</p>
      {brief.realRegulationData && <p>{copy.notes.realRegulations}</p>}
      {brief.noRegulationData && <p>{copy.notes.noData}</p>}
      <p>{copy.notes.sourceLanguage}</p>
      <p>{copy.generated(date(preparedOn), brief.rulesetVersion)}</p>
    </section>
  </article>;
}
