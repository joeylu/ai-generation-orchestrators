# Explicit visible material geometry preflight v1

`check_visible_material_geometry` is an optional producer-side gate for a
materialized image that is about to enter a UI package. It verifies one exact
image by its source SHA-256, measures visible alpha support, and checks only
geometry that the caller explicitly declares. It does not identify frames,
marks, ornaments, or text and does not repair or resize an asset.

```python
from pathlib import Path
from ai_ui_decomposition.visible_material_geometry import check_visible_material_geometry

report = check_visible_material_geometry(Path("assets/frame.png"), plan)
if report["status"] != "passed":
    raise ValueError("VISIBLE_MATERIAL_GEOMETRY_REJECTED")
```

The plan is bound to the exact PNG bytes and has this shape:

```json
{
  "kind": "ui_visible_material_geometry_v1",
  "version": "1.0",
  "materialId": "dialog-frame",
  "sourceSha256": "<lowercase PNG byte SHA-256>",
  "alphaThreshold": 1,
  "minimumOccupancy": {"width": 0.72},
  "expectedAlphaBounds": null,
  "imageWorldRect": null,
  "reservedRects": [],
  "textWorldRects": []
}
```

Declare at least one alpha assertion. `minimumOccupancy` may contain `width`,
`height`, or both, each from 0 through 1. The values measure the thresholded
alpha bounding box as a fraction of the complete PNG canvas. This catches a
visible frame whose PNG canvas is wide enough while its painted support is too
narrow. `expectedAlphaBounds` can be used instead, or in addition, when the
reviewed support is known in source pixels:

```json
"minimumOccupancy": null,
"expectedAlphaBounds": {
  "rect": [12, 8, 280, 96],
  "tolerance": [2, 2, 3, 3]
}
```

Both arrays use `[x, y, width, height]`; tolerance gives the maximum absolute
pixel delta for each corresponding value. Alpha bounds include pixels whose
alpha is at least `alphaThreshold`. An empty support or a failed assertion
returns `status: failed` with a stable issue code. Malformed plans, unreadable
images, and source digest mismatches raise `ContractError`.

Reserved rectangles support explicit ornament-to-text exclusion. Their
coordinates are source PNG pixels. Supply the exact image placement rectangle
in `runtime-world` coordinates and text world rectangles from the producer's
known layout calculation:

```json
"imageWorldRect": {"x": 100, "y": 50, "width": 40, "height": 40},
"reservedRects": [
  {"id": "selected-mark", "rect": [0, 0, 10, 20]}
],
"textWorldRects": [
  {"id": "selected-item-label", "rect": {"x": 120, "y": 55, "width": 80, "height": 20}}
]
```

The checker scales each reserved source rectangle across the full PNG canvas
using `imageWorldRect`, then reports any positive-area intersection with each
declared text rectangle. Touching edges pass. Rectangles must be positive,
finite and within the source image. Include only text rectangles that the
explicit reservation is meant to avoid; no semantic association is inferred.

The returned report includes the verified source digest, image size, threshold,
measured alpha bounds, checks and issues. The gate is technical evidence only
and returns `human_visual_acceptance: false`. It is designed to run after the
producer has materialized and fingerprinted a candidate image, before packaging
or publishing its bundle. A later runtime inspection can still use
`visual_relations` to check actual rendered alpha and text bounds against the
consumed package; the producer preflight does not replace that runtime check.
