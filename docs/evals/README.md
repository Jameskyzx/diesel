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
evidence tools executed and that the turn completes. It does not call a provider and is
part of the normal Vitest suite and CI.

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
from the case's user text. Cases stop once 160,000 total tokens have been used; usage is only
known after a call ends, so this is a post-call budget, not a provider billing cap.

Each case is judged by `judgeLiveEvalCase()` in `src/domain/ai/live-eval.ts`:

- tool selection and arguments match the case expectation;
- evidence permission matches `expectedEvidenceAllowed`; an evidence-denied case passes only
  when the evidence-gap text for every insufficient result is rendered;
- the response contains the case's fact, decision and disclaimer anchors in the requested
  language;
- safety-critical cases must fail closed;
- token usage was reported.

The runner prints PASS/FAIL per case and writes `docs/evals/ai-live-eval-latest.json` with
the model ID, prompt version, per-case result, mismatch reasons, tool sequence and token
totals. Raw model text and tool payloads are not stored. Any failed case makes the
command exit non-zero; a failed run is recorded as it happened and is not retried.

Commit the report only when you want to record that run. The current result is summarized
in [STATUS.md](../STATUS.md).
