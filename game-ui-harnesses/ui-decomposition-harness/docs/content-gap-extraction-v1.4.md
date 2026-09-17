# Verified key-gap separation 1.4

Explicit producer-only revision of 1.3. Keep all 1.3 fields and grid declarations;
set `version:"1.4"` and `separation_basis:"verified-key-gap"`. Old policies remain
unchanged. Native planning, strategy fingerprints, ingestion, extraction and
material-only revision receipts carry the new policy.

For each neighboring pair, let R be the larger allowed internal grouping radius
(observed support height times its declared local/global internal ratio). Require
at least `max(2, floor(R)+2)` empty columns between them. This ensures external
separation exceeds either permitted internal merge radius, without demanding the
old four-times-height margin. Exact declared group count/order, grid structure,
vertical overlap, aspect and canvas/cell clipping checks remain mandatory.

After choosing midpoint cuts, verify every pixel in the two full-height columns
straddling each cut is within RGB distance 45 of the declared #F808F8 key. Merely
falling below the foreground threshold is insufficient. No pixels are erased to
create gaps. Matte, Alpha and final visible geometry gates still run separately.
The algorithm validates the declared geometric partition, not arbitrary semantic
identity. Wrong source descriptions still require visual review.

Choose this policy before new generation. For already failed raw inputs, use the
explicit extraction revision entry in a fresh directory; never rewrite old
receipts or claim the original attempt passed. No automatic regeneration follows.

Skyport's Tabs raw has clear 29–44px external gaps, while its ALL grid has an 8px
internal gap. This version extracts its nine parts without changing image bytes.
The extracted tab bases still occupy only about 64–68% of target width because
their generated aspect differs. Successful segmentation is not complete visual
acceptance; measured empty-frame fitting is a separate declared operation.
