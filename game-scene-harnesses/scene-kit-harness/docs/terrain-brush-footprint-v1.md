# Terrain brush footprint preflight

Run this zero-generation check before full delivery when a design requires a
small paint span. Seven sources and opaque joining collars do not establish that
their physical dimensions suit one grid cell. The explicit policy belongs to
the design; there is no default claim that every terrain family fits one cell.
The edge delivery APIs accept the explicit optional `footprintPolicy` shown below.
When supplied to `buildTerrainEdgeDelivery` and `verifyTerrainEdgeDelivery`, the
same preflight runs from the received sources' original native frames before
coherent-base replay, material derivation, output creation and packaging. A pass
is saved in `evidence/terrain-brush-footprint.json` and bound by the candidate
report. Verification requires that same policy. Omitting it preserves historical
delivery behavior and bytes; old kits gain no retrospective qualification.

```js
import {reviewTerrainBrushKitFootprint} from 'ai-scene-kit-contracts';
const report = reviewTerrainBrushKitFootprint(handle, {
  minimumSpanCells: {width: 1, height: 1},
  maximumCornerTransitionCells: 1,
  minimumInteriorWidthCells: 0.25,
  minimumBottomRepeatCells: 1,
  requireFullPerimeter: true,
});
```

The report measures native corner transition depth, inward fade extent, the
compiler's half-span compression factor, the nominal interior remaining between
the two uncompressed collars, and bottom repeat length. It fingerprints the
complete supplied edge controls and explicit policy. `reviewTerrainBrushFootprint`
also accepts those controls directly for an early source-calibration study;
`requireTerrainBrushFootprint` throws on an exceeded declared budget.

Keep these budgets fixed while comparing replacement sources. A failure blocks
that design's claimed footprint; silently enlarging its minimum span is not a
repair. The preflight never resizes artwork, edits Alpha, changes a map or kit,
rejudges historical QA, or authorizes image compute. Its pass covers dimensions
only. Original-byte, source-scope, opaque-collar, full junction, actual painted
rock scale, whole-repeat composition and actual Studio checks remain required.
In particular, a smaller corner can still have a visible material seam or hump.
