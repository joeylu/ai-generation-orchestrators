# Native bottom edges and full perimeter sources

The optional `terrainBottomEdges` field extends a v4 kit with v6 union sides.
Three independently painted native sources finish an exposed underside:
`bottom-edge`, `left-bottom-corner` and `right-bottom-corner`. A bottom source
keeps the reference illumination and material scale. Top lips are never rotated
or mirrored to fabricate these roles. Existing kits without the field retain
their original compiled bytes and appearance.

## Source planning

The existing local terrain-edge planner accepts the explicit
`coverageProfile: "full-perimeter-v1"`. Natural sources use plan v33, policy v3
and batch v3; engineered-city sources use plan v34, policy v4 and batch v4.
The two input images remain the complete accepted reference and the checked
complete native material. Source PNGs require continuous transparency, complete
endpoints and four-sided empty gutters. New requests are bounded to 2048 per
dimension; old v29/v30 plans retain their original dimensions and digests.

New native-sized planning also accepts the explicit
`nativeSizeProfile: "bounded-native-4m-v1"` and
`renderEnvelopeProfile: "visible-alpha8-outward16-native-rgba-v1"` options.
These select v35/v36 and new policy/batch versions, bound each source to 4096
per dimension and 4,194,304 total pixels, and record actual transparent margins.
A complete subject with real transparent gutter on every side is required;
the preferred 12-percent gutter is reported honestly rather than asserted from
the prompt. The old v33/v34 requests and their 2048 tests remain unchanged.

New freely paintable terrain samples must plan the complete seven-role perimeter
by default. An intentionally fixed layout may document a narrower capability;
it must not be presented as an arbitrary brush kit with finished undersides.

New natural sources may additionally select
`naturalSurfaceProfile: "reference-defined-cover-v1"` with those native-size
options. This uses plan/request v37 and policy/batch/QA v7, taking cover from the
accepted reference/material/brief rather than defaulting to leaves or soil.
See [the natural cover contract](reference-defined-natural-cover-v1.md). Historical
natural and city requests remain unchanged.

A normal batch must contain either all three bottom roles for an existing-side
upgrade, or all seven side/top/bottom roles for a new complete perimeter. The
batch declares `coverage`, `expectedRoles`, `requestedRoles` and
`fullPerimeterComplete`. A replacement subset needs an explicit
`coverageIntent: "explicit-subset-replacement"`; it cannot claim full coverage.
Old four-source batches remain available as their original contract.

Freeze and review the accurate new plan before fresh single-use compute
confirmation. Preparing a plan never generates, authorizes or reserves an image.
Unknown or failed requests are terminal. Source PNG QA, native coordinate/scale
measurement, visual boundary fit and human art acceptance remain distinct.

## Portable kit contract

`terrainBottomEdges` uses format `ai_scene_terrain_bottom_edges_v1`, profile
`native-horizontal-bottom-union-v1` and a `sourceBinding` to the exact material
source and measured surface mapping. It contains `edge`, `leftCorner` and
`rightCorner` records with independent PNG checksums and explicit pixel sizes.

Every record has uniform `scale`, `boundaryY`, `innerY` and
`inboardBlend: {fromY,toY}`. Solid paint faces upward, so `innerY < boundaryY`.
The horizontal record adds `repeatX: {from,to}`. Corner records add `boundaryX`,
`innerX`, `wallStartY` and `stripStartX`. Their native inward widths must meet
the corresponding checked side width, and their bottom depth must meet the
horizontal record. Coordinates belong to each actual source; theme names and
previous-source pixel rows are not placement rules.

The validator checks PNG identity, distinct roles, transparent paint, uniform
scale without enlargement and original horizontal/vertical joining collars
of at least 250 alpha. Limits include a 2048-square source, 16 MiB per PNG,
64-world inward depth, 16-world visible outward extent and 8-world coverage
fade. Visible Alpha bounds, rather than transparent canvas size, determine the
outward limit. Missing roles, incompatible joins or stale material bindings fail
before delivery. Source RGBA is never repaired to pass these checks.

The explicit v2 kit format/profile additionally requires both native-size and
render-envelope markers above. It allows the bounded 4096/4M native source and
measures outward visible contour at Alpha 8 or above. Source Alpha 1 through 7
inside the render window remains visible; faint tails outside it may only be
clipped by the declared geometry window. Validation records native and visible
bounds, weak-tail pixel count, summed/max Alpha and affected directions, with
`sourcePixelsRemoved: 0`. Alpha 8 or above outside the fixed outward limit still
fails. V1 continues to use its original 2048 and all-nonzero-Alpha limits.

## Shared compiler and brush

The compiler derives south-facing exposure from the actual grid/curve union.
It subtracts buried contacts, coalesces positive-length shared intervals across
author owners and preserves point-contact separation, holes and independent
islands. The same function runs after paint, erase, movement, undo and redo.

