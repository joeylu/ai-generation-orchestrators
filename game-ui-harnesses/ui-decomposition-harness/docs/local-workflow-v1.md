# Local fixed workflow prototype v1

This opt-in prototype is a local Python program, not a service, scheduler or
general DAG platform. Existing `auto-run`, `handoff-job` and `delivery-run` are
unchanged. The workflow controls trusted adapters; model output never selects
Python modules, commands, budgets, authorization or transitions.

## Implemented graph

`vision -> compile -> freeze -> authorization -> generate -> process -> review -> deliver`

A rejected compilation expands exactly once into `repair -> compile_repaired`.
The second rejection is terminal. Invalid provider envelopes, transport failure,
timeout and indeterminate calls do not take the repair branch. A review decision
of `reject` or `unknown` blocks delivery. Human visual acceptance is always false.

The public bounded compiler `vision_draft.compile_draft` supports Panel, Text,
Image and Button input only. It converts global coordinates to parent-local
coordinates and supplies formal consumer style/Text fields and Button `label`.
It emits a semantic document, layout requirements, text observations and separate
unknown-state notes. It does not generate material descriptions, infer decorated
footer safe areas, construct state-image bindings, or compile all 16 types.
Those missing requirements must be supplied by a future compiler adapter or fail
preflight; the workflow does not infer them or weaken existing delivery gates.

## Current integration boundary

The engine and CLI are implemented, with a checked-in **offline test adapter**.
That adapter uses the real visual-draft compiler, `contract.validate`, capability
audit, `batch.freeze`, adapter export/seal/import, `process`, `finalize`,
`inspect_delivery` and the PNG exporter. It uses synthetic pictures and authored
fixture geometry; its terminal status is `fixture_complete`, never production
acceptance. Its ZIP is a PNG-layer fixture, **not** a v2 component-handoff package.

The opt-in `ai_ui_decomposition.repository_workflow:create` adapter now bridges
the existing provider API, four-type material/semantic compiler and the official
`handoff-job`/`delivery-run` entry. No real endpoint is configured automatically;
live provider and actual-artwork browser behavior have not been tested. Passing this fixture does not establish live
provider reliability, actual Studio acceptance, visual fidelity or a 20-minute
successful-delivery guarantee. Do not route user artwork through the test adapter.

### Repository adapter preflight

Trusted options are `componentRoot`, optional `response` (a supplied MCP response
for offline preflight) and optional `providerConfig` in the existing Provider config
format, plus `generationMode:"provider"|"file"` and `reviewMode:"provider"|"file"` (default provider). Set workflow
`fixture:false`. File mode uses the explicit generation bridge below without a
provider; initial vision/repair still require providerConfig unless the initial response
is supplied. File review is described below. Options and
adapter code are immutable per job: configure intended provider settings before
creating a later live job; do not patch job.json to add credentials or endpoints.

The response is `{draft,observations}`. `draft` is the four-type vision-draft-1
input. Observations has exactly `version:"delivery-observations-1"`,
`referenceSha256`, `geometryCorrections`, `panelFooters`, `materials`.
Corrections have `{componentId,rect,reason}`; footer rows have
`{componentId,innerBottom,minimumGap,evidence}` (Panel-local safe boundary);
material rows have `{componentId,description}` for every Panel, Button and Image.
Unknown source state remains in the original draft/evidence; static types have
no fabricated reference-state fields. Identity mapping only is supported;
EXIF rotation/flip is rejected rather than incorrectly labeled identity.

The compiler creates a background request, individual Panel requests and separate
Button/Image family boards using the existing relative-cell strategy. It does
not invent material identity or footer geometry; missing observations fail.
The generated boards are intermediates. After verified receipt, the adapter uses
the official extraction functions, creates an imported-material run for actual
individual layers, packs with the consumer CLI, then calls build_and_run. That
entry owns official import, stateful layout checks, Studio and reference acceptance.
The final model review receives the real runtime capture, not the empty-art preview.
Any technical/reference failure stops before final review/publication. No
automatic replacement or relaxed acceptance is added.

Current offline coverage verifies actual synthetic raw PNG -> board extraction ->
materialized run -> full v2 ZIP -> official import and non-browser state matrix,
including byte-identical original reference. This is not actual-artwork visual
acceptance. In particular system-font text observations may still require layout
correction once rendered; preflight is not proof of font metrics or Alpha geometry.

## Trusted adapter contract

An administrator supplies `{factory, options, fixture}` via a local config;
`factory` is a Python `module:function`, not user-uploaded/model-authored data.
The factory receives options and returns an object with `run(context)`.
Context contains node name, output directory, immutable job specification and
verified previous receipts. Job options/contexts are local operational records,
not publishable artifacts. Use environment variable names rather than credentials.
The engine binds the factory module hash; a changed adapter requires a new job.
This hash does not fingerprint the complete Python dependency environment: use
the repository's immutable release installation policy for production.

Return exactly `{status, data, artifacts}`. Status is `ok`, or `invalid` only for
compiler nodes. Artifacts map names to relative files below the node output.
The controller verifies files and records SHA-256 itself. All artifact names and
paths are checked; model output cannot become paths without compiler validation.

