# Separate crop geometry from visible body registration

## New-run automatic route

New delivery `run` defaults to `reference-body-auto-v1`; new local-reference
planning defaults to frozen v7 prompts. Generation remains an explicit serial
host exchange. Body observations are a separate post-generation compute scope:
the actual original, generated PNGs, full-reference and material-crop attachments,
prompts, schema, mappings, model and per-material budget are frozen before calls.
The configured body cap defaults to 12 (explicit `--max-body-calls N`, 1..128).
Each foreground requires at most one observation, with no background call.
The foreground count is checked before preparing the image job, so insufficient
budget cannot spend image compute first.

After extraction/adaptation and existing material reviews, `body_prepare` creates
this immutable observation job. Status exposes `awaiting_body_authorization` and
`bodyObservation.jobDigest`. The host must obtain applicable explicit authorization
for these exact inputs, CLI destination, maximum calls and stopping conditions;
an image-generation approval does not authorize this later job. Record it using:

```
python game-ui-harnesses/ui-layer-harness/ui_layer.py authorize-body --output RUN --job-digest DIGEST --approval TEXT
python game-ui-harnesses/ui-layer-harness/ui_layer.py resume --output RUN
```

The first observation opens a new persistent Codex CLI session; subsequent
foreground observations resume it and verify the same session ID. Existing tool
isolation remains enabled. Each attempt is reserved before invocation. Invalid,
uncertain, not-whole or changed evidence and technical body/alpha failures stop
before the next call. Interrupted or failed jobs cannot be resubmitted. Observed
boxes are mapped back to original source coordinates and frozen as typed body
contracts; they are observer assertions, not proof of visual fidelity.

Successful observations feed `reference-body-support-v1` registration with zero
additional localization calls. The original material region retains ownership:
the target body must remain inside it, and the generated body must include all
alpha>=128 artwork. One uniform transform preserves internal details and holes.
The independent PNG storage canvas is the union of this ownership region, the
transformed full nonzero-alpha bounds and actual interpolation support. Thus a
faint edge or remote alpha island does not enlarge the body or get discarded.
This canvas may extend within the frozen original screenshot only; theoretical
or actual support beyond the reference canvas still blocks. No threshold cleanup,
automatic crop revision, stretching or fallback is introduced. Resampling can
quantize very small alpha to zero; no alpha threshold deliberately removes it.

The preview reports both ownership and derived canvas. Packaging obtains PNG
dimensions/coordinates from fingerprinted, scoped registration and preview
reports, validates the source support and output support, and recomposes the exact
PNG pixels. Variant replay applies the same policy and derived geometry. Output
is still `delivered_pending_visual_review`, with `humanVisualAcceptance: false`.
Wholly translucent, ambiguous/occluded or independently anchored multipart
subjects can block this route; they are not silently sent to legacy fitting.

Only new runs select this default. `--registration-policy legacy-region-fit`
explicitly requests the historical route; missing historical policy fields retain
it. Existing jobs, authorizations and failed states are never converted. The
offline `reference-body-v1` route below retains its fixed-canvas behavior.

## Historical offline policy

For new snapshots explicitly selecting `ui_visual_policy_v3` with
`minorGeometry: record`, minor shape differences are retained as material-review
warnings. Whole-body placement uses a centered uniform contain transform and
records fitted-size residuals instead of requiring both dimensions to match
within one pixel. A symmetric aspect mismatch above 25% with residual above one
pixel still rejects grossly incompatible anchors; major/uncertain visual findings
remain blocking even below that coarse guard. All nonzero-alpha support, whole
dense artwork, holes, source identity and evidence checks remain required.
The same frozen policy is used during observation checks, preview, packaging and
source replay. No policy, v1/v2, or v3 `strict` retains the original one-pixel rule.
This is an opt-in approximate reconstruction policy, not visual acceptance or a
conversion of archived failed jobs. See [SERVICE-CONTRACT.md](SERVICE-CONTRACT.md).

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

Historical whole-material fitting remains an approximate legacy path. This
offline policy is opt-in and model-free. Automatic observations are supplied
only by the separately authorized new-run route above.

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
