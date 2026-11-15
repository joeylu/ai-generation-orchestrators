# Offline paint / geometry study

`paint-geometry-study.mjs` is a pure synthetic arithmetic experiment. It has no
public package export, file/PNG input, provider transport, workflow mutation,
CLI or Studio integration. Its fixture receipt is synthetic test data and never
records a human art decision. A purpose marker is a scope assertion, not a
content detector or a security boundary for accepting real images.

It verifies continuous straight-RGBA alpha multiplication, zero RGB at final
alpha zero, preserved input buffers and explicit integer canvas placement.
It neither finds nor approves a contour, repairs appearance, handles resampling,
unpremultiplies provider pixels nor certifies reconstruction. An unresolved
geometry specification cannot pass even in this experiment.

Run the synthetic checks with:

```powershell
node --test tests/paint-geometry-study.test.mjs
```

Real artwork requires a separate reviewed alpha and paint/placement contract,
an authorized source plan and an implemented deterministic producer. This
experiment does not supply those contracts or authorize a real derivation.

`paint-geometry-proposal.mjs` compiles the next source/derivation **design** and
its geometry-guide and unchanged full-reference input fingerprints. It can render a grayscale geometry-only
paint guide and check prospective whole-canvas dimensions; it cannot generate,
normalize or mask real paint. Its receipts are design evidence, not execution
capabilities. The proposed opaque source, 8px paint-only halo and at most 1%
axis-ratio normalization still require separate design acceptance.

`native-contour-preview.mjs` is a separate source-native foreground cleanup
experiment. It rasterizes explicitly drafted polygons/strokes with 4×4 area
coverage, optionally constrains dark material inside the nominated branch
strokes, and computes flattened previews plus proposed module fingerprints.
It keeps the original crop/output mapping instead of refitting the reduced
foreground. This approximate, source-specific design does not recover optical
Alpha or supply an automatic semantic segmenter. It has no workflow, provider,
kit writer, public export or Studio mutation. Preview inputs may be real artwork;
its tests remain synthetic. See `tests/native-contour-preview.test.mjs`.
