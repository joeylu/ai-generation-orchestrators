# Separate crop geometry from visible body registration

`reference-body-v1` is an explicit offline registration policy. It applies one
uniform scale and translation to a whole generated RGBA material. It does not
infer source-image segmentation, generate artwork, call a model, accept visual
quality, or promote an old failed job. Ordinary historical registration keeps
`legacy-region-fit`; existing frozen snapshots and receipts are not rewritten.

The reference screenshot is generally opaque. Its planning `bboxNorm` and
compiled `sourceRegion` describe a reviewed crop, potentially including empty
space, glow and shadow. They are not measured visible body bounds. Expanded
`cropRegion` supplies generation context; it already remains independent of
output dimensions. `reference-body-v1` uses the planning crop only as the final
layer canvas and ownership limit. It never fits the visible body to that crop.

The existing default whole-material fit remains an approximate legacy path.
This new policy is opt-in, not yet an automatic reference-body measurement
service. A future automatic measurement call needs its own frozen inputs,
budget and applicable authorization; none is silently added here.

## Offline callable route

```
python game-ui-harnesses/ui-layer-harness/ui_layer.py register-materials --config REGISTRATION.json --output NEW_OUTPUT
```

The config contains `snapshot`, `snapshotDigest`, `materials` (material IDs to
existing source PNG paths), `registrationPolicy: "reference-body-v1"`, and
`wholePlacements` (each supplied foreground material ID to an object containing
`path` and `sha256` for its explicit body contract). Backgrounds follow existing
opaque full-canvas processing. No foreground contract may be missing, unknown,
or associated with a background. `partPlacements` and `frameBoundsMaterials`
cannot coexist with the new policy. No model is called, including for materials
that the legacy path would localize or fit as an integrated frame.

Each body contract has exactly these fields:

| Field | Meaning |
| --- | --- |
| `kind` | `ui_whole_body_registration_v1` |
| `snapshotDigest`, `materialId` | Exact frozen planning snapshot and material |
| `sourceSha256`, `referenceSha256` | Exact generated source and original screenshot |
| `sourceBodyBox` | Observed body box in generated-source pixels |
| `targetBodyBox` | Observed corresponding body box in original-reference pixels |
| `evidence` | Object with local observation `path`, `sha256`, and nonempty `basis` explanation |
| `issues` | Empty array only when the observations have no unresolved issue |

The evidence file is a JSON object with exactly `kind: ui_body_observation_v1`,
`snapshotDigest`, `materialId`, `sourceSha256`, `referenceSha256`, `sourceBodyBox`,
`targetBodyBox`, `boundaryStatus`, and `issues`. The six scope/geometry values
must match the contract exactly; `boundaryStatus` must be `complete` and `issues`
must be empty. This is an explicit observer assertion, not machine proof of
reference silhouette or user acceptance. An unrelated note or hash is insufficient.

Boxes are integer `[left, top, right, bottom]` with half-open edges. They must
describe the same complete visible body, excluding transparent padding and
external soft shadows. Evidence must explain how those bounds were observed
and must be available unchanged for replay. Paths remain outside portable ZIPs.
Hashes prove binding, not visual correctness. The source body must cover all
alpha>=128 artwork, preventing an internal icon alone from becoming the scale
anchor for its backing. Dense external shadows or wholly translucent subjects
need another reviewed registration method rather than a guessed body box.
Manually observed evidence is
reported as explicit evidence, never as automatic localization or acceptance.

The transform preserves the entire material together, including faint nonzero
alpha beyond the body, internal holes and owned details. It does not crop the
source to `sourceBodyBox`. The body establishes scale and center; the full
nonzero-alpha extent establishes which existing pixels must survive. Output
RGBA retains the planning crop canvas, so current package geometry stays
compatible. A single inverse affine map samples both axes with the same scale;
there is no independent width/height raster rounding. A body size discrepancy over one target pixel is rejected
instead of repaired by nonuniform stretching. That pixel allowance accounts
only for integer coordinates; it is not a visual-quality tolerance.

Missing/changed evidence, unresolved observations, raw-alpha gate failures,
target-body ownership overflow, incompatible body proportions or any transformed
nonzero alpha falling outside the output canvas stop the route. A crop too small
for the preserved shadow needs a separately reviewed new plan; this route does
not expand frozen ownership. It never falls back to `contain` or `frame-bounds`.

Multi-part materials with independent anchors should continue through the
existing parts route, rather than inventing one whole-body correspondence.
Hidden or ambiguous reference bounds need review, not inferred coordinates.
Correct body scale does not restore an X that the generator drew too thick,
altered internal spacing, missing details or a wrong state.

## Review and replay

The output includes a snapshot-bound preview and per-material reports recording
both body boxes, crop canvas, full alpha support, nominal uniform scale,
inverse affine coefficients, actual offset, copied contract and final PNG SHA-256. The preview
remains `processed_pending_visual_review` with `humanVisualAcceptance: false`.
The existing `layer_package` module can build a complete preview; the existing
received-variant replay recognizes this mode and reapplies the exact body
contract rather than silently falling back to crop fitting. Missing observation
files or changed bytes block replay. Original media receipts and formal review
decisions remain required and unchanged.

This policy does not alter planning prompts, context-crop generation, sheet
grouping/extraction, Codex sessions, retry rules, opacity or visual quality gates.
