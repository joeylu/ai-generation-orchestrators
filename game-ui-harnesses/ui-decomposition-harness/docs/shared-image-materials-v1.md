# Shared native Image source 1.0

This producer capability lets a native delivery request generate one ordinary
Image material and reuse its exact processed pixels for other same-size Image
components. It does not infer that two pictures mean the same thing. The planner
must supply the source layer and explicit evidence for the equivalence.

Add `sharedSource` only to a material row that reuses another row:

```json
{
  "layerId": "coin-copy-a",
  "componentId": "coin-copy-a",
  "rect": [56, 16, 24, 24],
  "description": "Coin icon shown beside the second price",
  "groupId": "icons",
  "sharedSource": {
    "version": "1.0",
    "sourceLayerId": "coin-source",
    "evidence": "The reviewed reference shows the same coin symbol at both locations."
  }
}
```

The declaration has exactly `version`, `sourceLayerId`, and `evidence`. The source
must name another material row, and that row must be an ordinary `Image` without
its own `sharedSource`. This permits several instances to point directly to one
source while rejecting self-links, missing rows, chains and cycles. Source and
instance must both be `Image` components, have the same material width and height,
use the same `groupId`, and have no appearance state map. The background and
stateful component parts are not eligible. Different-sized instances remain
separate materials in this version.

The compiler excludes declared instances from individual requests and board slots.
The source row remains in its declared generation route, including a planned
component-family board. Each instance keeps its own `componentId`, `layerId`,
rectangle and appearance binding. Normal and sourced handoffs resolve the source
extraction once, copy it to each instance's own `materials/<layerId>.png` path,
and verify that the source and copied files have identical SHA-256 digests. A
`shared-material-map.json` records the direct links, supplied evidence and digest.
Sourced handoffs require inputs only for actual generation assets; shared instances
do not create additional source requirements.

The declaration records the planner's semantic claim. Matching hashes prove exact
pixel reuse after processing, but do not independently prove that the source
symbol is correct for every reference instance. A visual review remains separate.
