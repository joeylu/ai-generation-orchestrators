# Industrial material interface

An optional `surfaceInterface` on v6 union terrain edges gives the solid front
face one shared world material and reserves the local surface strip for the thin
walkway lip. It avoids overlaying a second broad fascia plate on only the exposed
columns of a connected wall. Historical kits without the field retain their
original source mapping and replay.

```json
{
  "surfaceInterface": {
    "profile": "world-body-native-lip-v1",
    "capSourceSha256": "SHA256_OF_CHECKED_CAP_FIELD",
    "capEndRow": 20,
    "fadeRows": 4
  },
  "rigidBodyRepeat": { "fromRow": 146, "toRow": 466 }
}
```

These example rows are observations for one source, not theme defaults. Both
options are explicit deterministic delivery controls and make no image request.
Select actual source rows for each material. The interface binds the exact cap
field checksum; its end/fade rows are within that field. Cap UV coordinates and
the original measured cap depth remain unchanged: only rendered coverage is
limited. Standalone curves use the same world body before and after touching a
grid region, so painting a connection does not change their material phase.

Measure the designed covering separately from the complete cap-to-body sample
window. The measured `capDepth` can include an attached rock shoulder as well
as the thin surface; using that full depth as local cover can create a broad
fascia over the shared world body. Choose the existing full-cap or native-lip
interface from the actual reference and source, with source-bound end/fade rows.
The example's 20 rows are not a universal default, and a thin lip is not required
for every material. Do not compress the complete cap UV depth or change colors
to conceal a mismatched transition; verify the chosen coverage in terrain
combinations and actual Studio before accepting it.

`rigidBodyRepeat` optionally selects a full-width half-open row interval from the
checked dense body field. It copies the retained RGBA samples unchanged into a
new PNG, with no blending, curved cut, horizontal shift, rotation or source
coordinate warp. The kit keeps the original body field and adds a replayable
`terrainRigidRepeat` record. The rational period and phase origin preserve the
input field's pixels per world unit. Every connected or separate owner shares
that single affine world mapping. It cannot be combined with `materialLoop`.

Rigid crop endpoints should follow real matching manufactured joints; successful
replay does not prove a visually seamless image. This crop is relative to the
validated derived body field, which may already include its original area
sampling and periodic collar. It does not claim every retained color came
directly from an unprocessed source pixel.

Narrow side trims still need measured opaque collars and original-alpha overlap.
The industrial interface does not repair incompatible side artwork or authorize
silhouette/alpha edits. New kits and Studio projects retain separate identities;
original source PNGs, author geometry, collision and historical projects remain
unchanged. Art acceptance stays separate from technical validation.

## Combination coverage and remaining roles

The native-lip/world-body rules cover ordinary painted grid solids and compatible
height curves, including steps, interior holes, narrow columns, bridges and
disconnected islands. The synthetic combination regression enumerates all 511
nonempty 3-by-3 occupancies and separately checks grid/curve contact in four
directions. These checks protect coverage, empty space, exposed vertical lengths
and material phase; they do not certify new artwork or every contour pixel.

Kits containing only north lip, left/right walls and left/right top corners have
no south-facing native rim. Their bridge undersides, hole ceilings and floating
slabs retain a straight body cut. The optional
[native bottom-edge contract](terrain-bottom-edges-v1.md) supplies three new
roles through an explicit source plan and measured delivery; rotating a top lip
is not an implied capability. The rigid terrain-skin platform is also a separate, isolated fixed
rectangle. Extending its footprint is rejected by `TERRAIN_SKIN_ISOLATION`; it
does not silently become a continuous painted solid.
