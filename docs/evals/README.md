# AI evaluations

Two evaluations cover the sales-chat AI. Neither changes how facts are produced:
regulations, product fit and scores always come from deterministic tools.

## Offline harness eval (default, free)

```bash
pnpm ai:eval
```

Runs `tests/sales-chat-harness.test.ts` against `evals/sales-chat-harness-cases.ts`: each case
goes through the route's direct replies and the production harness loop with the
deterministic offline demo model and the fictional PGlite database, and asserts the exact
evidence tools executed and that the turn completes. The same file also replays all 18 live
cases offline through `runLiveEvalCase()` (the live runner's own judging), with the demo model
or, for the two-task case, a scripted action sequence. A failure there means the live contract,
not the provider, is wrong. It also checks that every card line the live eval grounds on is
visible in the rendered result card. It does not call a provider and is part of the normal
Vitest suite and CI.

## Live eval (paid)

```bash
pnpm ai:eval:live
```

Runs the 18 bilingual cases in `evals/sales-chat-live-cases.ts` through the production
harness loop (`catalogHarnessResponse()`) with the model configured in `.env.local`
(`AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`). Multi-turn cases are sent turn by turn with the
signed receipt, exactly as the browser does. It uses the fictional PGlite demo database,
an in-memory rate limiter, no SDK retries, the harness's own five-call / 1,500-token-per-call
bound and a 90-second deadline per case. The required evidence is derived independently
from the case's user text.

The budget is 180,000 tokens, and a case starts only while 12,000 tokens remain. Usage is
known only after a call ends, so this is a post-call budget, not a provider billing cap. How
it is derived: every harness step resends about 10.5k characters (system prompt about 4.4k,
tool schema about 5.6k). The 2026-10-18 report calibrates this at about 3 characters per
token, so a step is about 3.7k tokens. The 18 cases need at least 39 steps (16 × 2, the
two-task case 3, the two-turn case 4), which is about 144k. About 33k is left for nine
corrective steps; the 2026-10-18 run averaged about 0.6 extra steps per case. The harness
returns only `{tool, status, evidenceSufficient, answered}` to the model, because its
narrative may not state facts. Before this, evidence payloads added up to about 15k characters
per step, and the same suite would have needed about 245k.

Each case is judged by `judgeLiveEvalCase()` in `src/domain/ai/live-eval.ts`:

- tool selection and arguments match the case expectation;
- evidence permission matches `expectedEvidenceAllowed`; an evidence-denied case passes only
  when the evidence-gap text for every insufficient result is rendered;
- grounding: every fact, decision and disclaimer anchor must appear in the server-rendered
  evidence. That is the fact/gap paragraphs after the model's narrative
  (`HarnessTurnSummary.evidenceText`), plus each result card's deterministic fields
  (`toolResultCardText()`, after the browser's own `toolPartPresentation()` check). The
  model's narrative can never satisfy an anchor by itself. It can still veto one: a
  contradiction (`noneOf`) anywhere the user can read fails the anchor. The message text must
  be in the requested language;
- safety-critical cases must fail closed;
- token usage was reported.

The runner prints PASS/FAIL per case and writes `docs/evals/ai-live-eval-latest.json` with
the model ID, prompt version, per-case result, mismatch reasons, tool sequence, sanitized
arguments (free text fingerprinted), evidence decision and token totals. Raw model text and
tool payloads are not stored. Any failed case makes the
command exit non-zero; a failed run is recorded as it happened and is not retried.

Commit the report only when you want to record that run. The current result is summarized
in [STATUS.md](../STATUS.md).
