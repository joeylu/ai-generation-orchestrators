# Component-family material boards v1

Status: supported opt-in producer planning and strict offline extraction. The
Settings trial received user visual acceptance on 2026-09-14 after consumer
independent acceptance. This does not establish all 16 families or styles.

Use one board per explicitly identified component/style group when proposing a
reference-driven split. A group may contain differently sized bases, pictograms,
tracks, thumbs and ON/OFF parts of that component. Keep each part isolated in its
own cell. Keep scene completion separate. Do not force all 16 types into a sample,
mix unrelated controls to fill space, or combine text with raster material.
The earlier v1 material strategy remains compatible and still separates controls
from icon boards. Choose this v2 strategy explicitly; do not reinterpret an
already authorized v1 plan.

## Offline planning

`ai-ui-decomposition material-strategy --observations observations.json --output strategy.json`
accepts the following producer-only observations (not consumer binding fields):

```json
{
  "kind": "ai_ui_material_observations_v2",
  "strategy": "component-family-board-v1",
  "assets": [
    {"id":"track-off","component_type":"Switch","component_group":"switch-blue","target_size":[96,36],"source_reusable":false,"source_evidence":""},
    {"id":"track-on","component_type":"Switch","component_group":"switch-blue","target_size":[96,36],"source_reusable":false,"source_evidence":""},
    {"id":"thumb","component_type":"Switch","component_group":"switch-blue","target_size":[28,28],"source_reusable":false,"source_evidence":""}
  ]
}
```

Alternatively use `python -m ai_ui_decomposition.component_boards plan --input
observations.json --output strategy.json`. Both commands are offline. Clean source
reuse requires nonempty caller evidence and later verified source binding; it is
not automatic alpha or semantic recovery. Group IDs distinguish different skins
of the same type. A group cannot contain multiple types. Repeated state materials
remain independent slots unless existing shared-state evidence permits reuse.

The deterministic strategy emits ordered pixel crop rectangles, target sizes,
packing canvas, reuse inventory, request count and digest. It currently uses a
simple vertical stack with 8px outside padding and 16px gaps. It keeps part scale;
it does not make every cell square or minimize packing area. A canvas exceeding
4096 on either axis fails before compute: explicitly regroup it, update the
strategy and freeze a new plan. Provider-specific limits may be tighter and must
be checked during preflight. No geometry-driven automatic generation fallback.

## Generation and provenance

When the selected provider requires a known raw canvas, observations v2 may
explicitly include `packing_canvas: [1024,1536]`. The strategy then packs slots
left-to-right in input order, starting a new row as needed, with the same 8px
outside padding and 16px gaps. It preserves every target size and fails before
compute if a part cannot fit. Empty remainder stays transparent/keyed. The canvas
and all crop rectangles are digest-bound; this is not post-result rescaling or
permission to recover displaced cells. Omitting the field preserves the original
vertical-stack strategy. This field is producer planning only.

For each board, use an existing generated-isolation request. Put the full slot
inventory, expected raw packing canvas and this literal marker in its prompt:
`component-family-board-v1:<strategy digest>:<board ID>`. Include roles, state
names, source region and empty/background ownership instructions. The raw board
is an intermediate result: existing plan output_size/source_region semantics do
not become runtime board coordinates. Never relax their validator to accommodate
a packing canvas. Freeze and obtain fresh plan-bound authorization through the
existing request lifecycle. Strategy creation is not authorization.

Requests carrying the existing `component-family-board-v1:`
marker retain their declared raw canvas and cell inventory: the deterministic
prompt wrapper does not append single-component centering or preview-support
aspect-ratio instructions. Ordinary component requests keep their old prompts.

The provider must return the explicitly requested raw packing dimensions for
strict extraction. This is a capability requirement, not a guarantee that every
provider can follow a board layout. Receive and verify the raw result normally;
then extract it **before** ordinary whole-image contain/process. The complete
board must not be resized into a runtime component or delivered as its background.

