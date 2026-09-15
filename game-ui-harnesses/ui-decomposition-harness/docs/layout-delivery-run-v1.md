# Layout-gated local delivery

This producer workflow uses existing consumer appearance/reference contracts.
It adds no consumer rendering fields and makes no generation or latency promise.
The semantic plan is authored data; programs compile fingerprints and receipts.

## Required planning decisions

Before compute, include every actual component/profile in capability-check and
freeze its plan-bound request. A bilingual Button needing different line sizes,
alignment or spacing must request `per-line-text-layout` and use the consumer's
[Button labelLines 1.0](../../ui-component-harness/docs/button-label-lines-v1.md).
A translucent Select requiring readability over underlying UI must request
`translucent-popup-readability` (currently blocked). Do not replace either with
`base` to pass. Capability checks cannot discover omitted visual requirements.

For the full delivery path, `ui_state_evidence_v1` additionally references
`layoutRequirements` and `visualObservations`, each `{path,sha256}` relative to
the evidence directory. Original reference states remain separate; these planning
decisions never turn unknown observations into known reference values.

`layoutRequirements` has exactly this producer schema:

```json
{
  "kind": "ui_layout_requirements_v1",
  "panels": [{"componentId":"panel", "appearance":"required", "reason":"Observed decorated frame"}],
  "selects": [{"componentId":"region", "surface":"opaque", "reason":"Popup must mask underlying text"}],
  "buttons": [{"componentId":"submit", "textProfile":"single-style", "reason":"One confirmed label style"}],
  "textBackgrounds": [{"componentId":"title", "drawBackground":false, "reason":"Parent owns the background"}]
}
```

Each array covers every matching component in the semantic tree, without duplicate
or nonexistent IDs. Empty means that type is absent. Panel appearance choices are
`required|plain`; Select surfaces `opaque|translucent`; Button profiles
`single-style|per-line`. Translucent requirements currently fail explicitly;
per-line requires valid labelLines and observations covering each rendered line.
Text background ownership must match the semantic boolean. No default decision is
inferred from IDs. Every text-bearing owner needs a visual observation under the
existing `ui_visual_observations_v1` contract, including noninteractive labels.

After official import, the checker maps Select popupContentLayout to verified PNG
pixels and checks the entire safe rectangle, including enclosed holes: opaque
surfaces require Alpha >=250 throughout. It does not require the full PNG to be
opaque; transparent borders outside the safe content area remain valid. Declared
row height must also fit the font. This is a conservative opaque-content adapter,
not a generic test for arbitrary translucent UI or texture similarity.

Real mouse/keyboard acceptance checks each opened menu's actual Pixi text string,
font size and world bounds against the registered safe row, plus icon containment,
events and popup lifecycle. Initial text observations use the actual default
inspection and screenshot; both are bound to source/bundle hashes.

When visual observations are supplied, a separate default-only browser capture
now runs before the full state matrix input driver. Its report is
`ui_default_preview_v1/captured`, never state acceptance. A rejected text/layout
observation stops there, preserving preflight screenshots and checks; it does not
spend the remaining budget on full inputs. Full acceptance retains its separate
capture and checks after preflight passes.

## Unified entry points

`ai-ui-decomposition delivery-run --plan run.json --component-root consumer
--output new-run --timeout-seconds 1200` consumes an existing v2 ZIP:

```json
{
  "kind":"ui_delivery_run_plan_v1",
  "source":{"path":"source.zip","sha256":"<SHA-256>"},
  "stateEvidence":{"path":"evidence.json","sha256":"<SHA-256>"}
}
```

`ai-ui-decomposition handoff-job --plan build.json --component-root consumer
--output new-job --timeout-seconds 1200` first compiles verified processed materials.
Its exact `ui_handoff_build_plan_v1` fields are:

| Field | Value |
| --- | --- |
| kind | ui_handoff_build_plan_v1 |
| run | `{path,batchSha256,materialsSha256}`; hashes of batch.json and materials/materials.json |
| componentBundle | `{path,sha256}` of the authored semantic bundle |
| appearance | `{registration,bindings}` using consumer 0.2 fields; no authored receipt hashes |
| referenceOriginal, referenceState, acceptanceScope, referenceMapping | Separate `{path,sha256}` references to existing v2 inputs |
| layoutSpacing, layoutRequirements, visualObservations | Separate `{path,sha256}` references to producer plans |
| stateEvidence | `{kind:"ui_state_evidence_v1",components:{...}}`; existing per-component evidence specification |

All paths resolve below the plan directory. Existing finalizer and PNG exporter
verify the frozen run/materials and author scene/delivery records. Official consumer
code computes the semantic digest; the compiler fills binding/source hashes,
exports v2, imports through the official CLI, runs layout checks, and constructs
the delivery-run plan. It does not call providers, repair art, invent manifests or
write reviewed evidence. A processed run can originate in a separately authorized
generation job. Source references and geometry remain authored/verified inputs;
this is not automatic semantic recognition.

Both paths require new output directories. Build once, full stateful acceptance,
actual Studio save/reopen/export/import, official reference comparison, then root
publication. `appearance-revision` also exposes the existing deterministic v2
revision utility for separately authorized layout changes; it is not an automatic
repair stage or part of the 1200-second timing measurement.

`appearance-revision --derived-states additions.json` can append explicitly
authorized derived descriptions using
`{kind:"ui-derived-state-additions-v1",states:[{componentId,basis:"contract-derived",description}]}`.
The program validates IDs/schema, updates scope/hash, preserves existing scope
modes/descriptions and original reference state/image/mapping, and records the
additions digest. This option cannot replace reference observations or exclude a
new region. Without it, scope bytes remain unchanged as before.

## Results and compatibility

The common receipt records actual monotonic stage durations, zero media calls,
zero automatic repairs/retries, input fingerprints and separate acceptance kinds.
A targeted/legacy/reference-replay receipt cannot stand in for full stateful
acceptance. Zero compared pixels cannot establish successful reference comparison.
Unknown reference state preserves `blocked_reference`. Visual failure preserves
`failed_visual_qa`; either keeps a diagnostic candidate and does not publish a root
ZIP. Intermediate tool ZIPs remain diagnostic stage artifacts, not final approval.
Only complete machine checks publish the root draft, always with
`human_visual_acceptance:false` and human review still required.

Legacy `ai-ui-stateful` behavior remains available, but missing visual observations
is `not_run` and layout/text coverage is `not_verified_legacy_runtime_only`.
Use `--require-visual-layout` for strict standalone runs. Empty composition-check
lists report `not_checked`, never a passed observation. For older delivery-check
region plans, `requireWorldBounds:true` rejects parent-local rectangles before
pixel comparison. Unified runtime-regions instead derives actual renderer bounds;
these are diagnostics, not an inferred replacement for reference scope/mapping.

## Timing boundary

1200 seconds is a cooperative local budget shared by build and acceptance. Each
subprocess receives remaining time; no retry is submitted. CPU operations check
at phase boundaries, not mid-operation. Descendant process cleanup under forced
termination is not established as an OS/service guarantee. Planning, generation,
provider queueing and contract development are outside this measured boundary.

The offline benchmark uses a procedural Select and explicitly unknown reference
state. It exercises real CLI, Pixi mouse/keyboard and Studio; it is not an art
sample, 16-component coverage, or proof of a 20-minute reference-to-delivery SLA.
Before making that promise, measure representative samples and provider latency,
define supported profiles/asset budgets and distinguish successful drafts from
bounded blocked results. Do not weaken alpha, geometry or evidence to meet time.
