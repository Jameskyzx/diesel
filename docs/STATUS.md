# Project status / 当前项目状态

The current-state index. Detailed release narratives up to 2026-10-17 are frozen in
[STATUS-HISTORY-2026-10-17.md](STATUS-HISTORY-2026-10-17.md) and
[STATUS-HISTORY-2026-10-04.md](STATUS-HISTORY-2026-10-04.md); operator records stay in
[evidence/operations](evidence/operations/).
本文件只记录现在是什么状态。历史过程见上面的冻结日志。

## Production / 线上

- Public read-only demo: <https://diesel.jamesky.site>.
- Last operator readback: 2026-10-24T12:42+00:00, `/api/health` `status=ok`, release
  `066d44b6905ffed21ea50c563077691b1393b8dc`. This is an operator observation, not a
  continuously verified claim.
- Release 2026-10-24 (full governance release, durable operation `11a8fcdb`, completed
  12:40 UTC, exit 0, host `COMMITTED` / `PUBLISH_FINALIZED`): customer feedback capture
  (AI-drafted, human-confirmed `engine_feedback`), the model page `/products/<model>`, the
  feedback comparison page, CSV/JSON export, the chat feedback lookup (ADR-276) and the Next.js
  16.4.1 / Vite 8.1.6 security upgrade are live. Migration `0015` was applied beforehand in the
  maintenance lock and production readback verified it (16 repository migrations plus one
  recognized legacy entry). The release exported and rehearsed a v6 governance snapshot,
  republished the 97-country fixtures, kept the 24 catalogue models unchanged and published 14
  fictional demo feedback records; `/api/product-feedback` returns 14 demo records and `/`,
  `/products`, `/products/DEMO-H13-460`, `/products/feedback`, `/products/brief`, `/map` return
  200.
- Before `0015` only a schema-only `pg_dump` was taken (the migration adds tables and an enum
  value and changes no existing rows; a full dump does not complete over the slow Supabase link).
  Browser and live-AI acceptance were not rerun against production.
- Deployment and rollback follow [DEPLOYMENT.md](DEPLOYMENT.md). After each release, update
  the block below; the production canary compares it with `/api/health`.

<!-- production-release:start -->
```json
{
  "publicRuntime": {
    "observedAt": "2026-10-24T12:42+00:00",
    "status": "ok",
    "version": "066d44b6905ffed21ea50c563077691b1393b8dc"
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
- Paid live AI eval: the chat prompt is now `sales-chat-system-v14` (feedback lookup); the
  recorded runs below used `v13` or earlier and are not evidence for `v14`. No paid run has
  been made on `v14`.
- Paid live AI eval: `pnpm ai:eval:live` writes `docs/evals/ai-live-eval-latest.json`;
  see [evals/README.md](evals/README.md). Last recorded run, 2026-10-18 16:17 UTC, local
  uncommitted worktree (contract `sales-chat-live-v27`, `deepseek-flash`, prompt
  `sales-chat-system-v13`, ADR-275): **18/18 passed**, 152,633 tokens of the 180,000 budget,
  and all 5 safety-critical cases failed closed. This is one run on one model, not proof
  of stability, and the code is not yet committed or deployed. Earlier runs that day:
  - 06:44 UTC, prompt `v12`: 16/18. `sales-brief` ran a second brief with the comparison
    country BRA as its target. `source-document-retrieval` sent the model's wording
    verbatim to full-text search, which missed the requested section. Both are fixed for
    `v13`: the brief target is stated in the action schema, and the finish check now reuses
    the target each task actually ran with. Source search uses the user's own terms when
    their request is plain words.
  - First harness run, contract `v26`, prompt `v11`: 7/18. The 160,000-token budget stopped
    it after 13 cases. Its anchors were matched only in the model's message text.
  - The 17/18 from 2026-10-16 was on the removed `streamSalesChat()` path and is not
    evidence for the harness.
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
