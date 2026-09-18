# Measured frame fit 1.0–1.2

## Protected row grid extension 1.2

For an already returned row whose mark size and divider position cannot both be
fitted by proportional-height 1.1, an explicitly reviewed `role:"row-frame"`
may use `version:"1.2"` and `resize.mode:"protected_grid"`. This is a bounded
producer transform of the same authenticated pixels, not new state artwork,
recoloring, automatic landmark detection or a consumer capability extension.

Keep the existing support SHA-256, support size and nonempty evidence. The resize
object has exactly `mode`, `scale`, `sourceX`, `sourceY`, `targetX`, `targetY`,
`markCell`, and `dividerColumn`. `scale:[numerator,denominator]` is a positive
integer rational at most one. First uniformly downsample the complete support
with LANCZOS. Raw support grid boundaries are mapped with Python's integer
`round`; reject any band that collapses. `sourceX/Y` and `targetX/Y` each have
5 through 12 strictly increasing integer boundaries, matching lengths per axis,
starting at zero and ending at the raw support or target **inner** size. Target
coordinates exclude the existing transparent target padding.

`markCell:[column,row]` selects one strictly interior cell containing the entire
reviewed mark, including its antialiasing halo. `dividerColumn` selects another
strictly interior column containing the complete divider stroke. The four corner
cells and mark cell must retain their uniformly scaled width and height exactly;
they are copied unchanged. The divider column must retain its scaled width.
Other cells may resample only within these explicit bands. The full grid tiles
the image: no omitted source region, patch replacement or painted fill is allowed.
Normalize transparent RGB and retain the declared outer padding.

Use only where all nonstretchable artwork fits those protected cells and the
remaining bands are inspected stretch-safe fill/edges. Document source support,
corner/mark/divider measurements, uniform scale and target registration before
processing. Do not choose a grid to clip a mark, erase an unwanted border or
hide a failed appearance. Texture stretching remains a declared difference;
the transform cannot restore missing colors, details, occlusion or reference Alpha.

The existing `measuredFrames` revision and sourced-handoff path carry this spec
without changing a frozen generation prompt or successful raw receipt. Source
identity, matte, separation, clipping, output geometry and runtime gates remain
mandatory. Review the assembled state before full browser acceptance. Tests use
procedural local fixtures and do not submit generation jobs. Versions 1.0 and
1.1 keep their existing behavior.

## Row-frame extension 1.1

An explicitly measured row may use `version: "1.1"`, `role: "row-frame"`,
`resize.mode: "height_then_nine_slice"`. Other fields and source pixel fingerprints
remain unchanged. The source is first proportionally resized to the target inner
height; measured insets scale by the same factor. Only the middle width then
changes. The full-height left and right bands preserve state marks without
nonuniform stretching. Declare sufficient end bands from actual pixels; this
does not automatically locate marks or claim exact reference geometry.
The original empty-frame 1.0 behavior is unchanged.
Version 1.1 also accepts `role: "empty-frame"` for empty Button surfaces using
the same proportional-height fitting. It never adds symbols or text.

Producer-only deterministic post-generation adaptation. Reuses `media.nine_slice`
and its `resize: {mode:"nine_slice",insets:[left,top,right,bottom]}` semantics.
Consumer schemas are unchanged. No implicit adaptation of icons or arbitrary art.

The existing board extraction revision CLI accepts `--measured-frames FILE`, a
mapping keyed by exact board asset ID:

```json
{
  "field": {
    "version": "1.0",
    "role": "empty-frame",
    "supportSha256": "<SHA-256 of normalized matte RGBA support bytes>",
    "supportSize": [897, 145],
    "resize": {"mode": "nine_slice", "insets": [24,24,24,24]},
    "evidence": "Measured corner and straight-edge regions of this exact source."
  }
}
```

Numbers are illustrative, not defaults. Measure after the existing explicit-key
matte and Alpha support crop. Insets are raw cropped support pixels, not reference
canvas positions or normalized fractions. All insets must be positive integers;
source and padded target must exceed opposing inset sums. Hash and size must match
the actual extracted support. The containing revision also binds raw PNG SHA-256.

Only content-gap extraction 1.1 supports this optional revision. Count, separation,
clipping, key-background, margins and row checks remain mandatory. Only named,
hash-verified empty frames bypass the whole-part aspect test. Other parts retain
uniform contain and aspect validation. Four corners remain unchanged; straight
edge bands and empty center resize through the existing nine-slice implementation.
The target retains its explicit transparent padding and zero RGB under zero Alpha.

Receipts record measurements, source windows, target size and output hashes. They
do not claim uniform scaling for nine-sliced parts. Source interpretation is caller
evidence, not automatic detection of ornaments, text or stretch-safe regions.
Hash validation does not prove that chosen insets protect every painted ornament.
Larger source border thickness/radius may remain visually different at target scale;
do not describe geometry adaptation as exact reference restoration.

The existing sourced handoff extractionRevision may carry `measuredFrames` with
the same mapping. It still requires a verified completed source result. A failed or
reserved generation cannot become a successful source merely by obtaining a
material-only revision. Historical frozen plans and rejected/failed records remain
unchanged. New generation still needs plan-bound authorization.

This is an after-generation measured revision, not a new unmeasured automatic
preflight bypass. A future automatic measurement stage needs its own documented
detector and conservative failure policy. Do not guess insets before artwork exists.

## Explicit receipt completion after an approved processing change

`revised_receive.receive` handles a known returned image still in `reserved` state,
after the user explicitly requests a measured processing revision. It verifies
adapter input bindings, the frozen strategy marker, the complete revision digest
and raw hash, then reproduces extraction from actual raw pixels into a fresh
directory. Only an identical revision digest permits the ordinary raw import.
It appends `processing-revision.json` with the approval and exact specification;
`originalPolicyPassed` stays false. It does not mutate old reports, policies or
prompt hashes, invoke media, or replay a rejected/indeterminate/received batch.

The sourced handoff requires the same explicit extractionRevision whenever this
record exists; omitting or substituting it fails. Material revision alone without
this explicit verified completion remains ineligible for normal source joining.
The raw receipt establishes returned bytes, not original geometry-policy success
or runtime/visual acceptance. Offline test: `test_revised_receive`.

Offline regression: test_frame_fit covers fixed corners, Alpha padding, source hash
and size rejection, insufficient target space, schema/role rejection, and selective
frame adaptation with unchanged icon processing.
