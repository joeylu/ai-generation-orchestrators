# Automatic declared layout step

New local warning runs using `bodyReviewPolicy=final-composite-first-v1` freeze
`layoutRegistrationPolicy=declared-layout-after-diagnostic-v1`. The host can now
apply the [declared layout candidate](DECLARED-LAYOUT-CANDIDATES.md) automatically
after material review and before final comparison/packaging. This adds **zero
model or generation calls**. Strict and exhaustive runs retain
`preserve-diagnostic-layout-v1`; missing policy fields retain historical behavior.

The planner may supply one `layoutContract` JSON file in the host configuration.
It must be prepared before image compute and refer to this plan's material IDs.
The runtime copies it into the run inputs, binds its hash and original reference,
then resolves each material's target from the reviewed frozen placements before
preparing the image job. It does not infer frame permissions or control
relationships from labels/IDs. This sidecar is an explicit planning input.

For a new fast warning run with
`planningMode=fresh-host-m1-independent-review`, preparation now defaults to
`layoutPlanningPolicy=fresh-m1-layout-contract-v1` when no sidecar is supplied.
An explicit `layoutRegistrationPolicy=preserve-diagnostic-layout-v1` retains the
legacy path. The new
M1 request requires `layoutRegistration` in its original JSON answer, using the
same contract schema below and this reference's hash. Every foreground material
must be declared. M2 receives that whole original plan and checks the layout
declarations alongside artwork coverage. After independent review, the host
resolves targets from the reviewed placements and freezes the declaration before
preparing image compute. The source plan, declaration hash and planning bindings
are verified again during delivery. The host never inserts a model answer,
copies IDs from a previous run or reconstructs declarations from labels.

`layoutRegistration` is optional in the public storage schema for compatibility;
only the new layout-enabled M1 request makes it required. Existing M1 exchange bytes,
archived schemas and sidecar runs retain their original lineage. A fresh M1
layout policy and a preplanned sidecar cannot be combined.

New image jobs also copy this frozen contract to `generation-layout.json` and
bind its hash in `job.json.layoutGeneration`. The tool prompt receives each
declared material's exact divider count and original Y positions, plus Y
fractions within the owned region before transparent padding. Section-band
boundaries and the outer border do not count as dividers. This uses no extra
model call. Historical image jobs without that binding retain their original
prompt bytes. Changed references, placements or frozen declarations stop
authorization or dispatch.

New initial image jobs additionally bind
`layoutGeneration.promptPolicy=reference-owned-structure-v2`. Declared panels
are reconstructed from their original reference pixels with their owned border,
section bands, narrow surrounding strips and intervening surface gaps. The
owned target proportions take precedence over neighboring UI visible in a
context crop. Sheet cell assignments, ownership deletion rules and reference
inputs stay frozen; this adds no calls or generated-image feedback. Earlier
layout bindings without this field replay their previous prompt bytes. The
explicit cleanup v3/v4 paths retain their own versions and inputs.

For a separately authorized repair of a missing panel divider, the public
`prepare-material-cleanup` command can explicitly select
`--cleanup-input-policy reference-only-owned-extraction-v1` with the frozen
`--layout-contract`. This reconstructs the owned panel using original crop/full
reference images only, while keeping the old generated source as sealed
provenance. It uses the same one-call exchange, independent material review and
one-material replacement checks. The host never invokes this repair or retries
generation automatically. See [material cleanup](MATERIAL-CLEANUP.md).

Example host configuration additions:

```json
{
  "generationMode": "sheets",
  "visualReviewMode": "warning",
  "bodyReviewPolicy": "final-composite-first-v1",
  "layoutRegistrationPolicy": "declared-layout-after-diagnostic-v1",
  "layoutContract": "layout-contract.json"
}
```

Example sidecar (replace the hash placeholder):

```json
{
  "kind": "ui_host_layout_contract_v1",
  "referenceSha256": "<original reference SHA-256>",
  "materials": [
    {
      "materialId": "inner-panel",
      "mode": "frame",
      "measurementAlphaThreshold": 128,
      "horizontalDividerTargets": [552, 647, 744],
      "horizontalBandTargets": [[392, 457], [769, 833]]
    },
    {
      "materialId": "slider-fill",
      "mode": "frame",
      "measurementAlphaThreshold": 128
    },
    {
      "materialId": "slider-knob",
      "mode": "uniform",
      "measurementAlphaThreshold": 128
    }
  ],
  "constraints": [
    {
      "id": "fill-knob-junction",
      "a": {"materialId": "slider-fill", "edge": "right"},
      "b": {"materialId": "slider-knob", "edge": "centerX"},
      "expectedDelta": 0,
      "tolerancePixels": 1
    }
  ],
  "knownDifferences": ["Text and digits remain blank; style awaits visual review."]
}
```

