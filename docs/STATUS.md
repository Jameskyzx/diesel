# Project status / 当前项目状态

The current-state index. Detailed release narratives up to 2026-10-17 are frozen in
[STATUS-HISTORY-2026-10-17.md](STATUS-HISTORY-2026-10-17.md) and
[STATUS-HISTORY-2026-10-04.md](STATUS-HISTORY-2026-10-04.md); operator records stay in
[evidence/operations](evidence/operations/).
本文件只记录现在是什么状态。历史过程见上面的冻结日志。

## Production / 线上

- Public read-only demo: <https://diesel.jamesky.site>.
- Last operator readback: 2026-10-15T04:33+00:00, `/api/health` `status=ok`, release
  `99ddb305e8b653c1303977fc9f6c5d21620ce25e`. This is an operator observation, not a
  continuously verified claim.
- Not yet deployed: the fictional catalogue and target-market selection (`catalog-fit-v1`),
  the removal of the portfolio evidence tooling, and the single AI orchestration path (all chat
  requests, uploads and the offline demo now use the harness loop), the multilingual customer
  brief, and the governed catalogue (Migration `0014`, `read-excel-file` dependency). The next
  release changes `package.json` and adds a migration, so it requires a full (governance)
  release; its fixture queue publishes the demo catalogue and the governance snapshot is now
  v5 with `catalog_engines` (see DEPLOYMENT.md §4.4, ADR-274).
- Deployment and rollback follow [DEPLOYMENT.md](DEPLOYMENT.md). After each release, update
  the block below; the production canary compares it with `/api/health`.

<!-- production-release:start -->
```json
{
  "publicRuntime": {
    "observedAt": "2026-10-15T04:33+00:00",
    "status": "ok",
    "version": "99ddb305e8b653c1303977fc9f6c5d21620ce25e"
  }
}
```
<!-- production-release:end -->

## Data boundary / 数据边界

| Item | Current | Boundary |
| --- | --- | --- |
| Published regulation closure | 97 jurisdictions / 28 regulations / 651 limits / 203 sources | Reviewed public-source fixtures; not legal advice |
| Country directory | 178 ISO3 entries, 177 map features | Directory presence is not numeric-regulation coverage |
| Approved real products / certifications | 0 / 0 | No real commercial-availability claim |
| Product catalogue | Governed `catalog_engines`; fixture of 24 fictional `DEMO-` models | Declarations, not certification; public read returns demo rows only |
| Demo governed products | 2 fictional configurations | Exercise `fit / not_fit / unknown` |
| Market observations | 24 reviewed fixtures (CHN/USA/DEU/BRA, 2022/2023) | Not live market data |

## Quality checks / 质量检查

- Merge gate: the `Required CI gate` job in [ci.yml](../.github/workflows/ci.yml) (lint,
  typecheck, coverage-gated Vitest, migrations, build, Playwright public/demo/FDE/CSP,
  secret scan, supply-chain audit, deployment contracts, Linux release handoff).
- Offline AI eval: `pnpm ai:eval` (deterministic, no paid model).
- Paid live AI eval: `pnpm ai:eval:live` writes `docs/evals/ai-live-eval-latest.json`;
  see [evals/README.md](evals/README.md). Last recorded run, 2026-10-18, first run on the
  harness loop (`sales-chat-live-v26`, `deepseek-flash`, prompt `sales-chat-system-v11`):
  **7/18 passed, failed**; 13 cases evaluated, then the 160,000-token budget stopped the run
  (176,657 tokens), so 5 cases were not run. All 6 failures include `response_grounding`: the
  cases still expect facts and decisions in the model text, while the harness puts them in
  structured result cards and its narrative guard keeps them out of the text. Both product cases
  also called `compareRegulations` before `findCompatibleProducts` (`tool_selection`), and
  `source-document-retrieval` also failed `arguments`/`evidence_expectation`. The live eval
  contract therefore does not yet match the harness; the earlier 17/18 (2026-10-16) was on the
  removed `streamSalesChat()` path and is not evidence for the harness.
- Production canary: every 6 hours via
  [production-canary.yml](../.github/workflows/production-canary.yml), including one real
  AI starter.

## External gates / 不能由代码替代的外部门槛

| Gate | Status | Needed |
| --- | --- | --- |
| Real product compliance | Not started | Spec versions and traceable certification sources; approved fixtures are 0 |
| Regulation expert review | Not done | Independent sign-off of dates, scopes, values and sources |
| Real sales pilot | Not run | Participants, baseline, task records, feedback and measured outcome |
| Private knowledge base | Not configured | Licensed documents, private storage, representative retrieval benchmark |

This site is a public read-only portfolio demo, not a regulatory service or a verified
business production system.
