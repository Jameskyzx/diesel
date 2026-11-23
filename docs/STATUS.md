# Project status / 当前项目状态

The current-state index. Detailed release narratives up to 2026-10-17 are frozen in
[STATUS-HISTORY-2026-10-17.md](STATUS-HISTORY-2026-10-17.md) and
[STATUS-HISTORY-2026-10-04.md](STATUS-HISTORY-2026-10-04.md); operator records stay in
[evidence/operations](evidence/operations/).
本文件只记录现在是什么状态。历史过程见上面的冻结日志。

## Production / 线上

- Public read-only demo: <https://diesel.jamesky.site>.
- Last operator readback: 2026-10-28T05:05+00:00, `/api/health` `status=ok`, release
  `7462e6ca5856a8f76ef8f4f500601f1ac3816213`. This is an operator observation, not a
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
- Release 2026-10-24 (full governance release, durable operation `19264c12`, completed
  19:33 UTC, exit 0, host `COMMITTED` / `PUBLISH_FINALIZED`): the dependency advisory fixes
  `postal-mime` 4.0.8 and `undici` 7.30.1 (DEPENDENCY_SECURITY.md) are live and installed in the
  release tree. No migration; the catalogue (24) and the 14 demo feedback records were kept
  unchanged, and the public routes above return 200.
- Release 2026-10-28 (application release, durable operation `2fe3721b`, completed 05:04 UTC,
  exit 0, host `COMMITTED` / `APPLICATION_VERIFIED_V2`; the 18 data-table fingerprints are
  identical before and after): country details now read the detail rows and the applicability
  comparison in one pipelined wave after the coverage gate (7 → 5 database round-trips for a
  filtered lookup, ARCHITECTURE.md). The canary's `CHN` non-road lookup returned 200 in 1.7–2.7 s
  end to end after the switch.
- Release attempt 2026-11-23 (`08d440a4`, full governance release of the November
  re-verification, durable operation `a76d1157`): failed safely and is not live.
  - The host activated at 13:58 UTC. The pre-write governance snapshot export then reached its
    90-minute budget and was terminated, and the host rolled back to
    `7462e6ca5856a8f76ef8f4f500601f1ac3816213` at 15:29 UTC.
  - No governance data was written, and no recovery marker remains. At 15:31 UTC,
    `/api/health` returned `status=ok` on 7462e6ca.
  - Cause: the server-to-database link was about 3–6× slower than in the October releases.
    Reading 500 limit rows took about 22 s instead of about 9 s, and the reader saw four
    `CONNECTION_CLOSED` retries. The data had grown only about 6%.
  - A durable operation is single-use per SHA, so the retry uses a newer master commit. It
    starts only after a read-only link check shows normal speed. The 90-minute budget is
    unchanged.
- Deployment and rollback follow [DEPLOYMENT.md](DEPLOYMENT.md). After each release, update
  the block below; the production canary compares it with `/api/health` and also accepts the
  exact master commit it checked out, so the window before this record merges does not fail.

<!-- production-release:start -->
```json
{
  "publicRuntime": {
    "observedAt": "2026-10-28T05:05+00:00",
    "status": "ok",
    "version": "7462e6ca5856a8f76ef8f4f500601f1ac3816213"
  }
}
```
<!-- production-release:end -->

## Data boundary / 数据边界

| Item | Current | Boundary |
| --- | --- | --- |
| Published regulation closure | 97 jurisdictions / 29 regulations / 667 limits / 204 sources | Reviewed public-source fixtures; not legal advice |
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
  see [evals/README.md](evals/README.md). Last recorded runs, 2026-11-10 14:18 and 14:19 UTC,
  on clean commit `f492ba4` (contract `sales-chat-live-v27`, `deepseek-flash`, prompt
  `sales-chat-system-v14`): **18/18 passed twice**, 170,204 and 161,960 tokens of the 180,000
  budget, and no safety-critical case failed. The committed report is the second run. Both
  ran locally on Node 24.22.1, not the pinned 22.22.3. Two runs on one model are not proof of
  stability, and the first run used 95% of the token budget.
  - Earlier: 2026-10-18, prompt `v13`, 18/18 on an uncommitted worktree; before that 16/18
    (`v12`) and 7/18 (`v11`, stopped by the token budget). Details are in git history.
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
