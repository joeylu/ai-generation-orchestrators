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

For each board, use an existing generated-isolation request. Put the full slot
inventory, expected raw packing canvas and this literal marker in its prompt:
`component-family-board-v1:<strategy digest>:<board ID>`. Include roles, state
names, source region and empty/background ownership instructions. The raw board
is an intermediate result: existing plan output_size/source_region semantics do
not become runtime board coordinates. Never relax their validator to accommodate
a packing canvas. Freeze and obtain fresh plan-bound authorization through the
existing request lifecycle. Strategy creation is not authorization.

The provider must return the explicitly requested raw packing dimensions for
strict extraction. This is a capability requirement, not a guarantee that every
provider can follow a board layout. Receive and verify the raw result normally;
then extract it **before** ordinary whole-image contain/process. The complete
board must not be resized into a runtime component or delivered as its background.

Native RGBA is the default. An explicitly authorized keyed request may use only
the existing #F808F8 global key-removal route. Never infer a key from a returned
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

This supported strict path does not promote the Settings trial's drifting-cell
region recovery, sample-specific fitting scripts or an unattended retry loop.
Failed extraction stops with its concrete error; a changed plan needs fresh
authorization. Automated artifacts remain human_visual_acceptance=false. Record
subsequent human acceptance separately, bound to the exact delivered ZIP, without
rewriting unknown original state or historical evidence.
