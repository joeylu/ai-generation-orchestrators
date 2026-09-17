# Explicit disconnected grid glyphs 1.3

Producer-only opt-in extension of 1.2. Never apply it silently to old strategies.
All 1.2 fields remain required; add `disconnected_glyphs`, for example:

```json
{
  "version": "1.3", "mode": "foreground-gap-row",
  "canvas_policy": "content-bounds", "target_padding": 2,
  "max_internal_gap_ratio": 0.08, "max_part_aspect_error": 0.5,
  "separation_basis": "mixed-height",
  "disconnected_glyphs": [{
    "asset_id": "category-grid-icon", "column_groups": 2, "row_groups": 2,
    "max_internal_gap_ratio": 0.15,
    "evidence": "Observed four tiles arranged as two disconnected columns."
  }]
}
```

Declare the observed glyph structure before freeze; the numbers above are not
defaults. IDs must resolve in this board. Each glyph declares exactly 2–4 column
groups after the existing baseline grouping and exactly 2–4 separated rows in
each column. Corresponding row intervals must overlap across columns. The
internal ratio must be greater than zero and no greater than 0.25. Nonempty
evidence is limited to 1000 characters and is audit data, not appended to the
generation prompt. Target width/height must be between 0.5 and 2.
This is a bounded grid-glyph profile, not arbitrary semantic segmentation.
Non-grid disconnected tools, letters and irregular symbols are unsupported.

The extractor consumes the exact declared count in fixed slot order. It neither
searches for a partition that passes nor deletes pixels to match the part count.
Missing/extra groups fail. Declared columns must overlap vertically and their
internal gaps must meet the per-glyph limit. The same local limit permits the
observed internal row gap. Unlisted slots retain the original global limit.
Old external separation, aspect, key, Alpha and clipping checks remain; external
gaps must additionally exceed adjacent glyph grouping radii. Geometry cannot
prove glyph identity: image review remains required. Even matching grid geometry
does not prove the strokes have the correct semantic owner. The existing
content-gap-v1.1 prompt marker remains the compatibility marker for content-bound
canvas processing; the complete 1.3 policy is bound by the strategy digest.

Native board policies, material ingestion, standalone extraction revisions and
material lineage carry this policy. For old failures use a fresh explicit
`board_extraction_revision` result; do not alter frozen prompts or receipts.
An extraction failure remains failed even if a later check reveals another issue.
No generation, successful delivery or human visual approval is implied.

Skyport's returned ALL icon has an 8px column gap over 68px height. The old 0.08
radius is 5px; an explicit 0.15 declaration groups its two columns. The same raw
then fails unchanged external separation checks. This is retained as a blocked
reuse assessment, not a passing material revision.
