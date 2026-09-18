# Decomposition materials and appearance bindings

This offline handoff consumes the PNG ZIP exported by the sibling
`ui-decomposition-harness`. It connects material evidence to an existing semantic
UI document. It does not invoke a model or change the upstream Harness.

## Independent asset ZIP entry

For a separately produced `ai-ui-assets` PNG ZIP, build directly without the
producer's delivery directory or an outer component-handoff archive:

```text
ai-ui-component assets-build assets.zip target.ui-bundle.json appearance-binding.json --output built.ui-bundle.json
ai-ui-component validate built.ui-bundle.json
```

The three inputs are independent immutable artifacts: the old named-layer ZIP,
an explicitly authored semantic target bundle, and the existing version 0.2
appearance-binding document. The library equivalent is
`compileDecompositionAssets(archiveBytes, targetBundle, binding)`.
Use `importDecompositionZip` to obtain authenticated layer IDs, asset IDs,
positions, dimensions, archive/scene/delivery hashes, and use
`appearanceDocumentSha256` to fingerprint the target. Author roles, registration
and states explicitly; never infer them from filenames. All bindings remain tied
to the exact target and ZIP. Changing either requires a newly validated binding.

This entry reuses the existing importer and appearance compiler, plus the same
interactive coverage and invisible-control gates as component-handoff import.
It rejects missing required parts/states, stale digests, invalid geometry and
existing output paths. It does not generate missing images. If, for example, a
Switch lacks its required thumb, supply an explicitly planned supplementary
material package and rebind; a normal-state screenshot does not prove other states.

The output is a validated portable bundle with bound PNG bytes. CLI stderr
reports the source archive hash, upstream review, `runtimeAcceptance:not_run`
and `visualComparisonReady:false`; compilation does not grant human acceptance.
Keep the source ZIP, target and binding beside the result for reproducibility.
The ZIP has no v2 original/reference-state evidence, and this command does not
invent it. Use the existing v2 path when official reference comparison is needed.
No new fields or members were added to the decomposition ZIP: its current layer
inventory already contains the material identity and geometry needed for binding.

The existing one-file component-handoff and Studio routes below remain supported.

The later [legacy pilot adapter](legacy-layered-case.md) adds a direct Button
texture path. It does not apply this standalone binding document automatically;
the limitations below concern this binding-driven path.

The complete one-file path is:

```text
Original reference → semantic observation → deterministic component.ui-bundle.json
Decomposition PNG ZIP → integrity validation → scene.json + PNG layers + preview
                  exact component target + explicit layer-role binding
                                      ↓
                 ui.component-handoff[.draft].zip (single file)
                                      ↓
              authenticated import + deterministic appearance application
                                      ↓
                     interactive PixiJS preview + portable bundle
```

The outer ZIP is the transfer boundary between the two Harnesses. It contains
`handoff.json`, the unchanged decomposition ZIP under `decomposition/`, the exact
`component.ui-bundle.json`, and its `appearance-binding.json`. The manifest
authenticates all three payloads. The nested decomposition receipt and scene then
authenticate every PNG again. No filename-based component inference is performed.

Consume it from the library with
`importAndApplyComponentHandoff(archiveBytes)`, or from the offline CLI:

```text
ai-ui-component component-handoff ui.component-handoff.draft.zip \
  --output ui-bundle.json
```

The command validates the outer manifest, nested decomposition delivery,
component contract, binding geometry, role completeness, and all referenced PNG
bytes before writing a new portable bundle. It refuses to overwrite an existing
output.

Studio also accepts this archive directly through **导入组件交付 ZIP**. It runs
the same compiler and gates as the CLI, mounts the resulting interactive bundle,
and displays the authenticated archive SHA-256 and upstream review declaration.
`importComponentHandoffWithReview(bytes)` provides the compiled bundle and these
metadata in one library call; `importAndApplyComponentHandoff` remains compatible.
Failed or superseded imports cannot keep an old successful preview or disclosure.
Successful import does not grant new human visual acceptance. External state
screenshots and acceptance-scope files beside the ZIP are not imported by this
entry; the existing handoff inventory contract is unchanged.

The Studio can display the package's original `preview.png` as a static material
check. A validated 0.2 binding can be applied to all 16 component types in the
tree contract. Text pixels are authenticated for exact geometry but are not
copied over semantic runtime text; Image is rebound to the authenticated layer.
The compiler reauthenticates the target bundle and ZIP, validates every digest
and explicit rectangle, copies the bound PNG bytes under the full archive hash,
and emits a new portable bundle. Keep the original ZIP, target and binding with
the result so the application remains reproducible.

## Local Studio flow

1. Open a saved semantic component bundle, or finish reference recognition.
2. Select **使用当前组件作为绑定目标** to capture the exact component document.
   Later canvas interactions do not modify this captured target.
   **保存绑定目标方案** exports this exact snapshot with its resources and motion,
   even after switching the canvas to the material composite. Keep this file
   with the ZIP and binding so future validation uses the same document.
