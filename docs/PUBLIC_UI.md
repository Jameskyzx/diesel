# Public workspace reconstruction

The public UI follows the structural patterns of Tabler's vertical dashboard:
a fixed desktop sidebar, a separate utility toolbar, compact page headers,
metric tiles, card headers and data tables. It is implemented with the existing
React, Tailwind, lucide and shadcn primitives; no Bootstrap runtime or additional
dependency is loaded.

Reference layouts: [vertical dashboard](https://preview.tabler.io/layout-vertical.html),
[sidebar source](https://github.com/tabler/tabler/blob/main/shared/components/navbar/Sidebar.astro),
[page headers](https://github.com/tabler/tabler/blob/main/docs/content/ui/layout/page-headers.mdx).
Tabler is MIT licensed; the upstream notice is preserved below.

## Page composition

- Home: the versioned published snapshot is the primary metric row: 97
  jurisdictions, 28 regulations, 651 limit records, 203 sources and zero approved
  real products. These values are checked against the signed publication closure
  by unit tests and `portfolio:verify`; they are not live database counts. API-derived
  catalog/review/freshness counts remain separate. Review counts are not numerical
  regulatory coverage, and the offline Demo retains its fictional counts.
- Map: country selector and shortcuts in the map card's toolbar. At 1440 px and
  above, country details occupy a reserved, non-overlapping right-hand panel;
  smaller screens retain the non-modal drawer and its independent locale control.
- Country: section shortcuts scroll to regulations, product fit, market and
  sources without hiding facts or unmounting the product-fit form. Existing
  cancellation, URL identity and history logic remain unchanged.
- Country regulation research has its own application/power/date form, without
  selecting a product or calling AI. It uses the existing validated country
  query and applicability summary. Submitting removes any product from the
  shared URL, preserves unrelated parameters and cancels pending product work.
  Product fit remains a separate workflow, explicitly labeled when its entire
  catalogue is fictional Demo data.
- Chat: applicability parameters are editable beside a bounded conversation pane.
  Empty, configured, error and completed responses retain their real states.
  The starting context comes from the validated URL, not model memory. Applying
  changed conditions navigates to a separate conversation and prepares a draft;
  it never sends a model request automatically. A blank product means regulatory
  research only. Draft edits can override starting conditions, so every tool card
  separately displays its actual query (including country-profile cards).
- Evidence gaps include localized next steps based on structured result/reason
  codes: verify input, obtain applicable official regulations, manufacturer
  specifications or certificates, or comparable market observations. Successful
  checks do not create missing-field requests. Product gap copies include these
  next steps; they still only copy locally and never submit tickets. No evidence
  boundary or readiness decision is relaxed by this presentation change.

### Chat starter contract

Starters send immediately through the same guarded submission path as the
composer (including attachment validation, locale, cancellation and recovery).
They are disabled while a request or file validation is pending. Browser tests
cover the request body and rendered reply for all three starters in both locales
on desktop and mobile; these mocked transport tests are not live-model evidence.

The live entry points are CHN current regulations, CHN/JPN construction-equipment
120 kW regulation comparison, and CHN market metrics/reporting periods. Generic
non-road is not silently expanded to construction. The former AUS/CHN sales-brief
starter was removed because its advertised scope lacked comparable real data;
real products remain unpublished, and missing evidence must still fail closed.
Unscoped regulatory status uses structured country profiles. Explicit requests
for original documents continue to use knowledge retrieval.

### User journey corrections

Country replacement is resolved before a pair of mentioned country names can
replace the comparison set. For example, after CHN/JPN construction 120 kW,
“replace Japan with Germany” retains CHN and produces CHN/DEU at the original
scope, power and date. A missing original country or a collapsed one-country
comparison remains an explicit parameter gap. The evidence gate is unchanged;
this corrects its input rather than relaxing validation.

Country-profile cards render only their requested topics. Market-only requests
show observations, units, application, reporting periods and source verification,
with a historical-data notice; unrelated regulation lists no longer precede them.
Card source lists are filtered to the requested topics plus country identity,
and their latest-verification date is recalculated from those displayed sources.
The original validated tool output and evidence checks are not changed.
The map legend explicitly describes published evidence boundaries, not numeric
regulatory coverage.

Completed conversations are restored from this browser tab's `sessionStorage`
for at most 24 hours after completion. The cache is bounded to 1 MB and 12 user
turns and validated with Zod, including tool-result/input consistency. It never
stores uploaded bytes, reasoning or provider metadata. Changing validated URL
context starts a separate conversation; “New chat” clears the cached conversation.
Storage denial or an oversized conversation produces a visible warning while
chat remains usable. Restored cards retain their original query/verification
dates and are labeled as restored; subsequent requests transmit only user text
history and re-query server evidence. This is tab-local recovery, not a new
server-side history store or write API. Browser tests cover reload, follow-up,
clear, context isolation and storage failure in both languages and viewport sizes.

English and Chinese share this composition. Small screens use a top brand bar
and five visible navigation links rather than hiding the primary routes. All
controls remain keyboard accessible; the decorative engine icon is retained.

### Saved analyses, independent comparison and evidence review

- `/compare` compares two or three distinct directory countries at one validated
  application, power and date, preserved in the URL. It reuses the existing public
  country API and its deterministic applicability summary; no model, product
  selection, database schema or public write API is involved. Every response must
  match all requested conditions before the complete table is displayed. Missing
  evidence stays distinct from request failures. Dates, units, future-adopted
  regulations, Demo labels, stale flags and sources remain visible; the table
  does not rank different test cycles or legal scopes as equivalent.
- Completed chats and comparison results can be explicitly saved to `/analyses`.
  This is a browser-local archive, not account storage or a cloud backup: at most
  ten analyses / four MB, Zod-validated on read and write, with no silent eviction.
  Clearing site data removes the archive. Storage denial, corrupt data and quota
  failures are visible and do not overwrite prior work. Individual deletion needs
  confirmation. The separate automatic 24-hour tab recovery contract is unchanged.
- Snapshots retain the original structured facts, warnings, query conditions,
  citations and verification dates, plus the saved time. They are labeled as
  historical, locally editable records, not fresh or certified evidence. They
  never feed facts back to the model/server. Attachments, reasoning and provider
  metadata are excluded. Failed or interrupted new chat turns cannot be saved as
  completed analyses.
- JSON export preserves the validated structured snapshot and works directly from
  results even if local storage is unavailable. Readable HTML reports export from
  the saved view, include all expanded sources and the historical notice, work
  offline, and can be printed or saved as PDF using the browser. The report has no
  scripts or remote assets; users should check sensitive content before sharing.
- Source review preserves original-language retrieved excerpts only when the
  citation matches the chunk, document and source IDs. Recorded page and section
  locators are displayed together; a PDF page link is added only for an actual
  recorded page on an unfragmented PDF URL. Structured results without excerpts
  explicitly say so: dates and record IDs are not invented original-text locators.

These are repository capabilities, not a production-release claim; deployment
status remains in `STATUS.md`.

The browser tab and Apple touch icons reuse that same approved diesel-engine
artwork. Regenerate them with `pnpm exec tsx scripts/portfolio/generate-brand-icons.ts`.
`src/app/icon.svg` embeds its small PNG directly so it needs no external image
fetch; Next's file-based metadata supplies a content-versioned favicon URL.
The browser regression checks the icon actually selected by the page, not just
whether an arbitrary image endpoint returns HTTP 200.

The user approved publishing this reconstruction on 2026-10-03. Approval does
not establish that it has been deployed: production status remains solely in
`STATUS.md`, and the normal release checks and public readback are required
before recording it as published.

## Accessibility test boundary

The bilingual non-modal country keyboard tests each use a fresh browser context
with an explicitly seeded `diesel_locale` cookie. They assert the server-rendered
language before exercising real focus, Tab/Enter navigation, drawer state and
the destination page. Initializing this keyboard fixture does not make an
unrelated HTTP preference request. Actual preference POSTs and user-driven
switching remain covered by `e2e/locale.spec.ts`, the header accessibility flows
and `tests/locale-route.test.ts`; no retry, timeout or keyboard assertion is
relaxed. Transport diagnostics from earlier CI runs remain failures, not
replacement release evidence.

## Upstream MIT notice

The MIT License (MIT)

Copyright (c) 2018-2026 The Tabler Authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
