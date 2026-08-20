# AI evaluation reports

`ai-live-eval-latest.json` is the latest honest live-provider run and must use
the schema version declared by the live case suite.

Files under `archive/` are immutable historical evidence. The
`ai-live-eval-2026-08-14-scorer-v1-flawed.json` report is retained because its
v1 scorer compared `expectedEvidenceAllowed` only for safety-critical cases.
It therefore hid six evidence-expectation mismatches, allowed five of them to
pass, and must not be cited as a valid 18/18 result. The raw observations remain
useful, but its `pass`, safety summary, and threshold fields are not trustworthy.

The first honest v2 run is also retained as
`archive/ai-live-eval-2026-08-20-v2-first-run-failed.json`. It completed all
18 cases and correctly failed its thresholds: one country-profile case made
a duplicate call after omitting the explicit `asOf`, and one unknown product
case made no required tool call. Those observations drove code fixes; the
case expectations were not reversed.

The second v2 run is retained as
`archive/ai-live-eval-2026-08-20-v2-second-run-source-query-failed.json`.
It fixed tool selection and arguments to 100%, but the source-document case
still failed its evidence expectation. The archived report preserves that
observation without speculating beyond the fields recorded in the report.

The third complete v2 run is retained as
`archive/ai-live-eval-2026-08-20-v2-third-run-tokenization-failed.json`.
It completed all 18 cases in 36 provider steps and 100,363 tokens. Tool
selection, arguments, and safety fail-closed scored 100%, but source-fixture
retrieval/tokenization still failed the expected-allow source case. Its
evidence-expectation accuracy was therefore 94.44% and
`thresholdsPassed=false`.

A later provider invocation failed at the network boundary with zero model
steps. With no evaluated case-level observations, it is not a valid live-eval
report, was not promoted to `latest`, and contributes no score.

The current latest v2 report, evaluated at `2026-08-19T17:18:08.954Z`,
completed and passed all 18 cases in 36 provider steps and 101,604 tokens.
Tool selection, arguments, evidence-expectation accuracy, and safety
fail-closed all scored 100%, so `thresholdsPassed=true`. The case expectations
were not reversed, and this internal provider evaluation is not a customer
outcome claim.

Never edit a live result to make it pass. Run `pnpm ai:eval:live`; the command
must persist the actual v2 report and return a non-zero exit code when any
required threshold fails. `thresholdsPassed` also requires the final observed
token total to remain at or below `budget.maxTokens`; the pre-case reserve is
only an early-stop guard.

If module loading, Demo database setup, or model configuration fails before the
first case, the command still writes a v2 report with `results: []`,
`complete: false`, and a sanitized run-level `runError` containing only its
stage, stable code, and error class name. It never invents failed case rows and
still exits non-zero.
