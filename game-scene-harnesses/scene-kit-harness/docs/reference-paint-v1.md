# Opaque paint source and reviewed geometry

This optional local path implements a single reference instance's paint source,
unmasked source review and separately approved deterministic layer derivation.
It does not complete the all-scene asset pipeline or certify production artwork.
The editing HTTP host gains no generation or execution endpoint.

The accepted complete reference and measured target remain authoritative. The
geometry is separately chosen for this instance: an exact continuous-alpha PNG,
local canvas, native origin and original frame cuts. Choosing approximate design
geometry does not measure the reference's optical alpha or erase uncertainty.

## Design import

`ai_scene_paint_design_control_packet_v1` contains a parent review digest, the
reviewed source/derivation design digest, eight fixed artifact fingerprints and
false compute/application flags. Its artifact inventory is closed:

- `geometry-design-target.json`
- `geometry-acceptance.json`
- `geometry-alpha.png`
- `paint-guide.png`
- `reference-native.png`
- `paint-brief.json`
- `proposal.json`
- `source-prompt-draft.txt`

Import replays the reviewed pure design compiler and paint guide, checks every
byte fingerprint and binds the exact full reference to the currently accepted
measured target. It does not copy private workflow snapshots into public controls.
The source-design human decision targets the original **proposal digest**. A
geometry decision alone cannot accept the source/derivation design.

The earlier review document's `runtimeSupport` snapshot remains unchanged.
Implementation is represented by the separate control and v25 plan records;
no historical design artifact is rewritten as an implemented or accepted state.

## Planning and compute

`ai_scene_generation_plan_v25` has stage `reference-paint-source`. It requests one
new opaque local paint canvas. Inputs are the grayscale geometry/paint-halo guide
and the **unchanged complete reference PNG**, in that order. No new real-art crop
is created. The guide's 8px square-neighborhood halo only requests paint bleed;
the accepted delivery alpha is neither expanded nor resampled.

The image tool's preferred dimensions are soft prompt guidance. Technical QA
requires a nonblank, opaque PNG, both dimensions at least the local canvas size,
within declared maximum bounds and within 1% of the target aspect ratio. Reusing
the exact complete reference as the output is rejected. Technical QA does not
establish correct material, feature alignment or absence of neighboring scenery.

The reviewed normalization rule uses the entire source rectangle, independent
integer area weights along each axis, and permits the small axis-ratio difference
within the 1% tolerance. It never chooses an alpha bounding box, crops, centers,
upscales, fills transparency, recolors, adds a border or auto-retries. Native PNG
bytes remain authoritative source evidence. Pixels with invalid opacity are
rejected rather than repaired.

The existing digest-bound single-use compute authorization, reservation before
dispatch and terminal unknown handling apply unchanged. `runPaintSource` requires
an explicitly supplied adapter. The planning CLI never calls a provider. The
current session's built-in tool may use the existing offline exchange primitives;
this does not claim every optional host adapter supports this new source kind.

## Reviews and derivation

1. `buildPaintSourceReview` shows the native and normalized **unmasked** paint.
2. A source image decision accepts or rejects its painted appearance only.
3. `getPaintApplicationProposal` requires accepted source art and binds the exact
   raw source, QA, source art decision, geometry PNG, mapping and native placement.
4. `reviewPaintApplication` records an independent decision on that exact proposal.
5. `buildPaintLayer` refuses to run until that decision is accepted and current.

Derivation normalizes the opaque paint, multiplies continuous alpha, zeros RGB
where final alpha is zero, and places the local layer at its explicit native
origin with scale 1. Local output alpha must equal the accepted geometry exactly.
The native frame and reference viewport contain only this layer; other layers
are transparent. A viewport preview resamples the **new layer**, not the accepted
geometry master. No reference appearance is copied into the asset.

The immutable proof keeps original paint and mask bytes, all source/review
fingerprints and deterministic PNG checksums. Layer/recomposition art remains
unassessed. Frame-clipped visible layers are not completed reusable modules.
Rejected or unknown old sources cannot be promoted through this API.

