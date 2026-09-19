# Reference to named PNG ZIP

`ai-ui-assets` is the independent **assets-only** entry. It uses the existing
decomposition plan, batch, provider exchange, matte, review, assembly and PNG
export implementations. It does not call the combined CLI or the component
delivery workflow. The package remains `ai-ui-decomposition`; a separate install
distribution is not introduced.

## Product boundary

Reference -> asset plan -> freeze/authorization -> obtain images -> deterministic
processing -> material/composite review -> named PNG ZIP.

The output is the original `ui-v0.4.1` style archive:

```text
scene.json
delivery.json
preview.png
layers/<node-id>.png
automated-visual-qa.json   # when the automated draft route was used
```

`scene.json` records the layer tree, positions, canvas and image hashes. Repeated
placements are named layers backed by the same planned source. The archive is not
a sprite atlas or a runnable component bundle. Ordinary raster text is removed
under the existing text policy; this is not pixel-perfect OCR reconstruction.
All planned layers must pass processing and package validation. Missing or failed
assets cannot be silently omitted to produce a successful archive.

For multiple similar materials per image call, use
[independent asset boards](assets-boards-v1.md). Output PNGs remain separate.

No UiDocument, appearance bindings, runtime state matrix, business linkage,
reference-state comparison, Node, PixiJS, browser, Studio or PSD extra is required.
An unknown runtime caret/focus state does not block this asset product, because
this route makes no claim about runtime state. Alpha, source identity, review and
archive integrity gates still apply. Original snapshots remain in the job; the
old PNG archive is not the self-contained reference handoff v2 format.

## Reviewed route / external image tool

For a new reference-aligned plan, prefer [compact visual brief](assets-brief-v1.md):
`brief-request` records the host request before model dispatch, then `prepare-brief`
compiles a reviewed visual inventory through official preflight and freeze without
media generation. The expanded-plan commands below remain supported for explicit
advanced planning and existing jobs.
Preparation also emits a non-blocking budget review with compatible-size board
candidates. After corrections, pass `--previous-budget` to compare call counts;
review candidates semantically before changing grouping. Explicit observed-repeat
mapping is documented in the compact brief contract; it never authorizes reuse
based only on equal dimensions.

Install the base package for development, without `[psd]`. Alternatively use
`python -m ai_ui_decomposition.assets_cli` with the installed package.

```text
ai-ui-assets init --reference reference.png --plan project/plan.json --id sample-r001 --document sample
ai-ui-assets check --plan project/plan.json
ai-ui-assets coverage-check --plan project/plan.json --coverage coverage.json --output coverage-check.json
ai-ui-assets planning-check --plan project/plan.json --coverage coverage.json --output planning-check.json
ai-ui-assets coverage-bind --plan project/plan.json --coverage coverage.json --output project/covered-plan.json
ai-ui-assets freeze --plan project/covered-plan.json --workspace workspace --run sample-r001
```

`init` writes a PNG ZIP starter plan, **not automatic semantic decomposition**.
Before check/freeze, author the complete asset/node/group plan using the existing
[plan contract](../references/contract.md). Check/freeze reject non-PNG plans.
New freezes and generation authorization also require a bound
[reviewed reference inventory](reference-coverage-v1.md). Independently inspect
the original reference, run `coverage-check`, then `coverage-bind` into a new
plan beside the original and freeze that covered plan. Init alone is not ready
for generation; missing ownership is not repaired by a complete file inventory.
Neither command generates images. Review the frozen plan and obtain fresh
single-use compute approval before each approved external request. Export/seal/
import use the unchanged [provider protocol](../references/provider-adapter.md).

For reference-aligned layouts, the consolidated `planning-check` also verifies
declared element source and placement coverage, retaining all issues in one
digest-bound report. Review that report, prompts and grouping together before
freeze; see its bounded geometry scope in the inventory contract. It does not
recognize missing artwork or infer a mapping for rearranged layouts. After
authorization, use the exported `execution-handoff.json` to dispatch the exact
entry without repeating planning. Live timing is still required to establish
whether this reduces total preparation time.

```text
ai-ui-assets adapter-export --run-dir workspace/runs/sample-r001 --asset scene --bundle outbox/scene
ai-ui-assets adapter-seal --bundle outbox/scene --source returned-scene.png
ai-ui-assets adapter-import --run-dir workspace/runs/sample-r001 --bundle outbox/scene
```

Execute each frozen request once with the approved image provider between export
and seal. Repeat for the other planned requests. If a request might have been
accepted but the outcome is unknown, use `indeterminate` and stop; never replay
it. Existing-source reuse uses `result-binding` and `reuse-result`, with the
unchanged source-digest verification. No generation occurs inside these commands.

```text
ai-ui-assets process --run-dir workspace/runs/sample-r001
ai-ui-assets review-template --run-dir workspace/runs/sample-r001
```

Inspect every material and the contact sheet. Obtain the user's acceptance of
that exact sheet before filling its existing review template. Do not approve on
the user's behalf. Then assemble, inspect the composite preview and export:

```text
ai-ui-assets finalize --run-dir workspace/runs/sample-r001 --output delivery/sample-r001
ai-ui-assets inspect --delivery delivery/sample-r001
ai-ui-assets export --delivery delivery/sample-r001
```

Draft finalization still requires the draft policy in the frozen plan; `--draft`
is not a bypass for a reviewed plan. Failed/old output directories are retained.

## Optional configured-provider draft

```text
ai-ui-assets auto-run --reference reference.png --job-dir job-r001 --provider-config provider.json --coverage coverage.json --max-generation-calls 8 --allow-provider-calls-and-unreviewed-draft
ai-ui-assets job-status --job-dir job-r001
```