New requests default to solid #F808F8 and deterministic global key removal.
Native RGBA remains an explicit plan option. Never infer a key from a returned
palette or treat a checkerboard as transparent. Distinct state pixels, shape,
transparent outline and local registration still need state QA after extraction.

## Strict extraction and delivery

```text
python -m ai_ui_decomposition.component_boards extract --run WORKSPACE/runs/RUN --asset REQUEST_ASSET --strategy strategy.json --board BOARD_ID --output FRESH_PARTS
```

Extraction verifies the strategy by recomputing it from observations, verifies
the completed request and raw SHA-256 using the existing receipt validator, and
requires the strategy marker in the frozen prompt. It rejects wrong dimensions,
missing parts, cell-edge contact, foreground outside cells, missing actual alpha
and shortened long-control support. It does not infer which semantic symbol was
drawn, auto-associate displaced regions, paint missing art or silently retry.

Native crops preserve coordinates and continuous alpha, clearing RGB only where
alpha is zero. Keyed crops use the existing global matte and uniform contain;
their transformations are recorded and their state alignment must be checked.
No nonuniform resize or inferred nine-slice is applied. A required empty-base
nine-slice remains a separate explicit downstream operation with measured insets.

Outputs are separate PNGs and a digest-bound extraction report recording source
batch/request/raw identities, crop, target geometry, normalization and each PNG
hash. Keep the raw receipt and strategy with the evidence. Import these PNGs into
a fresh assembly plan using existing imported_material paths and hashes; bind
their final roles with the current consumer contracts. Do not invent board fields
in component-handoff ZIPs or hand-write successful delivery receipts.

Before delivery, run the normal material, contract, original-reference packaging,
official consumer import and actual-input acceptance workflow. The existing
consumer independent PNG/binding format is unchanged. Texture/font-style
differences alone need not trigger replacement; shape, proportions, alpha,
ownership, readable runtime text and functioning state changes remain required.
Semantic identity and baked pictogram detection are not general automatic checks.

The strict path does not promote the Settings trial's drifting-cell
region recovery, sample-specific fitting scripts or an unattended retry loop.
Failed extraction stops with its concrete error; a changed plan needs fresh
authorization. Automated artifacts remain human_visual_acceptance=false. Record
subsequent human acceptance separately, bound to the exact delivered ZIP, without
rewriting unknown original state or historical evidence.

## Explicit relative-cell profile (solid key only)

New observations may add this producer-only policy before freezing:

```json
{"extraction_policy":{"version":"1.0","mode":"relative-cell","target_padding":2,"max_canvas_aspect_error":0.15}}
```

The planner deterministically partitions the canvas into nonoverlapping
`search_window` rectangles around the existing ordered shelf cells. The windows
use left/top/right/bottom canonical canvas coordinates. Include these windows,
the strategy digest marker, and `component-family-relative-cell-v1` in the frozen
prompt. Ask for exactly one named part in each window, surrounded by uniform
#F808F8; no checkerboard, labels, grid, reordering or merged state artwork.

Extraction maps each window to the returned canvas dimensions. Relative aspect
error must stay within the declared limit (maximum configurable 0.25), and the
canvas must fit the existing keyed input cap. At least 98% of its perimeter must
match the fixed key within RGB distance 45. Missing foreground or foreground
touching a window edge fails. The local matte removes the declared key globally.
Each resulting alpha support is uniformly fitted into its target canvas with
the declared 1–16 pixel padding. Upscaling is allowed and reported; independent
axis stretching is forbidden. Integer dimensions round to the nearest pixel.

Evidence includes raw dimensions/hash, mapped source windows, matte alpha bounds,
uniform scale, resampled size, final offsets, alpha bounds and part hashes.
Native size, long-control proportions and real alpha remain checked. These
bounded windows tolerate placement drift **within** a declared cell; they do not
discover semantic identity, find arbitrary misplaced parts or verify that a cell
contains no extra artwork. State shape/registration and visual review remain
required. This profile never repairs or reinterprets an older frozen strict plan,
does not authorize extra generation, and adds no consumer fields.