## Local entry points

Provider-neutral program APIs live in `./generation` and `./reference-paint`.
The explicit local CLI is:

```powershell
npm run reference:paint -- --help
npm run reference:paint -- import-design --workflow ./project/workflow --options ./import-options.json --artifacts ./paint-design
npm run reference:paint -- review-design --workflow ./project/workflow --controls CONTROL_SHA --receipt ./source-design-user-decision.json
npm run reference:paint -- plan --workflow ./project/workflow --options ./paint-plan-options.json --out ./new-compute-review
```

Use existing workflow external-exchange commands for separately authorized
compute. The new CLI also exposes `inspect`, `source-review`,
`application-proposal`, `review-application`, `derive` and `verify-derived`.
Receipt files must reflect the user's actual decisions; examples grant none.
All tests use synthetic references, paint and adapter doubles.

## Material-aligned source v26 (0.45)

The optional `ai_scene_generation_plan_v26` keeps v25 geometry, source QA,
normalization and application algorithms unchanged. It adds an independently
accepted `ai_scene_material_paint_controls_v1` and exactly three image inputs:
the base grayscale guide, a reviewed material/paint-halo guide, and the unchanged
complete reference. Every reference-image mention in the v25 prompt is rebound
to input 3; the versioned material instruction explains input 2. The adapter must
declare support for at least three input images. A v25 plan cannot silently gain
this new behavior or use an old compute authorization.

The fixed import inventory is `next-step-proposal.json`, `zone-recipe.json`,
`vector-draft.json`, `material-core-labels.bin`, `material-zone-guide.png` and
`probe-plan.json`. The import binds the original accepted design proposal and
review packet, explicit per-component material assignments, the base geometry
and exact reference. Reviewed pixel labels are **authoring authority**, not
inference from a picture or a new measurement of optical Alpha. Their support
must equal accepted Alpha support; guide pixels replay these labels with a
square 8px halo, protecting core pixels and using snow/wood/body priority only
outside the core. Import does not rerasterize or reinterpret the reviewed vector
geometry. That earlier producer's replay evidence remains in the design packet.
The pilot uses body-appearance/wood/snow; it is not a general material classifier.

`getMaterialCoverageProposal` binds the exact new PNG, QA, mapping and normalized
RGBA digest. The program samples every reviewed probe without a semantic verdict.
`buildPaintSourceReview` adds an unmasked point overlay and an observation
template defaulting to `uncertain`. The independent `reviewMaterialCoverage`
requires one observation per probe and each complete body/wood/snow/transition
region. Missing/duplicate observations, wrong proposal targets, any failed or
uncertain item prevent coverage acceptance. Opacity or RGB thresholds never
certify correct appearance. Whole-region reviews include paint bleed and feature
footprints; individual point checks do not certify an entire branch.

Coverage acceptance does not accept source appearance. Source acceptance still
requires its own exact-image decision. Only then can the application proposal
v2 bind coverage evidence plus the exact source/Alpha/mapping, and request an
independent application decision. Derived art and faithful recomposition remain
unassessed. A rejected coverage decision is retained; the source may be rejected
visually, with any new generation requiring a fresh plan and authorization.
No automatic gray erasure, branch deletion, reference fill or segmentation model
is introduced.

New local CLI commands (none submits media):

```powershell
npm run reference:paint -- import-material-design --workflow ./project/workflow --options ./material-import.json --artifacts ./material-design
npm run reference:paint -- review-material-design --workflow ./project/workflow --controls CONTROL_SHA --receipt ./design-decision.json
npm run reference:paint -- material-plan --workflow ./project/workflow --options ./material-options.json --out ./fresh-review
npm run reference:paint -- coverage-proposal --workflow ./project/workflow --plan PLAN_SHA
npm run reference:paint -- review-coverage --workflow ./project/workflow --plan PLAN_SHA --options ./observations.json --receipt ./coverage-decision.json
```
