# Shared-material curve and grid delivery

The explicit `world-material-grid-curve-boundary-v2` profile extends the v1 grid
prototype to existing authored curves and ordinary grid painting. It retains the
complete source scene, environments, platform skins, transforms and collisions.
Curve body triangles and contours derive from authored geometry. Their material uses the
same checked world field as the brush. Curve sides retain the material's original
lighting; the profile's bounded directional bands apply to grid boundaries only.

At a curve contact the grid's inward relief meets the exact author boundary.
The existing union compiler suppresses buried top strips and keeps the original
native cap depth and fixed body UV scale. The v2 path uses a bounded 64-world X
index for cap clipping, charged to the existing clip-work budget. It changes no
legacy union output or budget. Mixed patches remain unsupported and fail before
a successful delivery; fixed platform skins retain their separate appearance.

Create a profile with `createSharedTerrainFieldProfile(appearance, options)` and
`geometryProfile: SHARED_TERRAIN_UNION_PROFILE`. `appearance` must be the resolved
checked material, including its loop when present. Outline, surface rows and
lighting are explicit sample-specific design observations; do not copy another
theme's measured rows or pretend they were inferred automatically.

The v2 entry accepts measured v5 coherent kits as well as dense v6 kits. It
keeps each material at its checked density and replays the same collision, PNG,
and archive checks for both. The v1 prototype still requires the dense v6 input.

After the regular source workflow and checked kit assembly, use the public CLI:

```text
node scripts/scene.mjs terrain-deliver --root CHECKED_KIT --profile PROFILE_JSON --out NEW_DELIVERY
node scripts/scene.mjs terrain-verify --root CHECKED_KIT --profile PROFILE_JSON --out NEW_DELIVERY
```

The default map comes from the checked input kit. An optional `--document` selects
a validated author document belonging to that kit. Delivery preserves all original
PNG bytes in `kit/`, writes `delivery.json`, `scene-kit.zip` and a separately
reopenable `export/`. Verification replays the exact parent/profile/document,
checks original PNGs, collision identity, compiled output and portable ZIP.
Wrong profiles, mixed geometry and reused output paths fail explicitly. There is
no model call, provider endpoint, implicit retry or compute authorization.

This is a deterministic delivery stage. When using an existing checked kit,
identify its reused sources; do not describe it as a newly generated complete
sample. Keep historical v1 prototype reports and failed sources unchanged. A
delivery remains an art candidate (`productionKit:false`, independent final human
review), just like the coherent delivery contract. Technical end-to-end success
requires the full scene in actual Studio, pointer brush checks, reload, browser
download and independent import, in addition to file checks. A package pass alone
does not establish visual similarity or final human art acceptance.

## Placement checks, curve sides and body repeats

For a new reference-led candidate, choose `candidateReview: 'placement-required-v1'`
in the v2 profile settings. Supply `--placement` to both `terrain-deliver` and
`terrain-verify`. Each row names an `observationId`, an `instanceId`, the exact
compiled sprite `sourceSha256`, a native-pixel `sourceRegion` `[x,y,w,h]`, a
normalized `frameRegion` `[x,y,w,h]` in the default camera, and a
`minimumVisibleFraction` in `(0,1]`. Mark meaningful regions of required
landmarks, water or framing elements after viewing the actual sources. Choose
the screen bounds and thresholds from the reference before checking the output.

Use `framingPolicy: 'report-only'` on an observation when the author may crop,
move or resize the subject freely. The expected reference region and actual
viewport coverage are reported separately. The visibility threshold applies to
the part inside the viewport. A wholly off-screen feature reports `outside-frame`
with no in-frame visibility measurement. The original policy remains available
when the brief explicitly requires a fixed frame.

The check samples source alpha and the visible layer stack in the compiled
default camera, including actual opaque shared terrain triangles. It reports
framing and surviving alpha separately and attributes occlusion to foreground
layers. It supports sprite and shared field terrain, with nearest-pixel alpha
sampling, up to 16 observations and up to 16×16 samples per observation. It
does not identify objects inside the source region or measure color contrast.
When the placement check blocks, the candidate directory retains the compiled
kit inputs and `placement-review.json`, and delivery stops before export and
ZIP. A successful delivery binds the report to the author, compiled map and kit
digests. Verification replays both the calculation and the saved report.
Use `scene placement-review` to check an edited map again before presenting it.
Ordinary Studio saves and downloads remain editing operations.

Select `curveSideRelief: 'exposed-inset-v1'` when an authored curve has a visible
cut side. This uses the profile's existing outline seed, spacing and inset
budget. Only exposed lateral curve faces move inward. The top surface, base,
world edges, touching grid/curve sides and collision keep their author geometry.
Cap coverage is clipped to the rendered body. Treat the resulting silhouette as
designed geometry and inspect it at short spans, slopes and contacts.

For a body repeat defect, write measured `usableRows`, `overlapRows` and
`phaseCount` to a loop options file. `scene terrain-profile --root KIT --settings
SETTINGS_JSON --loop-options LOOP_JSON --out PROFILE_JSON` binds the derived body
digest and prints a before/after repeat diagnostic. Pass the same loop options
to delivery and verification. The existing source-pixel overlap algorithm works
with both supported measured densities in v2 and writes a separate body PNG.
Each output texel comes from the verified original body, and the rational world
period preserves the original sampling density. The diagnostic scans every
four-row window, including the wrap, so a narrow transition next to equal first
and last rows remains detectable. Broad natural bands can also score highly.
Inspect at least one full period in Studio before judging the material.

The placement receipt covers the declared samples and default camera. Capture
the actual Studio map again after material, layer or author changes and compare
it with the exact reference for contrast, depth, contacts and seams. Keep that
comparison and the user's final art decision separate from the placement receipt.