3. Import the upstream PNG ZIP through **拆分素材**. Check the layer inventory,
   upstream review declaration, and optional automatic QA result.
4. Use **查看拆分合成图** to display the upstream composite. A composite preview
   cannot itself be selected as the semantic binding target.
5. Import an explicitly authored appearance-binding JSON. A 0.1 binding can be
   revalidated and exported. A 0.2 binding also enables **应用绑定并预览**.
6. Interact with the applied controls, compare schemes, then export the portable
   bundle. Application does not upgrade an upstream draft or claim visual review.

Opening a new component bundle/reference or clearing the Studio resets the
material and binding context. Replacing a ZIP invalidates the previous binding;
an invalid replacement also clears the previous material canvas. Importing an
invalid binding disables its export. No filename-based role selection occurs.

## Import contract

`importDecompositionZip(bytes)` returns an immutable metadata object with
`archiveSha256`, `sceneSha256`, `deliveryDigest`, `canvas`, ordered `layers`,
layer `resources`, `preview`, and `review` evidence. Each layer retains its ID,
asset ID, group ID, PNG path and hash, role, position, and dimensions.

The importer accepts current stored ZIP exports, including Python's
`force_zip64=True` local headers. Compressed ZIPs and ZIP64 central directories
are unsupported. The inventory is limited to `scene.json`, `delivery.json`,
`preview.png`, declared `layers/<id>.png`, and optional
`automated-visual-qa.json`. It rejects unexpected members, unsafe paths,
duplicates, unsupported ZIP entries, inconsistent evidence, and checksum errors.
Public byte/pixel/member limits are exported from `decomposition-import.ts`.
The Studio's existing bundle and image-decoding limits also apply to composite
preview; an archive can be structurally importable yet too large to preview.

PNG validation checks structure, dimensions and CRCs; pixel decoding happens
at the browser rendering boundary. This is not semantic or visual validation of
the pixels. Review flags are upstream declarations bound by hashes, not digital
signatures or a new human review. `unreviewed_draft` stays a draft even when
automatic QA says `passed`.

Before another consumer uses the returned bytes, call
`assertValidImportedDecomposition(imported)`. It rejects fabricated import
objects and rehashes exposed mutable PNG arrays. The appearance validator calls
this itself. Persist the source ZIP and re-import it after process reload; a
serialized metadata object is not a substitute for validated source evidence.

## Binding authoring

The library exports `appearanceDocumentSha256(document)`,
`appearanceRoleCatalog()` and `validateAppearanceBinding(input, document,
imported)`. A minimal explicit mapping can be authored as follows after the
document and ZIP have been validated:

```ts
const binding = await validateAppearanceBinding({
  kind: 'ui-appearance-binding',
  version: '0.1',
  documentSha256: await appearanceDocumentSha256(document),
  archiveSha256: imported.archiveSha256,
  deliveryDigest: imported.deliveryDigest,
  sceneSha256: imported.sceneSha256,
  registration: {
    sourceCanvas: imported.canvas,
    targetCanvas: document.canvas,
    // Explicit example only: valid when both canvases share these coordinates.
    transform: { scale: 1, offset: { x: 0, y: 0 } },
  },
  bindings: [{
    componentId: 'purchase',
    componentType: 'Button',
    parts: [{ role: 'background', layerId: 'purchase-background' }],
  }],
}, document, imported);
```

The IDs in the example must actually exist. The validator checks exact document,
ZIP, delivery and scene fingerprints, matching component types, required roles,
duplicate roles/layers/components and registration. A subset of components may
be bound, but each declared binding must include all its required roles.
Registration uses one positive uniform scale. This version disallows cropping:
the complete transformed source canvas must fit inside the target canvas.
Partial coverage is an authoring capability only. Importing the one-file
`ai_ui_component_handoff_v1` archive requires every interactive semantic node
to have a binding, so a complete handoff never falls back to generic controls.

The role catalog and automatic runtime application cover all 16 component types.
Every declared 0.2 mapping remains type-specific and fail-closed.
RadioGroup requires one explicit option and indicator layer for every semantic
option. Other repeated item skins and variant-specific assets remain unsupported
rather than being duplicated implicitly.

Switch requires distinct `track` and `thumb` layers plus explicit states:

```json
{
  "switch": {
    "thumbPositions": {
      "coordinateSpace": "target-component-local",
      "anchor": "top-left",
      "off": { "x": 4, "y": 4 },
      "on": { "x": 56, "y": 4 }
    }
  }
}
```

These positions belong under the binding's `states`. They are author-supplied
component-local top-left coordinates, not endpoints inferred from a screenshot.
The full scaled thumb must fit within the component at both positions.

## Application binding 0.2

