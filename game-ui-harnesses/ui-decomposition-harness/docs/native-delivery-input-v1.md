# Native document delivery input 1.0

The repository DAG can consume an explicitly supplied native document planning
response through `compile_delivery`. It preserves the existing four-type
`vision-draft-1` route. This entry compiles authored data; it does not recognize
components from pixels or invent state assets, layouts, options or business data.

This initial compiler requires identity reference mapping and identity appearance
registration at the original canvas size. Crop/rotation/scaled registration plans
are rejected rather than silently interpreted. A full-canvas Image and material
named `background` is required. These are producer limits, not consumer limits.

The original input envelope is `kind: ui_native_delivery_input_v1`, `version: 1.0`, with:

- `referenceSha256`: fingerprint of the original input image.
- `document`: the consumer's unchanged schemaVersion 0.2 UiDocument.
- `appearance`: existing `{registration, bindings}` appearance plan.
- `materials`: explicit `{layerId, componentId, rect, description, groupId}` rows.
  `rect` is integer world `[x,y,width,height]`; `groupId: null` selects one source
  image, a string selects an explicitly planned component-family board.
  An Image row may opt into the bounded [shared Image source v1.0](shared-image-materials-v1.md)
  declaration when the same reviewed symbol appears at the same size elsewhere.
- `boardPolicies`: exact group IDs mapped to existing extraction policies.
  For single-row content grouping use the explicit producer-only
  [1.1 policy](content-gap-extraction-v1.1.md); it removes canvas-whitespace aspect
  dependence while bounding fragment grouping and individual part proportions.
  No implicit version upgrade is performed.
- `capabilities`: the existing capability request's components array, covering
  every document node with explicit supported profiles.
- `referenceState`, `acceptanceScope`, `referenceMapping`, `layoutSpacing`,
  `layoutRequirements`, `visualObservations`, `stateEvidence`: existing contracts,
  supplied intact instead of translated into a competing state vocabulary.

Native input `1.1` accepts the same fields and may add an optional
`visibleGeometryRequirements` array. Version `1.0` keeps its exact original field
set and behavior. Each declaration names a material by its `layerId`; it does not
contain a source digest or source-pixel bounds because those are unknown before
the material is produced:

```json
{
  "materialId": "panel-frame",
  "alphaThreshold": 1,
  "minimumOccupancy": {"width": 0.72},
  "reservedRects": [],
  "textWorldRects": [],
  "imageWorldRect": null
}
```

Every declaration has exactly these six fields. `minimumOccupancy` must declare
`width`, `height`, or both in `[0, 1]`. Rectangle IDs and coordinates use the
same contracts as `visible-material-geometry-v1.md`; when reserved rectangles
are present, provide a positive `imageWorldRect` and at least one text rectangle.
Unknown material IDs, malformed values, and unsupported native versions fail
native compilation. The canonical declarations are bound into the frozen
generation plan. At materialization, the producer reads the verified PNG digest,
creates the existing `ui_visible_material_geometry_plan_v1` document, and adds
it to `build-plan.json`. `build_handoff` runs that source-bound check before
finalizing or exporting the package; a failed check stops packaging. This is a
technical gate and does not establish human visual acceptance.

Use the current consumer document validator before generation. Generated material
refs belong in `appearance`, never preinserted into `document.props.appearance`.
Image resources use the existing `layers/<componentId>.png` convention. All
material references and board group ownership must resolve explicitly. Base
support does not certify every optional profile or final material.

## Native producer coverage for ProgressBar and ScrollView

The native compiler supports the consumer's `ProgressBar` and vertical
`ScrollView` document types. Their required appearance roles are explicit:

- `ProgressBar`: `track` and `fill`, with `states.progressBar` containing only
  `sourceState: "full-range-template"` and a target-component-local rectangular
  `fillClip` whose `anchor` is `top-left` and `direction` is `left-to-right`.
- `ScrollView`: `viewport`, `scrollbar-track` and `scrollbar-thumb`, with
  `states.scrollView.thumbPositions` using target-component-local top-left
  points. The two points must share x and increase in y. The producer accepts
  only vertical semantic scrolling (`scrollX: 0` and `contentWidth` no wider
  than the viewport); no-overflow documents must state `scrollbarVisibility`
  as `auto` or `always`.

`scrollbarInsets` and `scrollbarThumbSlices` keep their existing consumer
contracts. Insets are checked against the declared track/thumb material
geometry, and thumb slices require insets and a non-empty source middle
segment. Material rectangles provide pre-generation geometry only; decoded PNG
dimensions, alpha, resource ownership and final runtime sizing remain gates of
the official consumer import and stateful acceptance. Missing materials,
unknown state fields, unsupported directions, horizontal scroll semantics and
invalid thumb geometry fail native compilation before any generation request.
These types use the existing capability profiles (`ProgressBar`:
`left-to-right`, `inner-fill-mask`, `value-text`; `ScrollView`: `vertical`,
`zero-range`, `always-visible`, `insets-v1`, `authorized-bottom-space`). A
successful native compile still does not establish material or human visual
acceptance.

Provide this envelope as repository adapter `options.response` in the existing
`workflow-init` adapter configuration. `workflow-advance` compiles and freezes
offline, then pauses for plan-bound compute authorization. The legacy built-in
vision prompt remains four-type; a planning MCP/subagent must explicitly produce
this native envelope for the expanded route. No provider prompt silently switches
schemas or assumes authorization.

The output uses the existing generation plans, board extraction, capability
preflight, reference handoff v2 builder and official consumer import. Real state
acceptance, Studio roundtrip, source-relative visual checks and human acceptance
remain separate stages. A successful compiler is not a completed sample.

Declare `visualObservations.requiredTextGeometryIds` explicitly. The planner
must list title/subtitle owners and provide their independent geometry targets;
native UiDocument has no role metadata from which the compiler can infer them.
An empty list means no such required owners were declared, not automatic title
detection. Missing geometry for a declared owner is an error.

## Cross-component integration

The consumer now implements componentLinkages 1.0 and itemContents 1.0.
Use [producer linkage integration](component-linkages-v1.md) for the separate
capability profiles, canonical source registration and real-input acceptance.
Supply these existing fields inside document; the native envelope is unchanged.

## Expedition supplies constraints

The new reference needs Tabs, Input, Select, List and CheckBox in addition to
Panel, Image, Text and Button. Its visible quantity and total introduce separate
requirements that are not satisfied by these component types:

- Existing List selected-item text binding 1.1 can update the selected name.
- Existing numeric text binding accepts Slider/ProgressBar; Button-driven quantity
  and bounded multiplication use componentLinkages, not numeric text bindings.
- Search, category filtering and sorting use explicit componentLinkages mappings.
  Independent row images/descriptions/prices require itemContents ownership.
- Purchase/navigation actions remain external business integration unless a
  supported portable contract explicitly specifies them.

Do not add guessed event scripts, custom props, fake hidden items or fixed text
beside supposedly changing quantities. Record these gaps before authorizing this
sample's generation. Resolve source-vs-runtime ordering explicitly; never infer
an original sorting algorithm from the visible Name label alone.
