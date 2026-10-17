# AI evaluations

Two evaluations cover the sales-chat AI. Neither changes how facts are produced:
regulations, product fit and scores always come from deterministic tools.

## Offline harness eval (default, free)

```bash
pnpm ai:eval
```

Runs `tests/sales-chat-harness.test.ts` against `evals/sales-chat-harness-cases.ts` with a
deterministic model. It checks tool selection, arguments and evidence gating without
calling a provider. It is part of the normal Vitest suite and CI.

## Live eval (paid)

```bash
pnpm ai:eval:live
```

Runs the 18 bilingual cases in `evals/sales-chat-live-cases.ts` through the production
`streamSalesChat()` loop with the model configured in `.env.local` (`AI_BASE_URL`,
`AI_MODEL`, `AI_API_KEY`). It uses the fictional PGlite demo database, an in-memory rate
limiter, no SDK retries, at most 1,024 output tokens per model call and a 90-second
deadline per case. Cases stop once 160,000 total tokens have been used; usage is only
known after a call ends, so this is a post-call budget, not a provider billing cap.

Each case is judged by `judgeLiveEvalCase()` in `src/domain/ai/live-eval.ts`:

- tool selection and arguments match the case expectation;
- evidence permission matches `expectedEvidenceAllowed`, and an evidence-denied case gives
  a whole-request refusal instead of an answer;
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
