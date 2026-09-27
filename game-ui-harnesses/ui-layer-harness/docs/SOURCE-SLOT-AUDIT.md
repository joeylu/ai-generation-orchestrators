# Repeated-slot source audit (offline diagnostic)

`python -m ai_ui_layers.source_slot_audit` inspects one opaque reference PNG, a
frozen `placements.json`, and two or more explicitly identified empty slot boxes.
It makes no model, image-generation, extraction, plan-repair, or packaging call.
Run it with `PYTHONPATH=game-ui-harnesses/ui-layer-harness/src` and a fresh output
file:

```text
python -m ai_ui_layers.source_slot_audit --reference REFERENCE.png --placements SNAPSHOT/placements.json --specification EMPTY-SLOTS.json --output NEW-REPORT.json
```

The specification is `{ "kind": "ui_source_slot_audit_input_v1",
"emptySlotBoxes": [[left,top,right,bottom], [left,top,right,bottom]],
"borderPixels": 2 }`. Boxes are original-image, half-open integer pixel
coordinates. The program requires at least two distinct, nonoverlapping,
pixel-identical empty slots with one flat interior color. It searches around
each sufficiently small planned material for one exact copy of the slot frame.
It may infer a different flat interior color in an occupied slot. No fuzzy
frame match is accepted. Slot dimensions are limited to 8–128 pixels per side;
at most 16 empty examples are accepted.

The report binds the input and template digests and records exact-frame
matches, color-different interior pixels outside the planned crop, and pixels
touching the inner frame edge. A unique frame with a stable fill, no inner-edge
touch and no omitted different pixel is only
`candidate_requires_visual_review`. A frame mismatch, uncertain fill, ambiguous
location, touched inner edge or omitted pixel cannot become a candidate.

**This is not alpha extraction.** Pixels equal to the inferred fill might still
belong to the icon; a rendered count, overlay or background can hide original
pixels. The output has `sourceExtractionReady=false` for every material and
contains no PNG cutouts. It never changes M2/M3 findings, existing frozen work,
the strict generation path or the delivery gate. A future source-pixel route
would require reviewed ownership/occlusion evidence, an independently verified
alpha decision, and the ordinary per-layer and whole-composition quality checks.
