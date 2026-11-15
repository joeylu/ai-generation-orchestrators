# Reference structure and feature calibration

New source scopes may explicitly include a sealed `referenceStructure`, format
`ai_scene_reference_structure_v1`. `createReferenceStructure` validates the exact
accepted reference PNG SHA, canonical viewport, source instance/subject IDs,
2–16 named feature points per source with preselected world tolerances, and
source-owned structure checks with stable IDs and descriptions.

These strict tolerances serve requested reconstruction or functional alignment,
not a universal definition of scene quality. For reference-inspired authoring,
judge responsibility, depth, occlusion and editing first. When the user changes
an existing strict goal, use a separate [reference-intent review](reference-intent-review-v1.md)
for the new composition; preserve the strict measurements and old failed report.

Before freezing, overlay every named point on the exact original reference and
inspect ambiguous or repetitive details enlarged. A declared endpoint must be
the visible endpoint, not a nearby repeated bar or surface detail. Record native
coordinates and the actual reference-to-viewport mapping; identify homologous
source features before fitting. A later annotation erratum uses the separate
correction contract below and retains the original review. Never choose revised
targets by minimizing the generated image's residuals.

Inventory significant internal members and opening partitions as well as outer
extents. For example, matching the corners of an industrial rack does not constrain
where its inner crossbar sits. Register the visible internal position or a reviewable
relative-position requirement before freezing; uncertainty about the member's
function is separate from its observable location. Review unmarked masses after
generation too. A passing subset of point residuals does not override failed
structure checks, technical PNG rejection or unresolved observation coverage.
`tests/reference-interior-coverage.test.mjs` demonstrates this with a synthetic
industrial rack: unchanged corner points fit exactly while a displaced inner bar
must still block the opening review. An incomplete contract with inaccurate check
verdicts can pass; the program does not recognize that omission from pixels.

Use `createLayerSourceScopes` brief overrides or `withReferenceStructure` on a
revised item scope. The new prompt preserves named feature proportions and
structure, as well as appearance. It does not inherit the default statement
that the reference supplies appearance only. No extra image input or image
call is introduced. Absent-field plans retain their original bytes.

For a new isolated source whose multiple parts belong to one fixed group,
an asset row may explicitly select `compositionProfile: 'source-owned-feature-group-v1'`.
Its bound feature/check declarations then govern all owned parts. The compiler
replaces the legacy isolated-source sentence that dismisses paired/plural wording
as context; it still forbids unowned neighboring subjects and whole-scene copying.
This also applies to plural parts on the same side; inspect every selected
source's compiled prompt, not just the most obvious opposite-side group.
Select it per asset, only after checking that the parts may share transform,
parallax and external occlusion order. Band/window framing instructions retain
their own precedence. This adds no image, loosens no Alpha or feature gate, and
does not separate parts for later editing. Existing structures without the field
replay unchanged; the new field changes the structure/plan digest and must not be
inserted into a frozen structure or inherited by a revision without a new design.

Direct revisions of a structure-bound source must retain the same sealed
structure. Dropping it, changing points or changing intent to evade it is
rejected during plan compilation and replay. The initial source batch uses a
shared structure. A later revision can register another source against the same
reference bytes and viewport. Every declared source owner must exist in the
batch, and declarations for the same owner must be identical. A different design needs its own
explicit design decision and new planning context; do not initialize a new
project merely to discard a failed gate. Cross-project continuations must
explicitly carry the same structure. This is not a global registry and cannot
discover an omitted contract in an unrelated project.

## Zero-generation preflight

`reviewReferenceFeatureLayout({structure,sources,measurements,bandPlacements})`
evaluates human or Agent native feature observations. Measurements bind exact
source plan/raw PNG identities and supply every structural check verdict.
Missing features/checks, `fail` and `uncertain` block review. Unknown/duplicate
IDs, stale identities and invalid coordinates fail closed. Do not invent a
correspondence for a source that lacks the reference feature.

For isolated scenery, landmarks and foreground, the program solves one uniform
positive scale and translation from all named points. Rotation and independent
x/y stretching are forbidden. Every mapped point must meet its original
tolerance after bounded rational-scale quantization. Do not enlarge tolerances
or change feature identities after seeing a failure to manufacture a pass.

Calibration uses feature coordinates, not an Alpha box. A remote A=1 pixel does
not shrink the semantic object. No Alpha threshold discards pixels, clips the
source or changes a silhouette. Background bands instead retain their explicit
full-native placement and existing camera, finite-frame and Alpha range gates;
named features are checked in that placement, not freely fitted.

## Composition and delivery

`createFeatureCoherentComposition(batch,target,surfaceMapping,structure,measurements,options)`
produces `ai_scene_coherent_composition_v6`, retaining the measured terrain
contract plus `referenceStructure`, `featureMeasurements` and `bandPlacements`
(empty if none). A feature-owned instance cannot also receive an ordinary
transform or terrain contact. The composition must cover every frozen source
structure with identical rows under the same reference and viewport. Each added
row requires its own measurements. Existing v1–v5 interpretation remains unchanged.

Public API: `reviewCoherentReferenceFeatures(workflow,batchSha256,composition)`.

```text
node scripts/coherent.mjs features-review --root PROJECT --composition V6_JSON --out NEW_JSON
```

This replays current-batch evidence without deriving terrain or packaging.
Blocked reports are saved and the CLI exits 2. `deliver` and direct construction
replay the gate before expensive derivation. Structure-bound sources require a
v6 composition with the exact structure SHA; an old composition cannot remove
that requirement.

When an independent review identifies a coordinate annotation error, a new v6
composition can include `featureCorrection` with a sealed
`ai_scene_reference_feature_correction_v1` proposal and its acceptance receipt.
The proposal binds the original structure and review evidence digests and lists
the affected instance, feature, prior coordinate, corrected coordinate, and
reason. Only target coordinates are revised for fitting. The source-plan
structure, original tolerances, feature names, and structural checks still bind
the review. The candidate includes the correction and records its digest in the
feature review, so verification replays the same decision.

For a new source request, explicitly carry that same `{proposal, decision}` in
its optional scope `featureCorrection`, or use
`withReferenceFeatureCorrection(existingItemScope, correction)`. The prompt and
supported guide then use corrected targets while retaining the original sealed
structure, feature identities, checks and tolerances. A correction-bearing
source revision cannot drop or replace the decision; a batch cannot mix different
correction bundles. Its v6 composition and standalone feature review must carry
the exact same bundle. Sources without the field retain historical prompt bytes
and may still receive an independently reviewed composition-time correction.
This adds no automatic coordinate judgment, global cross-project registry, art
acceptance or compute authorization. The [isolated source frame guide](source-frame-guide-v1.md)
binds both the correction and original structure into its reviewed raster.

Omitted visible features/checks for existing owners can use a separate reviewed
[`featureSupplement`](reference-feature-supplement-v1.md) in a new source plan.
This additive contract retains the original sealed structure and any coordinate
correction; it cannot replace declarations or weaken old tolerances. Prompt,
reviewed guide, v6 composition and delivery evidence must carry the same bundle.

Successful isolated placements store the complete native frame without
resampling. Every nonzero-Alpha RGBA value remains unchanged; only established
RGB normalization at exactly zero Alpha occurs in the derived PNG. The original
PNG is copied unchanged. Review and placement evidence are exported and replayed.
An isolated placement does not certify camera coverage.

The feature does not recognize images, verify observation accuracy, certify
contrast or art, infer hidden geometry, authorize compute or retry generation.
Structural verdicts remain explicit observations. Actual Studio composition,
brush interaction and independent human final art review remain required.