This delegates the existing bounded headless route: two vision calls (planning
and mandatory post-generation assessment), plus at most the declared image calls.
Use only after explicit authorization; provider setup is not automatic. PNG ZIP
is fixed; there is no PSD or component-delivery option. Strict visual QA remains
the default; explicit `--visual-qa-policy advisory` retains the old warning-draft
semantics. Neither result establishes human visual acceptance. Failed or uncertain
jobs cannot be resubmitted, and successful repeated jobs verify existing output.
The historical `artifacts.ui_component_handoff` alias is retained in receipts for
compatibility; use `artifacts.png_zip`. It does not mean a v2 component bundle.

## Timing and compatibility

Use the existing [timeline](timeline-v1.md) from reference input to ZIP handoff.
`--timeline DIR --timing-category CATEGORY` precedes the subcommand; explicitly
bracket planning, approvals and external tool calls. Wrapping `auto-run` measures
that invocation as one span, not a fabricated per-image breakdown.

## Continuous tool-host generation, without the component DAG

After authoring and checking the asset plan, freeze a fresh batch with deferred
material QA if the user wants all images collected before quality reporting:

```text
ai-ui-assets freeze --plan project/plan.json --workspace workspace --run sample-r002 --material-preflight after-generation-v1
ai-ui-assets authorize-generation --run-dir workspace/runs/sample-r002 --plan-digest EXACT_FROZEN_PLAN_DIGEST --approval "Exact user approval of this frozen plan and call budget"
ai-ui-assets export-loop --run-dir workspace/runs/sample-r002 --output loop-r002/run.js --output-root VERIFIED_TOOL_IMAGE_DIRECTORY
```

`authorize-generation` records actual fresh user authorization; do not supply
approval on their behalf. It binds the plan digest, batch digest and exact call
budget. Export requires an authorized, unstarted PNG batch. It calls no provider.
Read the exported script in full and execute it unchanged using the host procedure
in [continuous generation](continuous-generation-loop-v1.md). The shared loop
uses `ai-ui-assets generation-status` and `exchange-generation`, not a component
workflow. It records invocation intent before every external call and verifies
the returned source, submission and receive receipts. The Windows tool host,
response persistence, PNG byte validation, timing and zero-retry rules are shared
with the existing component entry. One image call is active at a time.

An uncertain, interrupted or partially recorded request prevents further dispatch.
Do not rerun an interrupted script or reuse its approval. This initial loop
supports fresh generated requests, not cached-result batches or conditional
replacement policies; those fail explicitly and retain their existing commands.
It stops with `generation_complete`, next step `process`, without processing,
visual review, export or runtime acceptance. That status only proves receipt.

For a batch frozen with `after-generation-v1`, run:

```text
ai-ui-assets material-preflight --run-dir workspace/runs/sample-r002 --output material-preflight-r002.json
ai-ui-assets process --run-dir workspace/runs/sample-r002
ai-ui-assets review-template --run-dir workspace/runs/sample-r002
```

Then perform the reviewed finalize/export steps above. Preflight checks every
received image and writes original source-bound quality receipts; any failure
blocks processing. Invalid transport/image bytes and unknown outcomes still stop
the loop immediately. Deferred preflight does not turn a failed material into a
pass, invoke a retry, or authorize a draft. Specialized component-family boards
use `board-preflight` and `board-process` with their compiled extraction strategy
as described in [asset boards](assets-boards-v1.md). Plain material preflight
rejects the board marker rather than guessing a strategy. The original
per-image QA mode remains the default for backward compatibility; choose deferred
QA before freezing, never by editing a frozen batch.

Five offline regressions cover authorization, no resubmission, changed-source
rejection, complete-before-preflight quality reporting and execution of the exact
exported host script with a simulated image tool. They establish no live-provider
latency or visual fidelity.

Executed 2026-09-19: asset generation 5/5, existing generation loop 4/4,
assets CLI 4/4, deferred preflight 7/7 and loop entry catalog 2/2 passed
(22 Python cases, including the existing Node loop suite). Windows test execution
uses Python UTF-8 mode for Node output. No actual image-provider call was made.

The existing `ai-ui-decomposition` and `ai-ui-stateful` commands remain compatible.
Their component/Studio/reference gates are unchanged. Consumers can start a
separate component-building task from an asset ZIP; no automatic component plan
or state assets are invented by the asset entry.

The consumer now exposes `ai-ui-component assets-build assets.zip
target.ui-bundle.json appearance-binding.json --output built.ui-bundle.json`.
It consumes just the ZIP plus separately authored semantic and binding inputs;
the decomposition run directory is not required. See the consumer's
[independent ZIP entry](../../ui-component-harness/docs/decomposition-appearance.md).
No new archive inventory or component fields were added to the pure asset format.

Offline regression: `tests/test_assets_cli.py` runs real planning, processing and
ZIP export with a synthetic provider, forbids component/PSD imports and browser
subprocesses, and checks authorization, visual rejection and no-resubmit behavior.
It does not establish real-image fidelity or live-provider reliability.

Executed on 2026-09-19 with Python 3.14: assets entry 4/4, existing headless
48/48, public runtime 9/9 passed (61 total). The reviewed file-exchange fixture
also confirms that a pending review blocks finalization. No live generation,
consumer browser suite or Studio run was performed for this separation.

The cross-Harness test `test_assets_component_bridge.py` additionally passed:
an actual asset-entry fixture ZIP was copied in isolation, its upstream job was
removed, and the official consumer CLI built and revalidated two Button nodes.
Bound PNG bytes were identical; missing binding and overwrite attempts rejected.
This is synthetic offline build evidence, not actual artwork or interaction QA.
