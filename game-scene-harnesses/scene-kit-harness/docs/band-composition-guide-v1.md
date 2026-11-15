# Explicit background-band feature-envelope guide

Use `ai_scene_band_composition_guide_spec_v4` when the full reference window
exposes neighboring depth layers and the fixed neutral contour would suggest
the wrong silhouette. It takes the v2 spec fields and renders only the numbered
feature markers on the complete transparent canvas. It requires a bound
`referenceStructure`, with each marked feature and target interval checked
against that structure as for v3. The original reference stays input 1 for
appearance and the declared features. The single-layer brief supplies the
silhouette and inferred continuation. The prompt uses the reviewed regions
for registration and keeps the declared structure checks. Review the exact
proposal before freezing and replay the same native feature, relation, world
placement and camera checks after reception.

For an already reviewed opaque layout master, the separate
[registered master edit](registered-layout-master-v1.md) uses one prepared edit
target and retains the original accepted reference as bound evidence. It has its
own typed spec/proposal and does not change the guide profiles below.

The additive `ai_scene_band_composition_guide_spec_v3` uses a **reference window**
instead of an abstract gray contour. Supply `referenceViewport` and the exact
accepted `referenceBytes` when previewing or replaying. The feasible guide-pixel
to-world witness maps the complete reference viewport into the band's actual
canvas; clipped display at a canvas cut is recorded. Stripes identify the area
outside that reference frame, where continuation is a design inference. This is
a full-scene spatial guide, not segmentation or a finished source; neighboring
subjects in its colored window remain excluded by the source scope.

V3 requires a bound `referenceStructure`. Every guide feature must match that
source owner's ID, description and original target, with target intervals inside
its existing tolerance. Original reference bytes remain input 1; the regenerated
guide is input 2 with role `accepted-reference-window-in-band-frame-guide`.
Review the exact new PNG/proposal before freezing. Metadata-only scope validation
cannot establish raster approval: compilation reads the accepted reference,
rerenders and checks the exact proposal decision. Freeze, read, source review,
candidate build and verification replay the actual reference-derived guide.

When the accepted v3 guide uses the standard spec with no `instructionProfile`,
an explicit `contentProfile: 'scope-owned-band-registration-v1'` on a backdrop or
valley scope selects instructions for that reference window. The brief names the
visible features and the inferred continuation. This uses the same accepted guide
bytes and proposal. The newly frozen request uses the reviewed feature ranges
instead of the neutral example or a fixed aspect between two reference points.
The complete reference structure remains bound for placement and review.

V1/v2 rendering and request bytes stay unchanged. V3 does not change the current
feature, relation, full-native coverage or actual-Studio gates. A reference
occlusion edge is not a proven physical source endpoint; inspect the actual
source correspondence and recomposition, and block missing/uncertain evidence.
Window registration is a generation hint, not guaranteed model compliance,
pixel preservation, source ownership, unseen reconstruction or art acceptance.

An additive `ai_scene_band_composition_guide_spec_v2` also supports v4 open-depth
bands and 2–12 features. It uses the band's actual selected open-depth/trench/
irregular base, adds numbered feature centers, and explicitly retains their
locations within the full canvas. Review and bind the new exact proposal before
freezing. The existing feasibility, relation/guide observation and actual-world
placement gates remain required. v1 stays v3-only, with its original bytes and
2–4 feature limit. Marks are hints, never model compliance or artwork acceptance.

For a new v3 background band only, a source scope override may include
`bandCompositionGuide: {spec, decision}`. This opt-in compiles a fresh plan;
old scopes, frozen plans, guide bytes and authorizations are unchanged. The
first input remains the entire accepted reference. The second is a fixed
program-drawn neutral v3 coverage example overlaid with two to four dashed
feature rectangles with numbered badges. These are technical location hints, not
artwork. The prompt explicitly prohibits painting any marks into the output.

`spec` has `format: 'ai_scene_band_composition_guide_spec_v1'`,
`referenceRawSha256`, bounded `scale: [min,max]`,
`translation: {x:[min,max],y:[min,max]}`, and two to four `features`. Each
feature has `featureId`, `description`, `native: {x:[min,max],y:[min,max]}`
as fractions of the whole band, and `target` as x/y world-coordinate intervals.
Scale is world units per pixel of the fixed neutral example, not a guarantee
of the image model's actual output dimensions. All locations are explicit
observations/design assumptions; no source image is segmented or cropped.

Call `previewBandCompositionGuide({band,role,spec})` to construct the exact
PNG, recipe and sealed proposal. The proposal binds the reference, band and
spec digests, actual PNG fingerprint and recipe digest. Inspect that exact PNG,
then create a review receipt targeting `proposal.sha256`. The compiler rerenders
and recomputes the proposal; a changed PNG or recipe rejects the old receipt.
This is intermediate guide review, not compute authorization or final artwork
acceptance. The compiler checks the reference SHA against the
actual accepted reference. The generator replays the v3 band's camera/parallax
coverage contract and checks uniform-scale feasibility against its declared
design frame; natural transparent sky above that frame is not treated as a filled
band. It records the feasibility witness in the recipe and binds the guide
bytes and recipe into the plan. Use the same spec and decision when replaying;
any change requires a new review, a fresh plan and a separate compute decision.

The same scope must declare `bandFeatureRelations` with the same reference SHA,
feature IDs and descriptions. Following reception, use `coherent band-guide-review
--root PROJECT --source PLAN_SHA256 --observations JSON --out NEW_REPORT.json` to
review actual native feature locations as normalized x/y uncertainty intervals.
Each entire observed interval must fit inside its corresponding guide `native`
range; missing, outside or partially overlapping intervals block the report.
Separately run `band-relations-review` for the signed separations. Both commands
read the actual workflow plan, raw image and technical QA, write blocked reports
for rejection, and never submit compute. For delivery, provide each exact report
and its observations as rows `[{"planSha256":"CURRENT_BATCH_PLAN_SHA",
"observations":[...],"report":{...}}]` via `--band-guide-reviews` and
`--band-relations-reviews`, respectively. The two reports must use identical
observed x/y intervals for every feature; order may differ. Candidate build and
verification replay both against the workflow; missing,
uncertain, failed or stale evidence blocks. For a checked rebind, the row binds
the current rebind plan while each report binds its original target plan and QA.
Other preparation types stop closed until separately supported.
The candidate also uses the actual PNG width and height, the same reviewed
native intervals and its exact background-band placement to map each observed
interval into world coordinates. Every mapped interval must lie wholly inside
its declared `target`; missing placement and out-of-range or partially crossing
results block. Repositioning requires rechecking the exact new composition; the
abstract guide feasibility witness alone is not a pass.

This is a location hint, not automatic visual understanding, reconstruction of
the hidden scene, evidence that the model followed the guide, proof of Alpha or
painted continuity, actual source scale, Studio composition, or human visual
acceptance. Inspect the model output for copied marks, content and original
Alpha, remeasure features and validate the actual native dimensions and finite
camera placement. Unknown attempts remain terminal and may not be retried.
