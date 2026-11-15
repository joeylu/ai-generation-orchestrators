# Verified scenery addition

The opt-in `previewVerifiedSceneryAddition`, `buildVerifiedSceneryAddition` and
`verifyVerifiedSceneryAddition` functions add one already accepted scenery or
landmark source from a separate verified coherent candidate to an already
verified bridge-band variant. The original PNG, technical result, target
reference, style, material and baseline are replayed; the selected existing
layer must have the same parallax as the donor layer. Alternatively the caller
may supply `newLayer: {copyFromLayerId, zIndex}` with a new `layerId`; the new
layer copies an existing layer's parallax and rejects ID or depth collisions.
The caller supplies an explicit instance position and before/after relationships. Actual
compiled layer and node order must satisfy them.

The output preserves every previous module, compiled node and terrain collision,
and adds the independent scenery instance. The frozen proposal needs its own
review before build, and replay checks the complete fresh output and export.
This does not infer depth, correct a source, assess scene art or accept a final
delivery. A separate actual Studio and human visual review are still required.