## Separate bounded gutter reprocessing

An existing relative-cell raw result can be processed with an explicit new offline
recipe when its original extraction reports `BOARD_CELL_EDGE_CLIPPED`. This is
not an automatic fallback and does not rewrite the original strategy or report.
`python -m ai_ui_decomposition.board_gutters plan` binds the original strategy,
verified generation receipt, raw hash, original failure and proposed new windows.
The `extract` command recomputes and verifies that exact recipe before output.
Both commands require `--run`, `--strategy`, and a fresh `--output`. Planning also
requires `--asset`, `--board`; extraction requires `--recipe`.

Only horizontal boundaries within an existing row can move. The fixed-key
foreground projection must yield exactly the expected number of separate parts
in the original left-to-right order. Each gap must be at least six pixels wide
and contain a four-pixel strip of the declared pure key. Each boundary moves at
most the requested `--max-shift` (1–32 canonical canvas pixels), further limited
to half the smaller adjacent window. Vertical boundaries, part count, ID order,
target size and matte rules stay fixed. Other failures, ambiguous counts, dirty
gaps or excess movement fail. No semantic reassignment, new artwork or generation
authorization is inferred. The caller must inspect semantic identity; all normal
state, geometry and consumer acceptance remains necessary. Keep both original
failure and separate reprocessing recipe with the delivery evidence.

For larger placement drift, `board_observations.analyze` can produce a separate
receipt-bound connected-region inventory after the declared whole-board matte.
It does not assign semantic identities. An Agent may inspect the actual returned
image and author `ai_ui_board_part_observations_v1` (version 1.0), binding the
candidate digest and mapping every planned asset ID to explicit candidate indices
with observed semantic evidence. `board_observations.extract` verifies all
candidates are assigned exactly once, rejects overlap, unknown IDs, missing
evidence, changed hashes and unassigned specks, then uniformly fits the actual
parts to native targets. It records the original grid failure, matte-derived
coordinates, source hashes and each output. This is a separate observed-region
route, not a successful original-grid extraction or an automatic guessed mapping.
No reference observations, attempt records or frozen prompts may be rewritten.

Explicitly identified normal/active pictogram pairs can use
`state_registration.common_alpha_pair` to trim tiny edge discrepancies to their
common minimum alpha. Both states must already exist, have identical canvases and
distinct pixels. No RGB recoloring, alpha expansion or invented state is allowed.
The operation rejects loss above 5% of either alpha mass or support IoU below
0.85. Record source/output hashes, per-state losses and semantic pair evidence;
missing/different shapes remain failures. These deterministic results still need
runtime state QA and do not grant human acceptance.

An explicitly inspected empty base or rail may add a producer-only `resize`
object to its observed-part record: `mode: "nine_slice"`, four positive `insets`
in fitted-source pixels, and optional `fitSize: [width,height]`. The fit canvas
must stay within the planned target dimensions. Uniform fitting precedes the
existing nine-slice operation; native target dimensions remain unchanged.
Choose protected corners and rail end ornaments from the returned artwork and
record the reason. Do not apply this to pictograms or stretch a selection symbol.
The report preserves the original grid failure and raw digest and adds prefit,
fitted and final Alpha/size evidence. The final long-control geometry gate remains
mandatory. This is explicit deterministic reprocessing, never an automatic
fallback or another consumer field.

Before runtime assembly, inspect the complete owning surface, including crests
extending above its rectangular body and fixed footer dividers. Its registered
bounds and protected ornament bands must leave runtime text and controls clear.
An explicit deterministic band resize may stretch only observed empty runs while
copying ornament bands unchanged; record source/target bands and keep the previous
artifact. Do not move semantic controls or redraw symbols to conceal an overlap.
Also inspect native container paint: a Tabs header does not establish a full-body
surface or unknown filtering behavior. Header-only composition keeps unspecified
content behavior explicit and avoids an unintended opaque background overlay.
