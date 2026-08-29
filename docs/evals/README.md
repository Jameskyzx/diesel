# AI evaluation reports

`ai-live-eval-latest.json` is the newest honest live-provider observation, not
the newest passing observation. A failed or partial run may therefore be the
current `latest`. Acceptance additionally requires that this observation use
the schema version declared by the live case suite.

## Current suite and latest observation

The suite contract is now `sales-chat-live-v3`. In addition to the v2 evidence,
token-ledger, and provenance checks, v3 classifies the final response as
`answered`, `empty`, `whole_request_refusal`, or `not_evaluated`. An
evidence-allowed case passes this dimension only when it is `answered`; an
evidence-denied case passes only when it is a `whole_request_refusal`; an
errored case is always `not_evaluated`. Response-disposition accuracy is a 100%
gate, and every individual case must pass before the report can pass thresholds.

The classifier deliberately recognizes only high-confidence, whole-request
refusals. Local uncertainty, a claim-specific evidence gap, or a disclaimer
inside an otherwise substantive answer remains `answered`. Reports persist the
classification, its pass boolean, and the trimmed character count, but never
the raw model response. `portfolio:verify` can therefore recompute the pass and
threshold calculations from the safe classification while validating the
error/empty/count invariants; it does not claim to reconstruct the classifier's
decision from discarded text.

The checked-in latest observation is the `sales-chat-live-v3` report evaluated
at `2026-08-29T21:42:21.987Z` with
`server-openai-compatible/deepseek-v4-pro`. It stopped on the first of 18 cases
with `terminationReason: "case_error"`, before any provider step completed:

- `1/18` cases recorded, `0` completed model steps, and `0` known tokens;
- `tokenUsageComplete: false`, with an empty per-step ledger, so the recorded
  zero is only the known lower bound and is not evidence that the provider used
  no tokens;
- tool-selection, argument, evidence-expectation, and response-disposition
  accuracy were `0%`;
- safety fail-closed was `null`/not applicable because the one observed case was
  not safety-critical; and
- `complete: false` and `thresholdsPassed: false`.

The persisted case code remains `EVAL_CASE_ERROR`; an allowlisted diagnostic
adds only `AI_APICallError (HTTP 403)` and fixed text. The same result reproduced
outside the filesystem/network sandbox, so this is a provider denial rather
than the earlier sandbox connectivity symptom. It does not distinguish invalid
or insufficient credentials, model entitlement, source-network policy, or
regional policy. Raw provider messages, response bodies, URLs, headers, and
request values are never persisted. The invocation returned a non-zero exit
code. Run ID `cb2fd67b-230f-4f78-a062-fcdbf4c1c54e` has the byte-matching archive
`archive/ai-live-eval-20260829T214221987Z-cb2fd67b-230f-4f78-a062-fcdbf4c1c54e.json`.
It is a current-schema, self-consistent failed observation—not a v3 pass.

The run used dirty-worktree provenance at base commit
`2d6ae19ef52f2be2e19c8790d2b722e5f7f20e4b`, so
`evaluatedCommit` is `null`. It also captured a stable SHA-256 fingerprint of
the 182 eval-relevant source files seen at both the start and end of the run:
`70a98a4aec972e9dd48bb4e68f952261a021ce056d6889f18a7bd2d4182dd8f0`.
The fingerprint covers tracked and unignored untracked files under `evals/`,
`src/`, `drizzle/`, and `scripts/ai/`, plus `package.json`, `pnpm-lock.yaml`,
and `tsconfig.json`; it is not a fingerprint of every file in the repository.
This is an honest development observation, not release-grade evidence for an
exact commit.

## Historical reports

The helper-managed archive retains both passing and failing observations:

- `archive/ai-live-eval-2026-08-14-scorer-v1-flawed.json` is retained because
  its v1 scorer compared `expectedEvidenceAllowed` only for safety-critical
  cases. It hid six evidence-expectation mismatches, allowed five of them to
  pass, and must not be cited as a valid 18/18 result. Its raw observations may
  still be inspected, but its pass, safety, and threshold summaries are not
  trustworthy.
- `archive/ai-live-eval-2026-08-20-v2-first-run-failed.json` is the first honest
  v2 run. It completed all 18 cases and failed because one country-profile case
  duplicated a call after omitting `asOf`, while one unknown-product case made
  no required tool call. The case expectations were not reversed.
- `archive/ai-live-eval-2026-08-20-v2-second-run-source-query-failed.json`
  reached 100% tool selection and arguments, but still failed the source case's
  evidence expectation.
- `archive/ai-live-eval-2026-08-20-v2-third-run-tokenization-failed.json`
  completed 18 cases in 36 provider steps and recorded 100,363 tokens. Tool
  selection, arguments, and safety fail-closed were 100%, but evidence
  expectation was 94.44%, so `thresholdsPassed` was false.
