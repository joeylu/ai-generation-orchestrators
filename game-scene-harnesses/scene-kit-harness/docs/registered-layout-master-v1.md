# Registered layout master edits

Use this optional source mode when a reviewed, opaque background master already
preserves reference composition in a known full native frame. It separates
selective depth-layer editing from reframing/outpainting. It does not produce or
certify that master, segment an image, or establish final artwork acceptance.

Import the exact PNG through the workflow image importer. Preview
ai_scene_band_master_edit_spec_v1 with previewRegisteredMasterGuide (or the
master branch of previewBandCompositionGuide), supplying masterBytes.
The spec binds referenceRawSha256, the unchanged referenceStructureSha256,
referenceViewport, master: {artifact,positionWorld,sourceToWorld} and
features: [{featureId,description,native:{x:[min,max],y:[min,max]},
target:{x:[min,max],y:[min,max]}}].

The descriptor checks one uniform full-frame placement against the existing
band coverage frame and feature intervals. Actual preview/compilation additionally
reads the PNG, verifies its fingerprint, byte count, native dimensions, opaque
Alpha and varied content. Review the exact input and sealed proposal; bind an
accept receipt to that proposal. Keep the original structure's feature IDs,
descriptions and world tolerances. The same source declares matching
bandFeatureRelations.

Pass this spec/decision through bandCompositionGuide on a new source scope.
The plan sends **one** image with role
registered-background-layout-master-edit-target; the original accepted
reference remains archived and bound as reference evidence. It is not sent as a
second competing edit input. Master creation provenance and semantic registration
remain explicit reviewed evidence, not attestations inferred from checksums.
Every changed request still requires a fresh exact-plan compute decision and
single-use reservation.

For a technically passing transparent band that already owns the correct
content, `instructionProfile: 'transparent-local-feature-edit-v1'` uses its
exact native PNG as the single edit input. The plan must revise the same
source, bind the parent's PNG and technical image record, and retain its band
contract. Supply an interior `editRegion` with integer `x`, `y`, `width` and
`height` in the original pixel frame. Keep both the current and intended
location of the feature in the region, with room to blend. Supply the intended
native feature intervals and their original world tolerances. Check that the
unchanged parts still fit under the planned uniform placement. The original
reference and structure remain bound as evidence.

The region is prompt guidance. Review the exact PNG, region and proposed
placement before freezing. The reception check requires the original canvas
dimensions and fresh output bytes. Compare the actual result to the parent
inside and outside the region. Confirm that unedited forms and real openings
still read correctly, then replay feature, relation and camera checks. Keep
the previous PNG and its review intact. Intermediate input review and source
and final art acceptance each retain their own records.

For a local edit rejected solely for `REGISTERED_LOCAL_EDIT_SIZE`,
`proposeCoherentNativeFrame` checks a one-pixel difference on one axis. It
reuses the exact returned PNG, recomputes all other technical checks and
requires full native-frame coverage. Supply the original-source feature IDs
with measured normalized `x` and `y` intervals and the intended uniform
placement. The new reports check the original world boxes and the original
relative distances, converted from the frozen input frame to world units.
The original edit report still evaluates the frozen output frame.

After reviewing the exact proposal, use `adoptCoherentNativeFrame` with an
acceptance receipt for its digest, a new preparation ID and batch ID. Candidate
delivery binds the preparation and its reviewed placement to the same PNG.
Use `reviewCoherentBandGuide` and `reviewCoherentBandRelations` with the
preparation's plan digest and its observed intervals. The original rejection
and previously unused batch authorizations remain available in the workflow.

Choose topology from the actual artwork:

- A continuous painted canyon may encode depth with pale atmosphere on and
  between overlapping rock forms. Existing background-band-coverage-v3 retains
  that owned depth painting below its natural contour. It must not dehaze the
  source or reinterpret all low-contrast regions as transparent holes.
- Use background-band-open-depth-v4 when there are actual source-owned
  openings/air routes. Preserve those transparent regions; never fill a real
  opening with another layer's sky, earth or an opaque atmosphere sheet.
- The optional spec field instructionProfile: 'owned-surface-continuation-v2'
  clarifies retention of the declared lower/side masses through their finite
  cuts. It also distinguishes an owned distant skyline from a separately painted
  sky/horizon sheet. Absent-field requests retain their original bytes.

These are alternate source contracts, not post-generation Alpha repairs.
An opaque master is an editing input, not a substitute final background or proof
that independently placeable depth layers exist.

Before freezing native feature boxes, inspect enlarged crops of the **actual
master**, including low-contrast crests and the exact named tip/corner. Do not
derive all native boxes solely by projecting approximate world target centers.
Check that measured native intervals and original world tolerances admit one
uniform placement of the full frame. An occlusion boundary is not automatically a
physical endpoint; missing or uncertain correspondence blocks review.

After reception, inspect continuous-Alpha fixed-surround previews, measure the
actual source, and run both original guide and relation reviews. Recalibrate the
actual full native dimensions without padding/resampling if the model returned a
different canvas size. Candidate validation still checks the entire observed
interval at the actual placement, original world targets, v6 reference structure,
camera/Alpha ranges, ownership and independent recomposition. A source can pass
technical PNG checks while failing any of these reviews.

Never relabel an old blocked guide as passed, edit its evidence, widen original
world tolerances, or reuse its intent. A revised guide needs a new proposal/plan.
Reuse unchanged accepted sources and terrain evidence; stop downstream work on a
failed or unknown new source. This mode does not guarantee model compliance,
2px/world density, arbitrary camera motion, Studio quality or human acceptance.
