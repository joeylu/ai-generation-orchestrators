# Explicit visual relations gate v1

`visualRelations` is an optional field inside the existing
`ui_visual_observations_v1` document. It records geometric relationships that
are readable in the source reference but were not covered by the text-owner,
frame-ownership and dialog checks. The checker is technical evidence only and
always returns `human_visual_acceptance: false`.

The public Python entry point is:

```python
from ai_ui_decomposition.visual_relations import check_visual_relations
report = check_visual_relations(consumed_bundle, observations["visualRelations"], inspection)
```

`consumed_bundle` is the fresh, officially imported bundle. `inspection` is the
actual `window.uiHarness.inspect()` result captured from that bundle. The
existing stateful capture binds this inspection to its screenshot and bundle
hash; call this gate with the same default inspection used by
`check_visual_observations`. The gate requires actual `nodes[].bounds`,
`nodes[].renderedTextBounds[]` and `paintRegions[]`; it never measures a
relationship from authored `layout` rectangles.

The plan has exactly this shape:

```json
{
  "kind": "ui_visual_relations_v1",
  "version": "1.0",
  "coordinateSpace": "runtime-world",
  "verticalGaps": [],
  "horizontalAlignments": [],
  "iconInsets": []
}
```

Every entry has a unique explicit `id` and nonempty `evidence` string. An entry
never names only an owner id and asks the checker to discover a related object.
Text references require `componentId`, the exact expected `text`, and an
explicit zero-based `textIndex` in that node's actual
`renderedTextBounds`. This makes duplicate or reordered labels fail closed.

Visual references have this form:

```json
{
  "kind": "paint-region-alpha",
  "componentId": "divider-image",
  "paintRegionIndex": 0,
  "asset": {
    "path": "divider.png",
    "sha256": "<bundle resource byte SHA-256>",
    "sourceRect": [0, 0, 256, 16],
    "alphaSha256": "<raw cropped alpha byte SHA-256>",
    "alphaThreshold": 1
  }
}
```

`paintRegionIndex` is the index in the actual inspection's regions having that
`componentId`. `path` must occur in the named node's known registered resource
fields (`props.source` or the public `props.appearance` image fields), and both
byte and cropped-alpha digests are checked against the consumed bundle.
`sourceRect` is an explicit pixel ROI in that PNG. The selected paint region is
the renderer rectangle for the complete PNG, so the checker retains the ROI's
nonzero source offset and maps its verified alpha support using the full
decoded image dimensions. It therefore checks the registered visible alpha
boundary, including transparent outer padding, instead of trusting a claimed
asset rectangle or a string found in a label.

The three relation arrays are:

```json
{
  "verticalGaps": [{
    "id": "divider-title-gap",
    "decoration": { "kind": "paint-region-alpha", "componentId": "divider-image",
      "paintRegionIndex": 0, "asset": { "path": "divider.png", "sha256": "...",
        "sourceRect": [0, 0, 256, 16], "alphaSha256": "...", "alphaThreshold": 1 } },
    "text": { "kind": "text", "componentId": "title", "textIndex": 0, "text": "EXPEDITION" },
    "order": "decoration_above_text",
    "minimumGap": 8,
    "evidence": "reference observation measured the divider-to-title gap"
  }],
  "horizontalAlignments": [{
    "id": "divider-title-center",
    "left": { "kind": "paint-region-alpha", "componentId": "divider-image",
      "paintRegionIndex": 0, "asset": { "path": "divider.png", "sha256": "...",
        "sourceRect": [0, 0, 256, 16], "alphaSha256": "...", "alphaThreshold": 1 } },
    "right": { "kind": "text", "componentId": "title", "textIndex": 0, "text": "EXPEDITION" },
    "alignment": "center",
    "tolerance": 1,
    "evidence": "reference centers the decoration and title"
  }],
  "iconInsets": [{
    "id": "button-icon-insets",
    "icon": { "kind": "paint-region-alpha", "componentId": "icon",
      "paintRegionIndex": 0, "asset": { "path": "icon.png", "sha256": "...",
        "sourceRect": [0, 0, 64, 64], "alphaSha256": "...", "alphaThreshold": 1 } },
    "owner": { "kind": "node", "componentId": "button" },
    "minimumInsets": { "top": 6, "right": 6, "bottom": 6, "left": 6 },
    "evidence": "reference shows visible icon support inset from the button surface"
  }]
}
```

For vertical gaps, `decoration_above_text` measures text top minus the
decoration visible-alpha bottom; `text_above_decoration` reverses those edges.
Horizontal alignment supports `left`, `center`, and `right`, compared with the
declared pixel `tolerance`. An endpoint may be a text reference, an actual
inspected node reference (`{"kind":"node","componentId":"region"}`), or a
verified-alpha paint-region reference. Icon insets compare the verified icon
visible box with an actual inspected owner node box, or with another explicitly
selected actual paint region when the owner is a raster surface. A paint-region
index is an explicit renderer-order selection; this gate does not infer which
part it represents from an id, image name, or visual appearance. Keep the
selected index and the runtime paint bounds in the technical report for review.

Typical integration is after the existing `check_visual_observations` checks
have loaded the same default inspection:

```python
relations = observations.get("visualRelations")
if relations is not None:
    relation_report = check_visual_relations(bundle, relations, inspection)
    write_json(output / "visual-relation-check.json", relation_report)
    require(relation_report["status"] == "passed", "VISUAL_RELATION_REJECTED")
```

The report is a diagnostic/technical gate. It does not OCR, identify arbitrary
painted ornaments, invent bounds, repair layout, alter resources, or establish
human visual acceptance. A missing optional `visualRelations` plan returns
`status: not_applicable`; a present malformed plan or unbound inspection fails
closed with a contract error.