- `vision`/`repair`: preserve raw response. Repair receives original response and
  the compiler's error through dependency receipts; never a new open-ended task.
- `compile`/`compile_repaired`: bounded schema, references and geometry checks;
  known invalid model data returns `invalid`, unexpected exceptions fail closed.
- `freeze`: run the actual preflight/freeze. Return `data.planDigest` and
  `data.maximumCalls`; artifact `plan` must be JSON whose canonical digest matches.
  Bind semantic document, spacing, capability checks, batch and requests as artifacts.
- `generate`: only reachable after authorization tied to job, freeze receipt,
  plan digest and exact generation budget. The adapter must enforce that budget
  per request using existing batch reservation; the controller cannot count hidden
  network requests made by arbitrary trusted Python code. Persist provider task
  IDs in adapter-private state. Never silently resubmit an uncertain request.
- `process`: call existing deterministic processing. Do not treat partial output
  directories as success or overwrite them.
- `review`: return `data.decision` as `accept|reject|unknown` and
  `data.human_visual_acceptance:false`; bind real reference/render evidence.
- `deliver`: use official acceptance and packaging. Return authenticated files,
  `data.acceptance:passed` and `data.human_visual_acceptance:false`. Test adapters
  use `fixture_only`. The driver owns verification of its domain receipts; the
  engine's hash checks are not a second implementation of browser acceptance.

## Deadlines and recovery

Each node runs in a separate child process with a controller-enforced timeout;
even a callback ignoring its timeout cannot block the parent indefinitely. The
controller terminates its direct child on timeout. Adapters must not spawn
detached processes; this prototype does not implement cross-platform descendant
process-tree cancellation. Killing a local child never proves remote cancellation.

Started is recorded before invoking the adapter. Failure/timeout is terminal and
never automatically retried. A crash leaving started without a receipt is
`indeterminate`. Completed nodes are verified and reused on subsequent advances.
Provider IDs belong in adapter-private state for diagnosis/reconciliation; this
prototype does not implement provider polling/reconciliation after such a crash.
Use existing explicit verified-result recovery APIs, not automatic resubmission.

Only crash-interrupted pure compiler nodes can be explicitly recovered once into
a new output directory. The interrupted attempt is archived and charged against
the time budget. Freeze, processing and delivery can mutate batch-owned state and
are not blindly replayed. Failed or timed-out compiler attempts also remain terminal.
Waiting for user authorization is excluded from active execution time. Stage
durations across advances count toward the job budget; no fresh budget on resume.
Records are append-only hashes for integrity, not a security signature against
an actor who can rewrite the entire job directory. Keep job directories trusted.

## CLI

```text
ai-ui-decomposition workflow-init --reference reference.png --job new-job --adapter-config trusted.json --maximum-calls 8 --stage-timeout 120 --active-timeout 1200
ai-ui-decomposition workflow-advance --job new-job --allow-vision
ai-ui-decomposition workflow-status --job new-job
ai-ui-decomposition workflow-authorize --job new-job --plan-digest <reviewed-plan-digest>
ai-ui-decomposition workflow-advance --job new-job --allow-vision
ai-ui-decomposition workflow-recover-local --job new-job --node compile
```

Initialization/status consume no compute. `--allow-vision` explicitly permits
the current advance's planning/repair/review calls; it does not authorize images.
Only an actual user or deployment consent decision may invoke workflow-authorize.
Read statuses as well as exit codes: awaiting authorization is a pause, not success.
Failed, rejected, timed-out and indeterminate outcomes return CLI exit code 2.

Offline verification (set PYTHONPATH to the harness src and tests directories):
`python -m unittest discover -s tests -p test_workflow.py -v`.

## External generation file bridge

Set `generationMode:"file"` in immutable repository adapter options before init.
After actual plan-bound consent, `workflow-advance` exports the first request and
returns `awaiting_external` with its bundle path and requestDigest. No image or
model service is invoked by export. Each assignment is single-use. A subagent
may temporarily implement the external caller by reading the verified arguments
from `adapter.builtin_image_arguments`, forwarding them unchanged, and retaining
the actual provider result. Assignment/result hashes prove file identity, not an
independent attestation that the provider was called.

```text
ai-ui-decomposition workflow-receive-generation --job new-job --request-digest <assigned-digest> --source actual-result.png
ai-ui-decomposition workflow-export-generation --job new-job
```

The existing batch dispatch order is preserved. Only after the current result is
received can the next request be exported. Repeated export fails rather than
offering the same assignment again; status/advance while waiting never dispatches.
Only a PNG validated by the existing export/seal/import contract is admitted.
Wrong request digest, changed input bytes, duplicate receive and concurrent writes
fail. A crash during export/receive becomes indeterminate and is never replayed.
A leftover bridge.lock is retained after a writer crash; diagnose it, do not
delete it automatically or resubmit a possibly accepted request.

