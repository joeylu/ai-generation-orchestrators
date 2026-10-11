# Declared layout correction candidates

`revise-layout-candidate` is an independent, zero-compute correction of an
already verified original-viewport archive. It reuses existing PNGs and writes a
fresh candidate. It never resumes a frozen run, edits its plan, performs a body
observation, invokes a model, or promotes an old failed state.

The diagnostic uniform contain fit can leave large gaps when generated artwork
has a different aspect ratio. Moving its outer box also cannot correct rows
drawn inside one panel or express a slider fill/knob junction. New diagnostic
exports therefore measure their rendered alpha proxy against the ownership
region and retain `PROXY_FIT_LEAVES_TARGET_GAPS` as a nonblocking layout warning
when any edge differs by more than one pixel. The thresholded extent remains a
geometric proxy, never a semantic body observation.

For a correction, declare a local JSON plan with these required fields:

```json
{
  "kind": "ui_declared_layout_revision_v1",
  "policy": "declared-edge-preserving-layout-candidate-v1",
  "sourceArchive": "previous/delivery/viewport-ui-layers.zip",
  "sourceArchiveSha256": "<verified archive SHA-256>",
  "originalReferenceSha256": "<original reference SHA-256>",
  "materials": [
    {
      "materialId": "panel",
      "mode": "frame",
      "targetBox": [30, 40, 110, 80],
      "measurementAlphaThreshold": 128
    }
  ],
  "constraints": [],
  "knownDifferences": ["Generated style remains pending visual review."]
}
```

Replace the hash placeholders with actual hashes. File paths resolve from the
working directory. Target boxes use integer, half-open left/top/right/bottom
coordinates in the original reference. Only foreground materials may change;
all unselected PNG bytes, including the background, retain their identity.

- `uniform` preserves aspect ratio for icons and circular knobs. Residual target
  gaps remain explicit; extra axis landmarks are forbidden.
- `frame` preserves uniformly scaled ends/corners and changes the middle bands
  to fit the declared edges. This explicitly overrides preserve sizing for this
  candidate only. It is suitable for declared panels, strips and control frames,
  and is not a default operation on arbitrary illustrations.
- Optional `xLandmarks` and `yLandmarks` are strictly monotone
  `[nativeSourceCoordinate, referenceCoordinate]` pairs inside the proxy and
  target. They can move integrated row dividers. They are declared
  correspondences, not model-certified body observations.
- Optional `sourceOverride: {"path": "native/panel.png", "sha256": "..."}`
  reuses a native source only when the original verified archive's program-owned
  `Placement diagnosis` evidence binds that material to the same source hash.
  An unrelated PNG is rejected. Without an override, the archived layer is used.
- Optional `receivedReplacement` replaces only the selected material with a
  source-bound cleanup/edit. It requires `jobDirectory`, `jobDigest`,
  `reviewDirectory`, `reviewRequestSha256` and `reviewResultSha256`. The edit
  must have a genuine received singleton result, one completed independent
  material review and a cleanup lineage whose original native SHA matches the
  verified archive. It cannot be combined with `sourceOverride`. All unselected
  layers retain their bytes and original-coordinate placement; old receipts,
  plans and failed runs remain unchanged. This does not assert visual acceptance.

Declare related edges with constraints such as:

```json
{
  "id": "fill-knob-junction",
  "a": {"materialId": "slider-fill", "edge": "right"},
  "b": {"materialId": "slider-knob", "edge": "centerX"},
  "expectedDelta": 0,
  "tolerancePixels": 1
}
```

Both materials must be corrected in the plan. Edges are `left`, `right`, `top`,
`bottom`, `centerX`, or `centerY`; both endpoints must use the same axis.
Constraints measure **post-render pixels** at each material's declared alpha
threshold, rather than assuming the requested target was achieved. A visual
constraint failure is retained in the result and package review without stopping
delivery. Invalid schemas, nonfinite/crossing anchors, changed source bytes,
unbound native replacements and unsafe output paths still fail.

```text
python ui_layer.py revise-layout-candidate --plan layout-plan.json --output new-candidate --viewer ../ui-component-harness/dist-layers
```

The new output must be outside the source archive/native-source/viewer
directories. Measurement thresholds never erase source alpha. Frame rendering
uses a premultiplied cubic mesh over the full source domain; resampling can
quantize alpha. Expanded storage retains off-viewport support, and the display
viewport remains the exact original reference size. The writer validates the
layer package, checksums and viewport pixel recomposition.

Outputs include `delivery/viewport-preview.png`, `delivery/viewport-ui-layers.zip`,
`original-before-after.png` (left to right), and local plan/provenance/result
files. Local paths stay outside the portable ZIP. The result is
`layout-candidate-pending-human-review`, with zero generation/model calls and
false body, material-review, full-DAG and human-acceptance claims. Existing
content, ownership and style findings remain pending. Fresh automation planning
must declare frame policies, internal landmarks and relational constraints before
using this candidate step; this command does not retrofit them into historical
plans or silently change the strict registration contract.
