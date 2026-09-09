# Legacy layered pilot compatibility

The Node-only adapter reads the historical
`experimental_ui_layered_export_delivery_v1` PSD pilot ZIP. It accepts its bounded
stored/deflate ZIP profile, verifies all 22 manifest entries, and retains both
documents' ordered PNG layers, positions, dimensions and source hashes.
It does not parse Photoshop layers, generate media, or invent current
`scene.json`/`delivery.json` receipts. Historical Photoshop checks remain source
evidence, not a new application or human-visual review.

This adapter is deliberately specific to the two-document r002 pilot profile.
Other archives are rejected rather than guessed. The browser's **拆分素材** ZIP
input continues to accept the current decomposition format. For this legacy
profile, perform the offline conversion first, then open its component bundle
through **打开已保存的方案**.

## Explicit conversion

Use a mapping JSON such as:

```json
{
  "documentId": "settings-reconstruction",
  "backgroundColor": "#FFFFFF",
  "buttons": [
    { "layerId": "cancel", "label": "取消" },
    { "layerId": "confirm", "label": "确定" },
    { "layerId": "close", "label": "关闭" }
  ]
}
```

```sh
node scripts/legacy-layered-case.mjs input.zip mapping.json new-delivery
```

The destination must not exist. The command emits `component.ui-bundle.json`,
`source-preview.png`, and a compilation report marked
`compiled_not_browser_validated`. A later browser check is separate evidence.
The declared root background color is used behind the layers; in the settings
case the original opaque base covers it completely. A transparent native-assets
document would expose that explicitly selected background.

Only explicitly mapped layers become Buttons. Unmapped layers stay Images,
including two complete toggle images and the base containing the dropdown.
PNG bytes are copied unchanged, with inherited layout coordinates. Buttons emit
activation events; cancellation, confirmation, navigation and settings changes
are not invented or wired automatically.

## Runtime fields

- `Button.props.backgroundImage` is an optional portable image source. The
  runtime stretches it to the explicit Button bounds and paints neither a
  procedural box nor a second synthetic label. `label` remains semantic data;
  explicit Text children retain their normal behavior. Without this property,
  existing Button rendering is unchanged.
- `Image.props.drawBackground: false` draws the image without a box beneath its
  alpha pixels. Omitting it retains the previous behavior.
- `Switch.props.appearance` optionally binds a full-canvas track image, a
  separate thumb image, the source canvas, and explicit off/on thumb positions.
  PixiJS scales both layers from that coordinate space and interpolates the
  thumb during a bound Change motion. Without the field, procedural Switch
  rendering is unchanged.
- `Select.props.appearance` optionally binds separate field, arrow and popup
  images plus explicit source canvases and label/arrow layouts. The selected
  label and popup option labels remain semantic text. Popup rows own their hit
  targets and update `selectedId`; without the field, procedural Select
  rendering is unchanged.

Texture resources participate in bundle validation, source loading, per-preview
ownership, export, restoration and teardown. Existing motion transforms apply
to textured Buttons. This direct Button texture path does not consume the
standalone appearance-binding JSON. Dropdown options, repeated-item skins and
nine-slice resizing are not implemented by this compatibility path.

## Executed real-case evidence

The supplied pilot ZIP, SHA-256
`5ffc5fe9700074553b44409657e134b81995bae70d0ab251095cddaa48c76da1`,
was converted locally without model calls. Its settings document contains six
layers: an opaque base, three Button layers, and two static toggle layers.

In Edge with software WebGL, all three Buttons were clicked separately under
Original, Playful, Premium and Corporate: 12 target-specific activations passed.
Every scheme exported and restored with the original resource bytes and exact
UI document. Teardown cleared the Studio resources and views.

For pixel validation the screenshot was captured at native 1536 × 1024 size,
with only CSS positioning/scaling adjusted for the capture. Against the source
composite, maximum channel difference was 1, alpha difference was 0, and 3,192
pixels differed; mean absolute channel difference was 0.000644525. This verifies
the rendering of the supplied reconstructed image, not its fidelity to an
earlier design reference. The source has approximate placement and baked text.

User artwork and generated case files remain in ignored local working output;
public regression tests use synthetic fixtures. Full automated regression is
recorded in the repository's historical verification evidence, which is not
part of the public release archive.

The subsequent local r003 case replaces both static toggle layers with live
raster-layered Switch nodes. Music and Sound each use separately registered
track/thumb PNGs, and both changed visual position after browser clicks. The
four scheme exports retained both resources and explicit endpoint geometry;
the browser acceptance recorded no provider calls or console errors. Generated
occlusion fill changes some track pixels and is not source-identical evidence.

The subsequent r004 case overlays the baked dropdown with a live Select. Its
field, arrow and three-row popup are portable RGBA resources. Edge acceptance
opened the popup, changed `quality-high` to `quality-medium`, and validated
Original, Playful, Premium and Corporate exports with all three Select resources.
The run recorded no provider calls or console errors. The hidden field surface
and popup artwork are generated pilot fills and are not source-identical evidence.