All requests share the generation node's frozen stage deadline and remaining job
budget. External wall time counts; authorization waiting does not. Late results
cannot continue a timed-out job. No cancellation of remote compute is implied.
The final receive seals all request/result files into the node receipt; subsequent
advance runs the existing deterministic processing/acceptance path. This bridge
does not replace technical/visual gates or promise a successful delivery within
20 minutes. Keep human acceptance false.

Offline bridge tests use synthetic PNGs and do not establish real-artwork quality:
`python -m unittest test_workflow_bridge -v`.

## External visual review file bridge

Freeze `reviewMode:"file"` at job initialization. Once the real process node
passes, `workflow-advance --allow-vision` exports one review request and returns
`awaiting_external`; it invokes no model. Alternatively use
`workflow-export-review --job new-job`. The request bundles exact original,
runtime screenshot and material contact sheet, their digests, plan/job/start
bindings, allowed asset IDs and the shared runtime-aware review instruction.
The caller submits these images and that instruction to its vision adapter.

Return the formal visual_qa JSON via
`workflow-receive-review --job new-job --request-digest <assigned-digest> --source assessment.json`.
The program applies the existing scoring thresholds and schema, writes the
reference-bound assessment receipt, then permits deliver only for acceptance.
A rejected assessment is terminal. A claimed passed boolean, unknown decision,
extra human-acceptance field or below-threshold accept is not accepted. Invalid
input creates no successful receipt; correcting transport data never authorizes
another model call. The assignment is never automatically dispatched again.

Both file bridges enforce single-writer locking and shared job budgets. Review
waiting counts toward its stage deadline; late responses fail. Interrupted
receipt writes become indeterminate. Changed input images, wrong request digests,
duplicate results and altered requests fail. File hashes establish identity,
not independent proof that a model inspected the images. Fixture screenshots
remain explicitly synthetic and can only reach fixture_complete. A real sample
must still pass official technical/Studio gates before this review can export.

Offline tests: `python -m unittest test_workflow_review_bridge -v`.

## File bridge 1.1 ingestion and invocation evidence

New jobs freeze `fileBridgeVersion:"1.1"`. Before its single external image call,
the caller writes the exact `adapter.builtin_image_arguments(bundle)` JSON to a
local file, then calls:

`workflow-record-submission --job new-job --request-digest <digest> --arguments actual-arguments.json`

Invoke the tool using that same object. The command checks exact prompt and
reference arguments, binds the assignment digest and records the current time.
It invokes no provider; repeated submission registration fails. Receipt in a 1.1
job requires this evidence. The received artifact binds its submission digest
and records receipt time. Status exposes assigned/invocation_recorded/received;
these are caller-side boundaries, not independently attested provider execution
or provider-only latency. Older jobs without the version field remain readable
under unchanged adapters and are not silently granted missing invocation evidence.

Both repository transports check board geometry before batch import, using the
same frozen strategy and validator as extraction. Relative-cell boards allow
proportional resolution changes within their existing aspect tolerance; legacy
pixel-cell boards retain exact canvas requirements. Rejected raw PNGs are retained
for diagnosis. A file-transport aspect rejection seals a failed node immediately,
so no subsequent request can dispatch. This early gate does not prove Alpha,
part identity or visual quality; the full extraction/acceptance gates remain.

Workers now emit `ui_workflow_node_error_v1` records. Only ContractError codes
matching `[A-Z][A-Z0-9_]{0,99}` cross the boundary. All other exceptions become
WORKFLOW_NODE_FAILED; paths, tokens and exception prose are not persisted there.
The controller propagates the safe code into the failed receipt and status.
Existing failed jobs are not replayed or rewritten to acquire new diagnostics.

## Consolidated source-run delivery (opt-in)

`consolidated-delivery --plan PLAN --workspace ROOT --component-root CONSUMER --output FRESH`
joins selected completed generation runs through the existing materialized handoff
builder and official acceptance runner. It performs no media or model calls.
The data-only envelope binds compiler input files and source batch/raw digests.
Only the explicitly designated pending generation target may omit an expected
raw digest; its completed result must still pass the batch receipt checks before
assembly. Reused sources require known raw digests. Board strategies remain bound
to source request prompts; parts are re-extracted by the official extractor.

This permits one complete user-reviewed execution plan spanning authenticated
reuse, remaining generation, official acceptance and one model review, without
requiring a new user approval per material. Authorization and external calls are
still explicit orchestration steps; this command does not authorize itself or
claim that model review ran. It neither resumes a failed historical DAG nor
relabels a probe as a full delivery. No complete delivery is accepted merely
because source selection or synthetic-fixture import passed.

Completed board sources may explicitly select a versioned
[extraction revision](foreground-gap-extraction-v1.md). The join verifies the
original receipt and prompt binding, reruns extraction, and records both lineages.
No new generation authorization is implied.

The four-type delivery compiler uses the official Button `labelLines` extension
even for one line: centered alignment and a centered text box of fontSize × 1.25.
This is an explicit runtime layout policy, not a measurement of source glyphs.
Text exclusions must not cover the entire skin and prevent actual background
pixel checks. Button bounds, text and authored font size remain unchanged.
