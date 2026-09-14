# One reviewed envelope, finite conditional replacements

This producer-only execution policy freezes every initial request and every
optional replacement prompt before compute authorization. It does not add fields
to the consumer handoff. A replacement is a distinct single-use request, never a
resubmission of an uncertain provider job. Cosmetic differences do not trigger it.

The policy has kind ai_ui_bounded_execution_v1, exact candidate plan_digest,
initial_assets, a replacements mapping (initial asset to one replacement asset),
maximum_calls, maximum_replacements and stop_on_indeterminate:true. All generated
assets without `cached_result` must appear exactly once in that mapping or initial
list. Explicit cached results stay digest-bound in the same plan, require verified
reuse receipts, cannot be reserved for generation, and consume zero compute budget.
Replacement scope
keeps role, route, output mode, crop and target size; only its pre-reviewed prompt
changes. Existing plans without the policy retain their previous semantics.

Freeze with --execution-policy and --capabilities. Candidate plans may contain
overlapping standby layers; they are request inventories, never final deliveries.
maximum_calls in the batch is the enforced budget, not a requirement to execute
all candidates. Policy bytes and SHA-256 are verified on every load.

After explicit user approval of the plan, policy and budgets, execution-authorize
records the decision and all exact request hashes. Each reserve consumes a distinct
single-use authorization within that envelope. A local exclusive reservation lock
guards admission and budget checks; locks are never automatically expired. The
executor never calls any provider, grants its own approval or invents a new prompt.

Reservations fail when unauthorised, over budget, another result is pending, any
outcome is indeterminate, an approved replacement has failed, or an initial result
needs a replacement that was not pre-approved. Unknown outcomes remain a global
stop even if a known result is later recovered; require a new explicit decision.

A replacement requires a known rejected result or an execution-issue record bound
to the returned raw SHA-256. execution-issue records a caller observation with one
of the supported functional blocker categories. It is not automatic semantic
detection. Texture/color/font-style differences are not valid triggers. Changing
the evidence or raw result invalidates it. Each asset gets at most one replacement.

execution-select chooses authenticated successful results into a normal zero-call
cached_result plan. Unresolved issues, rejected/unknown/pending results block
selection. Freeze that ordinary plan and use reuse-result for each selected source,
then process, material audit, reference packaging, official import, real input,
screenshots and final delivery checks. Additional deterministic layout/code fixes
do not spend media budget. New media outside the frozen requests requires approval.

Selection is not runtime/visual acceptance. All automated records preserve
human_visual_acceptance:false. Original artwork, unknown observations and historical
artifacts remain separate. A functional draft may tolerate cosmetic differences;
it may not silently omit failed components or relabel broken structure as success.

Commands: execution-authorize --run-dir RUN --approval TEXT;
execution-issue --run-dir RUN --asset ID --category CODE --evidence TEXT;
execution-select --run-dir RUN --source-plan PLAN --output FRESH.

Explicit parallel dispatch may be authorized separately with
`bounded_execution.authorize_parallel(run, maximum_pending, approval)`. The
append-only authorization binds the existing batch and compute authorization;
it changes neither frozen prompts nor total call/replacement budgets. Limits are
1–4 pending requests. Without it, admission remains serial. Admission is still
locked, counts every reserved request against the total, rejects tampered records
and stops new dispatch after unknown outcomes. Already submitted requests may
finish and retain their individual result receipts; they must not be resubmitted.
