# Observed geometry candidate revision

`ai_ui_layers.observed_geometry_revision` is an offline deterministic API. It
consumes genuine sealed `host_geometry_observation.verify_response` evidence
bound to each independent PNG in an authentic source ZIP. It does not call a
model, generate content, repair observations, or alter old strict body results.

Call `freeze(selection_path, fresh_output)` and then
`revise(frozen_directory, returned_digest, fresh_output, built_viewer_directory)`.
The selection JSON has exactly these fields:

```json
{
  "kind": "ui_observed_geometry_revision_v1",
  "sourceArchive": "local/source/ui-layers.zip",
  "sourceArchiveSha256": "<64 hexadecimal characters>",
  "fitPolicy": {"maximumResidualPixels": 32},
  "observations": [{
    "layerId": "independent-layer-id",
    "directory": "local/observations/items/000",
    "requestSha256": "<64 hexadecimal characters>",
    "resultSha256": "<64 hexadecimal characters>"
  }]
}
```

Optional typed `ui_verified_archive_material_edit_source_v1` overrides are
accepted only through the observation protocol's replayed edit-job proof. Their
native source dimensions and received bytes govern fitting. Original ZIP layer
identity, metadata, and reference remain bound. Edited sources cannot take the
unchanged archive-byte identity shortcut, even for an identity affine.

All selected evidence trees and source bytes are frozen and rechecked before and
after packaging. The observation protocol checks original archive identity,
request/response binding, an independent host reviewer assertion, and dispatch
and return evidence. Those assertions are not platform signatures.

Complete bodies use the four observed box corners. Partially occluded references
require at least three separated noncollinear actual visible point pairs, with
both body boxes null. Both paths fit a positive scalar least squares scale and
translation without rotation or independent axis scaling. Complete boxes are
centered by this fit. Every corner/point residual is reported. The explicit
candidate ceiling must be finite in [0, 128] pixels. The example's 32 pixels is an
explicit candidate tolerance, never the strict registration tolerance or a
quality pass. Residuals above the ceiling
retain the original layer with a reason. Material/style findings remain material
findings even when geometry is usable.

Landmarks also require a triangle with twice-area greater than 1 pixel squared
and all three pair distances at least 2 pixels, in both coordinate systems.
Reported source/target span and RMS residual describe fit conditioning and error;
padding size never substitutes for landmark spread.

The complete nonzero alpha extent (including alpha 1) selects storage bounds
only. It never selects the fit scale. Rendering uses uniform cubic resampling;
alpha is not pixel exact after resampling. Invisible RGB is zeroed on changed
images. The theoretical full alpha extent and the actual cubic filter support
must fit the original canvas. No clipping, thresholding, automatic shrink, or
clamped translation occurs. Unsupported geometry, outside support, and absent
observations retain original PNG bytes and placement. Exact identity fits also
retain original bytes. Cubic samples may quantize faint alpha during scaling;
the source bytes and alpha support remain in the archive-bound evidence.

PNG sources may be RGB or another PNG mode; deterministic processing converts
an in-memory copy to RGBA and reports `originalMode`, preserving native receipt
bytes. Foreground fitting retains the strict canvas support rule above.

For background roles only, a complete observation must explicitly report the
whole native source box `[0,0,width,height]` and whole original canvas target box.
That separate fixed candidate policy uses uniform contain scale and centered
translation, then extends the authentic opaque source edges to fill uncovered
canvas strips. It does not apply the foreground residual cutoff: it reports
corner residuals, `canvasAspectMismatch`, and `backgroundEdgePadding` for review.
Partial internal bodies cannot select this policy. Nonopaque backgrounds remain
unresolved. No source support is clipped, and no axis stretch occurs; edge
padding is explicitly derived material and does not restore missing content.

The existing validated archive reader, compositor, and deterministic package
writer produce `delivery/ui-layers.zip`. `revision-provenance.json` retains the
source manifest, source review, original archive digest and per-layer evidence.
Inherited review issues remain inside the new ZIP. Pixel exact recomposition and
unchanged layer byte identity are checked. All outputs remain pending human
review: strict body registration, whole automatic DAG, original DAG promotion,
and human visual acceptance are false. Historical blocked evidence is preserved.
The API revises geometry only; duplicated content and visual material defects
require separate observed ownership/content remediation.

Fixture tests cover faint alpha, visible landmarks, invalid/nonfinite geometry,
residual rejection, outside support, unresolved identity, unchanged PNG bytes,
sealed evidence mutation, deterministic ZIP replay and exact recomposition.
