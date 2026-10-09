# Visual warnings and the shared prompt contract

For delivery work that judges approximate reconstruction from the final image,
set `visualReviewMode` to `warning` in a **new host-run configuration**. The
program writes and binds `ui_visual_policy_v5` before preparing M1. An explicit
v5 file may also be supplied through `visualPolicy`; see
[the complete policy example](../examples/visual-policy-warning.json).

```json
{
  "planningMode": "fresh-host-m1-independent-review",
  "visualReviewMode": "warning"
}
```

These fields supplement the required host configuration, model destinations,
independent identities and finite budgets in [HOST-DELIVERY.md](HOST-DELIVERY.md).
They do not authorize model calls. Conflicting old visual-policy files and
unsupported observation profiles are rejected before a run is created.
Existing explicit v1–v4 policies and configurations without warning mode retain
their original severity. Old failed jobs cannot change policy or resume under
this runtime.

## What continues

Every well-formed model visual finding is a warning, including major and
uncertain style, contour, internal layout, missing/extra content, state and
ownership observations. M2 visual findings, declared visual unknowns and visual
pair relationships are retained in the frozen planning warnings. Material
findings keep their original category, magnitude, ownership, evidence and
suggestion. Complete measurable bodies retain their observed edges; uniform
aspect and residual thresholds are advisory and their exceeded values are
reported. No coordinate is changed to satisfy a threshold.

With body observation v3 and its explicit exterior-support policy, owned or
uncertain exterior classifications, unreviewed nonopaque dense exterior and
detached nonopaque dense components also become warnings. Original four-side
classifications and evidence remain unchanged, including faint antialiasing or
raster residue that is not a shadow. The body prompt distinguishes exterior
semantic concerns from inability to measure a complete corresponding body.
`visualCoverageWarnings`, exterior nonzero counts and maximum alpha appear in
body provenance; warnings are included in package review and the aggregate
report's `coverage` array and count. No pixel is removed to make a check pass.

High-opacity pixels (alpha >= 240) outside the observed anchor envelope are also
recorded as coverage warnings in v5. Their count, sides and unchanged envelope
are retained. This does not prove clipping, authorize a new body box or classify
those pixels as shadow. A reliable corresponding body with an observable solid
core remains required; complete PNG support is stored.

The workflow proceeds through all budgeted stages to a final composite. It does
not automatically repair, regenerate or replace the reviewer. The generated ZIP
contains the warnings in its review evidence. Host completion additionally
writes `visual-warning-report.json` with planning, material, body and fit
findings. `strictVisualReviewPassed=false` and
`finalCompositeVisualAcceptancePending=true` remain explicit even when execution
completes. Human visual acceptance is a separate event.

## What still stops

Transport failure, timeout or unknown acceptance; invalid schema/IDs or missing
review coverage; changed hashes, input sets, runtime, authorization or receipts;
unsafe paths; invalid/opaque foreground PNGs; invalid geometry or an observation
that cannot reliably establish complete-body correspondence; no solid core
inside the body;
storage/packaging failures. Observation v2 without the explicit exterior-support
policy retains its dense-alpha coverage constraint. These cannot yield a
truthful complete package by relabeling them as visual warnings. All nonzero
alpha is preserved. There is no slicing, single-axis stretch, invented body box,
fabricated receipt or promotion of a historical failed run.

Preplanned texture/reuse/background inputs still need complete validated
bindings. Warning mode does not fabricate a missing compiler input or evidence.

## Prompt rules own quality

New warning-policy prompts use one source,
`visual_prompt_contract.py` (`ui-visual-prompt-contract-v1`), across fresh M1,
planning review, single/sheet generation and material review. Body measurement
uses its matching correspondence guidance. The rules require:

1. A unique owner and explicit count for every object; a clean parent surface
   excludes its independently owned children.
2. Complete illustrations with visible structure, state, orientation and
   internal layout. A reference crop locates content; it is not a mask.
3. Surface highlights, shading, bevels and gradients classified as rendering
   attributes. Extra artwork needs evidence of a new identifiable object or
   independent content; ambiguity is recorded honestly.
4. One complete native PNG with the subject's reference proportions. Transparent
   margins are separate from body dimensions; programs own uniform placement.
5. Honest findings without suppressing observations or lowering magnitude to
   pass. Warning disposition does not loosen the generation target.

This is a source and policy change. Offline fixtures can verify continuation,
evidence propagation and technical stops; they cannot prove that a new model run
will produce visually correct images or that prompts eliminate all duplication.