Declare `frame` for the intended panels/strips/control frames and `uniform` for
icons and circular knobs. Unselected layers remain unchanged. Target boxes come
from the reviewed placements, so contradictory hand-entered target boxes are
not a second source of truth.

`horizontalBandTargets` declares ordered half-open `[top,bottom)` ranges for
clearly visible full-width darker section bands, in original-reference pixels.
It is distinct from thin dividers. Both band edges enter the generation prompt
and deterministic internal remapping, so light strips between the tabs, bands
and rows retain their planned extent. The source detector must find exactly the
declared number of paired section steps; it never draws a missing band or fills
a missing strip. Ambiguous/missing bands stay warnings and delivery continues.
Small neighborhoods around each edge retain their scale during remapping;
corner protection shrinks when necessary to avoid colliding with an internal
anchor. The delivered layer pixels are measured again in `internalBandChecks`.
`internalStructureChecksPassed` combines band and divider checks; it remains a
geometric heuristic, not whole-image visual acceptance. Its measurement scope
is explicitly limited to declared bands and dividers; undeclared geometry is
not accepted by an empty or passing check list.

New host runs default to `contextPromptVersion=v9`. This preserves the v8 owner
catalog and adds explicit treatment of narrow neighboring strips and separately
owned knobs/handles at contact edges. Frozen v8 prompts replay unchanged. Fresh
M1/M2 planning prefers one complete static control unless separate movement or
control was requested; it does not rewrite an already supplied plan.

New local warning runs also bind
`materialRepairPolicy=record-owned-material-repair-plan-v1`. Confirmed foreign
objects, missing owned objects and uncertain ownership declarations produce
`material-repair-plan.json`, naming the affected material, object, true owner,
source fingerprint and required action. Uncertainty never becomes a removal
instruction. Conflicting observations retain their evidence and request an
uncertain-ownership repair instead of blocking delivery or authorizing removal.
The plan preserves all other materials and is exposed in the host delivery
report and status. It does not modify artwork, submit jobs, retry generation or
turn a warning into visual acceptance. Executing a new image repair still needs
its own immutable plan and fresh compute authorization. Old configurations
without this field do not acquire a repair plan retroactively.

Optional `horizontalDividerTargets` are ordered original-reference Y positions
inside a frame. A deterministic detector measures sufficiently opaque,
full-width dark line bands in the actual received source. It requires a narrow
dark trough with similar, lighter surfaces on both sides, excluding outer
edges, wide bands and outlined section-band transitions. Only an exact count match maps the detected rows, in order,
to the declared reference rows, retaining narrow line bands. It is a conservative
geometric heuristic, not semantic recognition. An uncertain count keeps the
outer frame correction and records `LAYOUT_DIVIDER_CORRESPONDENCE_UNRESOLVED`;
internal rows remain unaccepted. Do not use this detector for arbitrary artwork.
The selected package's stored layer pixels are measured again in original
coordinates. `internalDividerChecks` and `internalDividerChecksPassed` report
count and position residuals separately from external edge constraints. A
failed internal check remains a warning; an external constraint pass does not
imply that internal lines are complete. Missing artwork is never synthesized
by registration.

Missing declarations record `LAYOUT_CONTRACT_NOT_DECLARED` and retain the base
diagnostic. Allowed unresolved rendering geometry retains that same verified
base with an explicit warning. Constraint residuals remain warnings in the new
candidate. Invalid schemas/IDs, changed references, planning/source bytes,
unbound native lineage, unsafe paths and package failures remain blocking.
There are no automatic model retries or extra body calls.

The host preserves `diagnostic-output/` and writes the corrected candidate to
`layout-output/`. `host-status.diagnosticDelivery` and the final comparison point
to the **selected** delivery. The root visual warning report includes
`layoutRegistration`, its selected path, hashes and remaining warnings. Frozen
layout contracts, generated selections, native-source maps and output evidence
are covered by the host checkpoint. Repeated `host-resume` on a terminal run
does not reapply the step. Historical frozen runs are not migrated.

All outputs remain diagnostic and pending human visual acceptance. Completing
this deterministic step does not assert semantic body correspondence, full
automatic DAG success, independently verified separation or pixel-perfect style.