Version 0.2 adds explicit runtime geometry. Button provides a semantic label
layout; Switch provides thumb endpoints and label layout; Select maps
`background`, `indicator`, and `popup` plus a semantic label layout and a
`below-start` popup placement. A Select may also provide `popupContentLayout`
in `target-popup-local` coordinates. This rectangle defines the popup area in
which option rows, labels, selection feedback, hit areas, and clipping are
allowed; use it when decorative borders, shadows, or pointers make the full
popup image unsuitable for content. Other coordinates are target-component-local. The
compiler accepts no filename/role inference, non-uniform fit, popup stretching,
existing appearance overwrite, missing label geometry, or stale evidence.

State-specific semantic text colors are explicit and optional. Select
`fieldTextColor` affects only the collapsed field, so popup options continue to
use the component's base `style.textColor`. Tabs `activeTextColor` affects only
the active tab label. Both fields accept `#RGB` or `#RRGGBB`; absence preserves
the base text color for backward compatibility.

Tabs may also bind one `icon` and one `active-icon` part for every `tabId`.
`states.tabs.icons` supplies matching `target-item-local` `iconLayout` and
`activeIconLayout` rectangles. If any tab icon is supplied, both states are
required for every tab, so switching tabs cannot make an icon disappear or
reuse another tab's artwork.

For native unequal-width tabs, supply `states.tabs.items`, with exactly one entry
per semantic tab: `{tabId, layout, labelLayout, hitArea}`. `layout` is an explicit
`target-component-local` rectangle; `labelLayout` and `hitArea` are
`target-item-local`. Cells begin at y=0, share the declared `headerHeight`, fit
inside the component, and must not overlap. Gaps are permitted and do not respond
to pointer selection. Each tab then requires its own `tab` and `active-tab` part
with that `tabId`; both source layers must exactly match its native rectangle
after the declared uniform registration. Icon geometry is measured inside its
own cell. No per-cell stretching or guessed tab widths is performed.

The consumed raster appearance carries `items` with explicit layouts, normal and
active image paths/canvases and per-item text/hit areas. Existing top-level fields
remain for compatibility and the compiler derives them from the first item. If
`items` is absent, the original equal-cell contract and shared base pair are
unchanged. Direct bundles validate every per-item resource and canvas, and the
runtime draws and hit-tests the same declared geometry.

`applyAppearanceBinding(targetBundle, imported, binding)` preserves target
resources and motion documents, adds only referenced layer bytes, and returns a
new validated bundle. Version 0.1 remains a compatibility validation format and
cannot be applied.

CheckBox maps explicit box and checked-mark layers. RadioGroup requires separate
option and indicator layers for every semantic option plus authored, non-overlapping
hit areas. Input uses one background while value, placeholder, password masking,
focus and IME behavior remain semantic runtime state. ProgressBar and Slider require
full-range fill layers clipped left-to-right; Slider drag projection uses explicit
thumb endpoints and the imported thumb must match the target's current value.

Image maps its exact layer into the portable source resource. Text validates an
exact text-layer rectangle while retaining semantic Pixi text. Container and
Panel accept explicit structural surfaces; Panel keeps its title dynamic.
ScrollView binds viewport and scrollbar templates while retaining clipping and
dynamic children. List and Tabs use explicit reusable row/tab templates with
item-local labels and hit areas. Dialog binds its structural surfaces and may
bind a full-canvas overlay only when the target is modal.

## Remaining integration

The upstream scene does not universally carry the original reference hash or
nine-slice insets. Ordinary text may have been removed by decomposition. The
adapter therefore cannot infer source registration, recreate missing text,
recover omitted control parts, or recover nine-slice settings from this ZIP.

Nine-slice metadata, multiple repeated-item visual variants and automatic
binding authoring remain future work. The one-file handoff removes manual file
coordination; it does not guess semantic component types, text, actions, states,
or layer roles.
Visual acceptance remains separate from deterministic compilation.

Offline executed evidence is recorded in [tasks.md](tasks.md). The repository
retains dated verification reports separately from the public release archive.
# Reference evidence v2

The importer also accepts `ai_ui_component_handoff_v2` / schemaVersion `2.0`.
It authenticates the original image, optional normalized derivatives, reference
state, scope and mapping before exposing evidence. V1 import remains compatible
but returns `referenceEvidence.status: missing_reference_evidence`, never readiness.
The official CLI accepts `--reference-output <new-file>` and always reports
reference readiness on stderr. Reference bytes remain separate from runtime bundle
resources. See the producer's `docs/reference-handoff-v2.md` for schema and
mapping order. The workbench API `replayReferenceState` restores observed fields,
including an explicitly opened Select; unknown state never becomes an observation.
Human visual acceptance remains false for v2.

Switch per-state textures: see [versioned state images v1](switch-state-images-v1.md).

Select popup per-option icon extension: [the sole v1.0 integration contract](select-option-icons-v1.md). Explicit optionId/layerId/layout; never infer from Choice labels.

List explicit parent-background mode: [List background policy 1.0](list-background-v1.md). Absence retains the legacy required background role.
