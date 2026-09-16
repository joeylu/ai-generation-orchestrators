# Mixed-size foreground gap extraction 1.2

Producer-only, explicitly planned extension of 1.1. Existing 1.0/1.1 behavior and
frozen strategies remain unchanged. Required policy:

```json
{
  "version": "1.2", "mode": "foreground-gap-row",
  "canvas_policy": "content-bounds", "target_padding": 2,
  "max_internal_gap_ratio": 0.05, "max_part_aspect_error": 0.35,
  "separation_basis": "mixed-height"
}
```

For neighboring observed support heights H1 and H2 and internal ratio r, the
minimum empty horizontal separation is
`max(2, floor(max(H1,H2)*r)+2, ceil(min(H1,H2)*r*4))`.
It exceeds the larger silhouette's internal grouping radius while sizing the
stronger margin to the smaller neighbor. Equal-height behavior remains as strict
as 1.1. Thresholds do not depend on the desired number of parts. Exact count,
aspect, key color, clipping and common row checks remain mandatory. No pixels
are erased or joined to obtain a passing count.

Old failed raw images require an explicit extraction revision, preserving the raw
SHA, original strategy and failed policy. Use the revised receive entry point;
never change an old policy or imply the original check passed. Geometry acceptance
does not establish semantic identity, shared source evidence or visual acceptance.

Expedition Supplies image board: ten parts have heights 102–238 px and actual
gaps 32–57 px. 1.1 requested 48 px beside the largest parts; 1.2 requires 21–22 px
for the mixed-size neighbors. Existing raw extraction passed without regeneration.
All ten generated parts remain recorded, including redundant coins. Reducing
future generation sources is a separate explicit shared-material plan change.
