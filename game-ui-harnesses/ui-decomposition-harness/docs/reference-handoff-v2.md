# Self-contained reference handoff v2

`ai_ui_component_handoff_v2`, `schemaVersion: "2.0"`, extends the runtime archive
without changing its embedded decomposition ZIP, appearance binding or UI bundle.
The versioned schemas are `references/component-handoff-v2.schema.json`,
`references/reference-state-v1.schema.json`, and `references/acceptance-scope-v1.schema.json`.
Runtime validators additionally enforce file hashes, actual image dimensions,
mapping bounds, component types, option membership, numeric domains and complete
state/scope coverage. A schema check alone does not establish those invariants.

Required members:

```text
handoff.json
component.ui-bundle.json
appearance-binding.json
decomposition/<existing-name>.draft.zip
reference/original.<input-extension>
reference/reference-state.json
acceptance-scope.json
```

The original is copied as exact input bytes, preserving extension spelling. PNG,
JPEG, WebP, GIF and BMP are supported. Unsupported formats fail explicitly.
Original images are reference evidence, never runtime resources. The embedded
`preview.png` is an assembled derivative, never the original. Runtime captures
remain separate derived acceptance artifacts.

The reference manifest contains `original` (path, SHA-256, width, height), `mapping`,
`state` and `scope` (path and SHA-256), plus `derivatives`. Each optional derivative
has its own path, hash, dimensions, original source path and mapping. No declared
file reference resolves outside the archive. Missing/extra ZIP entries, unsafe
paths, mismatched hashes and invalid states reject import.

## Coordinate mapping

Mapping is explicit even for identity. `coordinateSpace` is
`raw-image-pixel-edges-to-runtime-canvas`; source dimensions refer to the raw
encoded image, before EXIF orientation. Pixel edge coordinates span `[0,width]`
and `[0,height]`, origin top-left, x right, y down.

Apply operations in this exact order:

1. Crop `[x,y,width,height]` in raw source coordinates.
2. Flip horizontally/vertically within the cropped rectangle using `flipX/flipY`.
3. Rotate clockwise by `rotationDegrees` (0, 90, 180, 270), translating the rotated
   rectangle to a zero-origin bounding rectangle.
4. Scale x/y by `scale: [sx,sy]`.
5. Translate by `offset: [x,y]` in the declared `targetSize` canvas.

No implicit EXIF orientation, crop, fit, centering or scaling is permitted. Crop
bounds must lie inside `sourceSize`; the transformed rectangle must fit
`targetSize`, which must equal the UI bundle canvas. A smaller mapped rectangle
is allowed for explicit letterboxing; out-of-source areas have no original-image
evidence. Quarter turns plus flips cover all eight EXIF orientations. Arbitrary
angle rotation and perspective are unsupported and reject rather than approximate.

`init` and the headless input preparation now retain exact original bytes beside
the normalized PNG and write `reference-provenance.json`, including EXIF transform
and both hashes. Existing normalized-only projects must locate the real original;
they must not relabel the normalized PNG as original.

## Observed state and scope

Each state row identifies a real `componentId`, its exact `componentType`, and
complete typed `fields` for that type. Required fields:

| Component | Fields |
|---|---|
| Tabs | activeId |
| CheckBox, Switch | checked |
| RadioGroup, List | selectedId |
| Select | selectedId, popupOpen |
| ScrollView | scrollX, scrollY |
| Input, Slider, ProgressBar | value |
| Dialog | open |

Each field is either `{status:"observed",value:...,evidence:"visible basis"}` or
`{status:"unknown",reason:"why unavailable"}`. Unknown fields cannot contain a
value. No component defaults are promoted to observations. References resolve
against the bundle's actual node/option/tab/item IDs. Input length, slider step,
progress range and scroll range are checked. All supported stateful nodes must be
listed, including nodes whose state is unknown. Static nodes and Button do not
need a value state; their visual scope is still explicit.

Scope lists every tree node exactly once, with `compare` or `exclude` and a reason.
Entries refer to that node's own appearance, not an implicit recursive selection;
children have their own entries. `derivedTestStates` contains separately labelled
`contract-derived` descriptions for additional interaction tests. These descriptions
are not observed values and are never replayed as source state.

Unknown fields are valid evidence of a limitation. They make
`visualComparisonReady: false`; a screenshot may still be captured, but complete
same-state visual comparison is blocked. `human_visual_acceptance` remains false
throughout. Complete evidence or ready-to-compare never means visual acceptance.

## Offline commands

New visual handoffs use the normal command with explicit evidence:

```powershell
ai-ui-decomposition component-handoff --delivery delivery --component-bundle target.json --appearance-binding binding.json --reference-original input.png --reference-state state.json --acceptance-scope scope.json --reference-mapping mapping.json
```

An existing draft can be upgraded without regenerating or rewriting its inner
delivery. The destination must be new:

```powershell
ai-ui-decomposition reference-handoff --source old.draft.zip --original input.png --state state.json --scope scope.json --mapping mapping.json --output new/ui.component-handoff.draft.zip
```

Optional `--derived derived.json` (or `--reference-derived` on the normal command)
accepts `{images:[{file:"normalized.png",mapping:{...}}]}`. Input file paths are
safe relative paths from that configuration directory; the exporter assigns
`reference/derived-1.<ext>` names. Original bytes are never regenerated.

The normal CLI requires reference arguments. `--legacy-without-reference` is an
explicit compatibility export, not a visual handoff. Existing Python callers can
still create v1 packages; their export receipt explicitly states
`missing_reference_evidence` and `visual_comparison_ready: false`.

Official consumer:

```powershell
node scripts/cli.mjs component-handoff single.zip --output consumed.json --reference-output reference-evidence.json
```

The reference output includes the validated state, mapping and scope and exact
reference file bytes encoded as base64 with SHA-256. It is independently portable;
no workspace resource lookup is needed. The consumer emits reference readiness to
stderr even without `--reference-output`. Legacy v1 packages still import but
explicitly report `missing_reference_evidence` and false readiness.

After importing `consumed.json` into the local workbench, call
`window.uiHarness.replayReferenceState(referenceEvidence)` and capture its PixiJS
canvas after rendering settles. The neutral `replayReferenceState` helper is also
exported for downstream adapters. It writes only observed fields; unknowns remain
disclosed. Select popup state is set explicitly, not toggled based on a guessed
default. Replay is idempotent. Do not treat reference defaults as evidence that
all alternate states exist.

Visual comparison must map original pixels using the declared transform, honor
scope, and preserve unknown-state blockers. This change does not make old browser
state tests a source-image similarity pass or implement arbitrary-icon recognition.
