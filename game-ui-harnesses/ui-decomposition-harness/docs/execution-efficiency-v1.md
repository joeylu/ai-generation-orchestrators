# Bounded delivery work and focused verification

This is a producer workflow rule and local acceptance capability, not a hosted
service, a latency SLA, an automatic repair service or an evidence cache.

The unified [layout-gated delivery commands](layout-delivery-run-v1.md) now bind
processed materials or an existing v2 package to full stateful, Studio and official
reference checks under one local budget. Missing layout observations, unsafe popup
surfaces and substituted acceptance report kinds stop publication. See that contract
for plan schemas, intermediate diagnostic ZIPs and remaining timing limitations.

## Normal sample execution

1. Before compute, finish capability, layout, source reuse and material-strategy
   preflight. Freeze prompts, geometry, extraction policy and replacement budget.
   Do not discover unsupported required contracts after spending generation calls.
2. Dispatch independent boards concurrently only within the existing explicitly
   authorized pending-request limit. Agents do not increase provider capacity.
   Prefer fixed solid-key generation and deterministic matte. An uncertain request
   stops new dispatch; it is never retried for speed.
3. Validate each received board immediately: key/alpha, cell coverage, dimensions,
   state distinction and registered geometry. Reprocess the verified raw source
   with explicit recipes in a fresh directory; retain original failures. Do not
   regenerate successful boards to repair another board.
4. Assemble once materials pass. Inspect the initial runtime composition for text,
   frame ownership, overlap, clipping and decorated tracks before the expensive
   full interaction/Studio roundtrip. A screenshot alone is not a passed gate.
5. During repair, use targeted acceptance for affected controls, including all
   connected controls (for example List + ScrollView + Tabs and bound labels).
   This selection is explicit; dependency discovery is not implemented. Full
   import and deterministic validation still run, so omitted controls cannot hide
   a malformed package. Do not change reference acceptance-scope to narrow a test.
6. Once stable, run full sample acceptance, actual Studio save/reopen/export/import
   and final delivery-check. Do not repeat passing stages unless inputs, code,
   contracts, evidence or a newly discovered defect invalidate them. There is no
   automatic cache that can establish acceptance from old receipts. Every final
   artifact remains bound to its actual input digests and fresh output directory.

Cosmetic warnings under an authorized functional-draft policy do not trigger
unbounded repairs. Required geometry, alpha, references, state behavior and other
functional gates cannot be weakened for speed. Unknown observations stay unknown;
human_visual_acceptance remains false.

## Development work is separate

A normal sample executes versioned tools; it does not edit their implementation
or run the repository-wide development suite. An unsupported contract or tool bug
is a blocked delivery with preserved artifacts and diagnostics, not an unlimited
automatic development loop. When code repair is explicitly in scope, reproduce
the failure with local fixtures, run the affected tests while editing, then run
the required broader suite once after the patch stabilizes. Repeat broader tests
only for a subsequent change/failure/unresolved concern. Do not label development
time as provider generation time or claim that engineering work met a service SLA.

Browser linkage checkpoint assertions return document state only. Repeated quantity
steps assert the emitted numeric value, exactly one change event and the actual
rendered number after every real click. Exported quantity state is still checked
at initial/boundary checkpoints and persistence. Keep unchanged image base64 inside
the browser and avoid recompiling/exporting the entire artwork bundle per step;
full bundle/pixel/roundtrip checks remain separate. This retains every quantity
step and adds visible text checks without weakening state or event boundaries.

## Implemented local acceptance controls

`ai-ui-stateful` keeps full acceptance as its default. Add repeatable
`--component ID` arguments for a targeted diagnostic run. Even requesting every
ID through this option remains targeted: acceptance.json and browser.json report
targeted_passed, record requested/available/tested IDs, and publish no accepted
ZIP. `--qa-only` remains deterministic-only and cannot establish browser acceptance.
The complete matrix is validated before any subset is selected.

`--timeout-seconds N` defaults to 600 (valid integer range 1..86400). This is a
local acceptance budget, not a whole-job generation budget or promised completion
time. CLI/browser subprocesses receive the remaining budget, deterministic phases
check it at boundaries. CPU work is not preempted mid-operation. Expiration writes
STATE_ACCEPTANCE_TIMEOUT, records the failed phase and publishes no accepted ZIP;
there is no automatic retry, threshold relaxation or provider call. An operator
can explicitly choose a larger budget for a large state matrix before a fresh run.

acceptance.json now includes execution kind ui_acceptance_execution_v1, monotonic
elapsedSeconds, timeoutSeconds, automaticRetries:0 and per-stage timings/status.
Stages cover evidence, official import, deterministic matrix, browser, optional
visual observations and delivery copy. Early failure preserves completed timings.
These fields are producer receipts; no consumer contract is changed. Existing
receipts remain immutable and are not retroactively assigned measured durations.

Example (paths are caller-owned placeholders):

```sh
ai-ui-stateful --handoff candidate.zip --evidence evidence.json --component-root consumer --output diagnostic-new --component skill-list --component skill-scroll --timeout-seconds 180
ai-ui-stateful --handoff candidate.zip --evidence evidence.json --component-root consumer --output acceptance-new --timeout-seconds 600
```

Remaining work before a service latency claim: whole-job stage instrumentation,
representative sample benchmarks, provider queue measurements, dependency-aware
incremental scheduling and end-to-end resource cleanup under forced termination.
None is established by targeted acceptance or by a single successful sample.

Linkage screenshots capture the measured full canvas rectangle directly, with a
bounded 30-second capture timeout and a before/after geometry check. This avoids
element screenshot auto-scrolling after keyboard focus; it does not crop away
failing regions, skip pixel assertions or retry a failed capture automatically.
