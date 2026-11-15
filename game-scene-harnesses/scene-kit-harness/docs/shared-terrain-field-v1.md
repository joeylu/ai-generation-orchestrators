# Shared-material terrain prototype

`world-material-occupancy-boundary-v1` is an explicit experimental alternative
to native perimeter artwork for ordinary 64-world grid terrain. It is a working
compiler/profile and kit-upgrade API, not a completed production art workflow.
Historical native seven-source plans, source PNGs, reviews and kits retain their
original meaning. No source-generation or compute authorization is implied.

The profile binds the actual rendered body and cap PNG identities. The body uses
one fixed world UV field across all cells and disconnected components. An inward
geometric boundary has a maximum 16-world displacement and stable world noise;
every triangle is intersected with the original occupied-cell union. Shared
vertices handle convex, concave and diagonal contacts without filling true air.
The original logical cells and collision remain independent of this appearance.
The contour is designed geometry, not a recovered or repaired native silhouette.

The surface keeps the existing native cap UV depth through the explicitly
measured `world-body-native-lip-v1` interface. Optional bounded directional bands
sample the same body texture with the same world UVs. They modulate rendered
RGB, never rewrite source PNG colors or Alpha. CPU and Pixi consume the same
indexed meshes and band data. Raster interpolation may differ by one 8-bit
rounding step after retriangulation; this is separate from a texture phase jump.

Use `createSharedTerrainFieldProfile` against
`resolveTerrainMaterialAppearance(...)`, then `upgradeSharedTerrainFieldKit` and
`verifySharedTerrainFieldKit` in a fresh directory. The v4 kit's explicit
`terrainSharedField` excludes `terrainEdges`, `terrainBottomEdges`, rigid repeat
and native step-corner data. A checked material loop remains usable and replayed.
The upgrader retains the original PNG bytes, updates kit identities through the
deterministic program, preserves the 47-role inspection map, exports a portable
ZIP and independently reopens it. Its report always says `productionKit:false`.

Ordinary grid painting uses the existing compiler, command editor, persistence
and Studio. Fixed platform skins retain their separate appearance and are
excluded from this grid field. Curves and mixed patches are rejected rather
than silently converted. Large occupancy/triangle/clip work is bounded; no
partial geometry is returned as success. This prototype does not prove arbitrary
scene support, natural rock relief, sufficient material repeat quality or final
art acceptance. Review single/double cells, steps, holes and a complete repeat,
then actual Studio pointer gestures, reload and portable import separately.
