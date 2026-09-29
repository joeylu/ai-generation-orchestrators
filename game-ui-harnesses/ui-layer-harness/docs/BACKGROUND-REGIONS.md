# Explicit background edit regions

These optional offline operations freeze caller-supplied edit regions and apply an
opaque candidate background while preserving protected source pixels. They do not
generate images, identify UI automatically, authorize compute, resume an old DAG,
or produce a delivery package. Every candidate still requires visual review.

## Inputs and meaning

- Source: opaque 8-bit RGB/RGBA PNG and its SHA-256. Only EXIF orientation 1 is accepted
  (a missing tag means 1); no automatic rotation occurs for any input.
- Edit mask: same-size 8-bit grayscale PNG with only 0 and 255. Zero identifies
  protected pixels; 255 permits editing. Some protected pixels must remain.
- Blend mask: same-size 8-bit grayscale PNG. Its nonzero support must equal the
  edit mask, and at least one pixel must be 255. Values are proposal weights:
  0 preserves the source, 255 takes the proposal, intermediate values blend.
- Explicit background mode, text policy, and reason/evidence for the region.

Material bounding boxes are not segmentation masks. A caller may propose an edit
envelope using geometric evidence, but must review the actual source to cover UI,
shadows, glow, antialiasing and ordinary business text. Known background inside a
permitted envelope is also editable. Pixels outside it are not automatically
certified to be background. `scene-only` and `preserve-underlay` retain their
existing ownership semantics; freezing records the intended mode, not proof that
the supplied mask implements it. Business text may exist outside exported boxes.

Transition weights are explicit and frozen. No automatic feathering, mask growth,
color correction, resizing or registration occurs. The region preview is a
diagnostic overlay, not a corrected image or visual approval.

## CLI

```text
python game-ui-harnesses/ui-layer-harness/ui_layer.py freeze-background-region --source ORIGINAL.png --source-sha256 SOURCE_SHA --edit-mask EDIT.png --edit-mask-sha256 EDIT_SHA --blend-mask WEIGHTS.png --blend-mask-sha256 WEIGHTS_SHA --background-mode scene-only --text-policy remove-business-text --reason "Explicit source-based edit scope" --output NEW_REGION
python game-ui-harnesses/ui-layer-harness/ui_layer.py inspect-background-region --output NEW_REGION --region-digest REGION_DIGEST
python game-ui-harnesses/ui-layer-harness/ui_layer.py apply-background-region --region-plan NEW_REGION --region-digest REGION_DIGEST --source PROPOSAL.png --source-sha256 PROPOSAL_SHA --output NEW_CANDIDATE
```

`freeze-background-region` validates and snapshots the original, both masks and a
deterministic preview, then returns a digest-bound plan. Inspection revalidates
fixed schema/semantics, geometry, masks, file hashes and the derived preview.
`inspect-background-region` is read-only; its `--output` identifies an existing
plan. Application requires a fresh directory and a same-size opaque 8-bit RGB/RGBA proposal
with matching ICC, sRGB, gAMA and cHRM color metadata. The original PNG bytes and proposal bytes are
retained. Existing directories and source artifacts are never overwritten.

The blend operates on encoded RGB channel values with integer round-half-up:

```text
output = (source * (255 - weight) + proposal * weight + 127) // 255
```

This is not linear-light compositing. The operation uses 32-bit intermediates,
retains the source color profile, and checks protected pixels are bit-identical
and fully weighted pixels equal the proposal. Partial weights may retain source
UI; coverage and seam checks remain visual requirements.

## Evidence and limits

The plan and application reports bind input bytes and fixed transition semantics.
Application is `candidate_pending_visual_review`, with zero model/image calls,
`originalDagPromoted=false` and `humanVisualAcceptance=false`. Supplying a PNG does
not attest provider provenance or a successful generation receipt. The artifact
is not accepted by the existing package pipeline as an automatically approved
replacement, and cannot clear a stopped job.

A future generation experiment must separately freeze its actual inputs, prompt,
destination and call budget and obtain the applicable authorization. This module
does not assume a provider supports inpainting masks. A generated full canvas can
only be a proposal; deterministic application enforces the protected region.

Offline fixtures verify byte protection, weighting, geometry, transparency,
profile consistency and tamper rejection. They do not demonstrate UI removal,
seam-free reconstruction or the truth of hidden background content.
