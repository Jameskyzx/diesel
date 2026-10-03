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

- Home: API-derived catalog/review/freshness/gap counts, a searchable country
  evidence table, a review-rate card and a compact workflow list. Review counts
  are not numerical regulatory coverage, and demo counts are labeled fictional.
- Map: country selector and shortcuts in the map card's toolbar. At 1440 px and
  above, country details occupy a reserved, non-overlapping right-hand panel;
  smaller screens retain the non-modal drawer and its independent locale control.
- Country: section shortcuts scroll to regulations, product fit, market and
  sources without hiding facts or unmounting the product-fit form. Existing
  cancellation, URL identity and history logic remain unchanged.
- Chat: applicability parameters are shown beside a bounded conversation pane.
  Empty, configured, error and completed responses retain their real states.
  The displayed context comes from the existing validated URL, not model memory.

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

English and Chinese share this composition. Small screens use a top brand bar
and three visible navigation links rather than hiding the primary routes. All
controls remain keyboard accessible; the decorative engine icon is retained.

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
