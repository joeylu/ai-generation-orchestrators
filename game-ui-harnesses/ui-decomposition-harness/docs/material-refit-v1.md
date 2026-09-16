# Explicit processed-material refit 1.0

Producer-only deterministic processing, not a consumer appearance extension or
media retry. `material_refit.prepare_refit` reads an authenticated processed run,
validates every source, writes fresh material outputs and a digest-bearing
`material-refit.json`, then invokes the normal materialized handoff producer.
Original source files, receipts and reference evidence are not overwritten.

Every recipe binds `version:1.0`, `operation`, `sourceSha256`, and nonempty `evidence`.

- `visible-frame-nine-slice`: exact observed `alphaBounds` (left/top/right/bottom),
  positive four-sided `insets` and `padding`. Trim only transparent outer canvas,
  protect measured corner/end bands and fit to the original target canvas. This
  is for explicitly inspected frames; protect any known end ornament in a fixed
  band. It is not suitable for stretching glyphs or pictograms.
- `monochrome-state-from-canonical`: `canonicalLayerId`, `canonicalSha256`,
  `paletteLayerId`, `paletteSha256`, and explicit source-pixel `paletteRect`
  (x/y/width/height). Canonical size must match; preserve its Alpha byte-for-byte.
  Sample median RGB only from that explicit, fully opaque, near-solid ROI (channel
  range at most12). The canonical opaque glyph must be approximately monochrome
  (5th–95th percentile channel spread at most48). No silhouette selection, palette
  inference or missing semantic art is performed. Multicolor artwork requires a
  different supported strategy. Distinct output is mandatory.

The second operation intentionally creates a **contract-derived solid-color
state**, not a recovery of an independently observed alternate silhouette or
texture. Record this distinction in state evidence and derivedTestStates. Do not
use it where the reference states differ in shape or multiple independent colors.
It is separate from `common_alpha_pair`, whose loss/IoU limits remain unchanged.

Before new generation, choose a canonical glyph and explicit supported palette
evidence for genuinely monochrome state families. Do not ask independent generated
states to have byte-identical Alpha. Existing independently generated images can
only use this route after an explicit derived-state decision and source inspection.

## Build-time visible geometry gate

`ui_handoff_build_plan_v1` optionally accepts `visibleMaterialGeometry:{path,sha256}`.
It points to `{kind:"ui_visible_material_geometry_plan_v1",version:"1.0",checks:[...]}`;
each check follows [visible-material geometry](visible-material-geometry-v1.md).
The materialId resolves to a verified processed asset. The build runs checks and
writes `visible-material-geometry.json` **before finalization or packaging**.
Any failed declared check rejects the build. Legacy plans without this field
retain their old behavior, not automatic visible-geometry coverage.

Use this gate for new empty frames and declared ornament reservations. Measure
visible support, not just PNG dimensions. Retain runtime visual/layout checks;
these explicit supplied rectangles cannot discover arbitrary painted ornaments
or substitute for actual rendered text bounds.

Native List itemContents checks also reject overlapping Image/Text child layouts
within each item before generation, matching the existing producer runtime gate.
Different items may naturally have identical item-local coordinates.
