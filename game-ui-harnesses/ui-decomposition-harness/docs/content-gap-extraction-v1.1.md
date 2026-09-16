# Content-based single-row extraction 1.1

Opt-in producer-only policy for component boards. Consumer fields do not change.
Version 1.0 remains unchanged, including its canvas-aspect and strict projection-count checks.
Use 1.1 explicitly in native `boardPolicies[groupId]` before freezing a new plan:

```json
{
  "version": "1.1",
  "mode": "foreground-gap-row",
  "canvas_policy": "content-bounds",
  "target_padding": 2,
  "max_internal_gap_ratio": 0.05,
  "max_part_aspect_error": 0.35
}
```

These values are a planning example, not a universal default or exact source observation.
No extra keys are accepted. Padding is an integer 1..16. Both ratios must be finite;
internal-gap ratio is 0..0.08 and per-part aspect error is 0..0.5.
Only `foreground-gap-row` supports 1.1. Pixel-cell and relative-cell plans are not upgraded.

## Deterministic rules

- The packing canvas remains guidance for a single horizontal row. Returned canvas
  aspect is not a rejection criterion; existing keyed pixel/resource limits remain.
- Explicit #F808F8 border evidence, full foreground margins and one-row alignment
  are mandatory. No foreground pixel is deleted or repainted to satisfy grouping.
- Horizontal projection runs may be grouped when their vertical ranges overlap
  and the gap is at most `floor(max(leftHeight,rightHeight) * max_internal_gap_ratio)`.
  The left range is the group already accumulated. This handles a small disconnected
  strap next to the main icon without basing the threshold on strap height alone.
- Group count must equal the frozen slot count. No search for a threshold that
  makes the count fit is performed. Missing, added or joined parts fail.
- Gaps within the group's vertical projection may be at most
  `floor(groupHeight * max_internal_gap_ratio)`. Larger separation fails as multiple rows.
- Neighboring groups need a gap of at least
  `max(2, ceil(max(groupHeights) * max_internal_gap_ratio * 4))`.
  Intermediate gaps are ambiguous and fail; small gaps cannot be silently treated
  as intentional component separators.
- Every grouped raw foreground bounding box is compared with that slot's padded
  target aspect, `(width-2*padding)/(height-2*padding)`. Relative aspect error must
  remain within the declared limit. Uniform contain fitting preserves proportions;
  it does not stretch a malformed component to pass.
- All original pixels inside each assigned window flow through existing explicit
  key removal, Alpha normalization and uniform fitting. Receipts include the
  policy, source windows, matte bounds, scale, offsets and result fingerprints.

Both file and provider ingestion run full 1.1 content extraction validation before
accepting the raw result or dispatching the next media request. Final extraction
repeats the same deterministic rules. Exact-size legacy ingestion is unchanged.
The native compiler includes a versioned content-gap prompt marker; the request
builder then requests ordered components with wide gutters instead of exact cell coordinates.

## Limits and history

Grouping establishes geometry, not semantic identity. Two similar-shaped items can
be reordered, or missing/additional shapes can cancel in count; model/material
review and actual state acceptance are still required. Subtle Alpha differences
between paired state icons are not certified by extraction. Ambiguous source art
must fail rather than be repaired by deleting details or inventing states.

Use the existing `board_extraction_revision` command for a separately requested,
hash-bound material-only check of an old raw result. Preserve the old strategy,
raw bytes, failed receipts and `human_visual_acceptance:false`. A revision of a
rejected raw does not authenticate a completed generation batch. The normal source
join still requires a completed source receipt; this feature does not bypass it.
New media needs a newly frozen, explicitly authorized plan; unused historical
budget does not become authorization for a changed strategy.

Offline coverage: `test_content_gap_board`, `test_foreground_gap_board`,
`test_relative_board`, and the native compiler prompt regression. Tests use local
procedural pixels and no image/model service.