Native horizontal paint finishes each exposed run. Lower corners are placed
only at actual convex endpoints; a concave endpoint joins the continuing side.
Short runs clip native geometry instead of squeezing source coordinates. All
mesh samples retain their original source UVs and uniform physical scale.

V2 horizontal repetition samples only the half-open `repeatX` central window.
Source end caps do not repeat inside a long rim; separate native corners own
the endpoints. The legacy v1 complete-source overlap remains unchanged.

The explicit v2 `junctionProfile: "native-bottom-endpoint-underlap-v1"` also
defines endpoint ownership. At a convex lower corner, its measured
`wallStartY` and the existing underlap retire the old side, including exterior
paint behind the new sloping silhouette. At a concave end, the existing side
continues upward with its original native source phase, intersected with real
support and limited to the bottom cutback band. It cannot become a new vertical
stub in the unchanged body above. Validation checks an additional upstream
three-column collar with Alpha at least 250 before accepting this profile;
missing native coverage fails rather than restarting phase or clamping paint.
Original side sources already counted by bundle validation are not charged a
second time against the source byte budget. Old v2 kits without the option
retain their exact previous compiled output.

The old rectangular body retreats only in a bounded render band protected by
the checked opaque collar and two-world underlap. This allows native transparent
recesses to expose the background. The body retains its fixed world material
mapping, including a rational repeat period and origin where supplied. Author
occupancy and collision suggestions are unchanged.

### Explicit original-solid body support

Unreleased source 0.90.0 adds the optional v2 field
`bodySupportProfile: "author-solid-world-body-v1"`. It requires the explicit
`junctionProfile: "native-bottom-adaptive-coverage-v2"`, native-size and
render-envelope markers; an unknown value, a v1 kit or another junction profile
is rejected. New seven-source controls use `controls.bottom.bodySupportProfile`;
the checked three-source upgrade uses the same bottom controls. Both serialize
the selection into `kit.terrainBottomEdges` and replay it on export/reopen.

This opt-in addresses native lower artwork whose transparent recess reaches
inside the author solid, where a uniform rectangular body cutback otherwise
reveals a hole through that solid. The compiler retains bounded original-solid
body support at actual exposed south boundaries, using the pre-side-trim body
triangles and their unchanged world UVs. Native lower sources still draw over
that support with their original continuous Alpha and physical scale. A recess
inside the author solid can reveal its existing body material; genuine air,
holes and exterior areas receive no added body. This does not repair native
Alpha, recover unseen rock, alter the exterior author shape, or change collision.

Existing v1/v2 kits without the field retain their original cutback and compiled
bytes. Source identities, collars, 16-world outward limits, native scales and
work/triangle budgets remain. The profile is a deterministic new delivery
choice, with no image call or automatic art acceptance; each source family still
needs full-combination and actual-Studio review.

Visible outward decoration is clipped against nearby solids and the local air
half-gap with a one-world central clearance. The report discloses half-gap,
occlusion and short-span clipping. It does not call a clipped outline an intact
reconstruction. Bounded segment, triangle, mesh and work budgets are checked
before large repeat allocations.

Studio exposes three checked bottom textures. Pixi and the deterministic CPU
renderer consume the same compiled source meshes and coverage, with no host
generation route or special per-theme painting code.

## Local delivery

For a new seven-source kit, `buildTerrainEdgeDelivery` accepts `controls.bottom`
in addition to the side controls. For an existing checked side candidate,
`buildTerrainBottomEdgeDelivery` / `verifyTerrainBottomEdgeDelivery` accept:

```js
{workflow, baseKitRoot, batchSha256, controls: {bottom}, output}
```

The upgrade verifies the original side candidate inventory, original source
plans/results/QA, controls, source bytes and dense material derivation. It keeps
all original sources and evidence, preserves existing native-lip/rigid/loop
configuration, and writes a new kit, author binding, export and independent
report. It never edits a live project or transfers visual acceptance. The CLI
commands are `terrain-edges.mjs deliver-bottom` and `verify-bottom`.

An actual tool result that violated only an old v33/v34 size request can be
proposed for a new, zero-image native-size preparation. The source must satisfy
the new explicit 4096/4M envelope and actual transparent margins. The exact
proposal binds the entire original PNG/RGBA, original failed QA, actual margins,
new standard and required render marker. Only its fresh human acceptance allows
adoption. Original failed entries remain failed. A new prepared child batch
references the unchanged unused authorization/request hashes; it grants no new
image calls and cannot be authorized again. The original failed batch remains
stopped. The CLI exposes `native-size-propose` and `native-size-adopt` over the
same generation APIs and checked exchange path.

## Evidence boundaries

Synthetic regressions cover native recess pixels, gap clearance, convex/concave
endpoints, body coordinates, source identity and resource gates. A second suite
uses different natural and city image dimensions, native scales, depths, Alpha
and silhouettes through the same complete compiler. Software WebGL tests cover
actual texture loading, pointer painting/erasing, undo, redo, refresh and export.
These prove shared behavior; actual generated artwork still needs measurement
and visual review for each source family.
