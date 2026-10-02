# Offline revision of an existing candidate package

```
python game-ui-harnesses/ui-layer-harness/ui_layer.py revise-package --selection SELECTION.json --output NEW_DIRECTORY --viewer BUILT_VIEWER
```

This optional operation makes no image or model calls. It creates a new static
candidate from an exact existing `ui_layer_composition_v1` ZIP, replacing only
explicit foreground layers with receipt-replayed `reference-body-support-v1`
outputs from `register-materials`. It never resumes a failed job or authorizes
compute. Existing snapshots, receipts, attempts and quality decisions are read-only.

The selection has `kind: ui_package_layer_revision_v1`, `sourceArchive` and its
exact `sourceArchiveSha256`, a nonempty `replacements` array, `knownDifferences`
(portable strings), and optional bound `evidence` entries (`path`, `sha256`).
Each replacement uses these fields:

| Field | Binding |
|---|---|
| `materialId` | Existing foreground ID in the source package |
| `snapshot`, `snapshotDigest` | Verified frozen snapshot with the same reference, layer IDs/order and text/background policies |
| `preview`, `previewReportSha256` | Actual support registration preview and report |
| `job`, `requestId`, `sourceMaterialId` | Real received request from the same snapshot; source material ID must equal the replaced ID |
| `adaptationPolicy` | Optional; only `preserve` is accepted |

Coordinates and dimensions are read only from scoped support reports. Input
selections cannot provide replacement geometry, create/delete/rename layers,
change draw order, replace a background, or perform a new adaptation.
Output must be separate from every input file and source tree. Source file
inventories and bytes are checked before and after writing; additions are changes.

The program checks the original ZIP inventory and hashes, each PNG's RGBA
geometry, nonempty alpha, transparent foreground, opaque background and zero RGB
where alpha is zero. It recomposes the original layers and checks every preview
pixel before replacing anything. It retains all source review issues.

Each replacement verifies original authorization, submission, receipt, raw PNG,
snapshot and body evidence, then replays the existing deterministic support
transform. The replayed PNG digest and support geometry must equal the actual
registration preview. Untouched PNG bytes, layer attributes and reference bytes
remain exact. Composite pixels outside the union of old replacement canvases and
new support canvases must be unchanged. Changed evidence or any technical failure
ends the operation in a fresh directory; there is no fallback or retry of a
provider request.

Outputs include `delivery/ui-layers.zip`, independent PNGs, composition, manifest,
preview, and private `revision-provenance.json` and `result.json`. The result is
`candidate_revision_pending_visual_review`, with `humanVisualAcceptance: false`,
`replacementReceiptReplayPassed: true`, and `sourceReceiptReplayPassed: false`.
Unchanged layers are package-derived sources. This operation verifies their
archive identity and pixels; it does not verify or upgrade their original provider
lineage. Private source paths/digests stay outside the portable ZIP. Source issues
and this limitation remain in portable `review.json`.

This is a candidate revision route, not completion of the new automatic generation
DAG. It cannot convert an original strict failure into success or infer acceptance
of the whole revised image from earlier acceptance of one material.