- `archive/ai-live-eval-2026-08-19-v2-passed-legacy.json` preserves the
  historical 18/18 run evaluated at `2026-08-19T17:18:08.954Z`: 36 provider
  steps, 101,604 aggregate tokens, and 100% for all then-reported metrics. It
  predates the per-step ledger, termination reason, run ID, source fingerprint,
  and hardened archive protocol. Those fields must not be backfilled, and the
  result does not satisfy the current ledger/provenance gate or supersede the
  newer failed `latest`.
- `archive/ai-live-eval-20260829T201950744Z-2aeb8159-8ece-4015-a396-95e9bbf537fe.json`
  is an intermediate partial failure produced before the final ledger,
  termination, fingerprint, and nullable-score schema was in place. It remains
  historical data and is not valid under the current verifier.

These are internal provider evaluations, not customer outcome claims.

## Token accounting and termination

Each case records an aggregate input/output/total value and a `ledger` entry for
every completed provider step. The runner cross-checks the AI SDK's aggregate
usage against the sum of the step ledger. A successful step must have internally
consistent counts (`input + output = total`), positive input and total counts,
and the number of ledger rows must match the production loop's completed step
count. A stream error preserves any earlier completed-step rows but keeps usage
incomplete.

Incomplete or inconsistent values are never converted to zero. The known token
cost is calculated conservatively: each observed count contributes at least the
maximum of `total`, `input + output`, `input`, and `output`, and the case uses the
larger lower bound from its ledger or aggregate. `portfolio:verify` independently
recomputes that ledger, completeness, case total, run total, scores, thresholds,
canonical case prefix, and `terminationReason`; it does not trust the report's
summary booleans.

`terminationReason` distinguishes `completed`, `case_error`,
`initialization_error`, `token_usage_incomplete`, `token_reserve`, and
`case_limit`. An empty denominator is reported as `null`, not 100%. A report can
pass thresholds only after all 18 cases complete and individually pass, every
required score is available and meets its threshold (including 100% evidence
expectation and response-disposition accuracy), all token usage is complete,
and the known total is no greater than 160,000.

Every case also has an independent 90,000 ms deadline. The runner races the
production call against that deadline, aborts the call, and rechecks elapsed
time after resolution so a partially resolved stream cannot be recorded as a
completed case after timing out.

The 160,000-token value is a fail-closed acceptance ceiling, not a claim that
the generic OpenAI-compatible client can pre-authorize a billing limit. Usage
arrives after a provider step completes. The runner reserves 12,000 tokens before
starting another case and stops if usage becomes unknown, but a final case can
still cross the ceiling before the completed report rejects it. A strict
pre-consumption cap requires an approved provider-side budget or model-specific
tokenizer/preflight support.

## Provenance and persistence

Each invocation captures repository state and the eval-source fingerprint at
both the start and end. Clean, stable Git state may name an exact
`evaluatedCommit`; stable dirty state records only `baseHeadCommit` and a null
exact commit. A changing or unavailable Git state, source read failure, or
changed fingerprint is recorded as unavailable/unstable and rejected by
`portfolio:verify`. Filenames, patch text, prompts, user text, provider metadata,
and raw provider error text are not persisted as provenance.

Every initialization failure, partial run, threshold failure, and passing run
is first published under a timestamp-plus-run-ID archive name without replacing
an existing file of the same name. The persistence helper then takes a lock and
advances `ai-live-eval-latest.json` only when the candidate is newer by
`evaluatedAt` and then `runId`; an older concurrent run remains archived but
cannot overwrite a newer latest. The latest update uses a synced exclusive
temporary file and atomic rename. A lock timeout preserves the already-written
archive and fails instead of stealing a possibly live lock.

This is helper-enforced append-only/no-overwrite behavior, not operating-system
immutability. Archive files remain ordinary filesystem files and can still be
changed or deleted by an actor with filesystem permission. For the checked-in
latest, `portfolio:verify` requires the derived archive to exist and byte-match
it exactly.

Run `pnpm ai:eval:live` to create a new observation. It always persists the
actual result and exits non-zero for an initialization error, partial run,
incomplete usage, over-budget run, or failed threshold. Never edit a report to
make it pass.

`pnpm portfolio:verify` has a different contract: for a current-version report,
it verifies that the checked-in evidence is schema-valid and self-consistent
with the suite, source fingerprint, archive, score calculations, budget, and
release snapshot. It can therefore succeed while explicitly reporting `valid
report; live eval failed`. That success verifies evidence integrity; it does
not turn `thresholdsPassed` into true or make the live-eval command successful.
The checked-in v3 observation is expected to verify as a valid failed report;
that evidence-integrity result does not change its failed live-eval outcome.

For release-grade evidence, run from an isolated clean committed worktree. A
dirty-worktree report with a matching scoped fingerprint remains useful for
development diagnosis, but it must not be presented as proof that an exact Git
commit passed the live suite.

If module loading, Demo database setup, or model configuration fails before the
first case, the command still writes a v3 report with `results: []`,
`complete: false`, `terminationReason: "initialization_error"`, and a sanitized
run-level `runError` containing only its stage, stable code, and error class
name. It never invents failed case rows and still exits non-zero.
