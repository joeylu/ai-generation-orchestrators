# Isolated source frame guide

Use this optional local programmatic API when a correctly owned fixed group keeps
changing its internal proportions despite explicit named features. Diagnose
correspondence and relative geometry first. Do not split the group solely to fit
a distorted generated result, or turn it into a continuous background band merely
to obtain a second image input.

`previewSourceFrameGuide` renders a deterministic diagnostic image from the exact
accepted reference, the original sealed structure and any reviewed coordinate
correction. It does not segment, generate, complete or accept artwork. The full
original remains request image 1; the reviewed guide is image 2. This API is not
a new CLI command or Studio generation endpoint.

```js
const spec = {
  format: 'ai_scene_source_frame_guide_spec_v1',
  referenceRawSha256: structure.referenceRawSha256,
  referenceViewport: structure.viewport,
  instanceId: 'fixture.actual',
  frameWorld: {x: 32, y: 16, width: 192, height: 144},
  markerRadiusWorld: 1
};
const guide = previewSourceFrameGuide({
  spec, structure, correction, role: 'landmark', referenceBytes
});
// Inspect guide.bytes beside the exact original before making a review receipt.
// The receipt accepts guide.proposal.sha256, not artwork or compute.
const nextScope = withSourceFrameGuide(
  withSourceFraming(withReferenceFeatureCorrection(oldScope, correction)),
  {spec, decision: guideReviewReceipt}
);
// Freeze through the existing parent-bound source revision API.
```

Omit `correction` and `withReferenceFeatureCorrection` if there is no independently
reviewed coordinate error. Existing corrected source obligations must be retained.
For an initial batch, the same `sourceFrameGuide: {spec, decision}` may be supplied
in the selected `createLayerSourceScopes` override with the structure and framing.

Choose a frame around the complete owned group and its explicitly inferred hidden
or clipped continuation. Include all named features and enough contour/effect
space without prescribing a margin percentage. Review all visible owned masses;
the program only verifies the supplied points, not whether a frame contains an
unregistered mass. A frame may be smaller than the viewport. Outside-frame
original pixels remain available in image 1. Gray stripes indicate unobserved
reference reserve, not mandatory transparency or permission to invent neighbors.

Do not mark only the outermost points when an interior member divides the main
opening or carries another important occlusion. A guide can improve its marked
points while an unmarked internal member moves substantially. Register that
member's visible position before a future freeze, even if its function is uncertain.
Keep all original frozen structures and failed results; additional observations
diagnose the failure but do not amend an existing plan or grant acceptance.
An explicitly reviewed [feature supplement](reference-feature-supplement-v1.md)
may add those omitted observations for a new request. Pass it as `supplement`
when previewing the guide and as scope `featureSupplement` when compiling.
The original guide receipt cannot approve this different marked raster.

Coordinates use the reference's integer contain mapping, including separate
rounded resized width/height and offsets. The compiler compares this mapping
with the accepted target. Feature markers use original world targets (plus the
exact reviewed correction); marker radius is only a locator and may not exceed
the original feature tolerance. It never changes the fitting tolerance.

The guide applies to isolated landmark, scenery, foreground, backdrop or valley
sources with `complete-silhouette-v1`. Opaque sources, continuous bands, competing
second-image guides and mismatched instance IDs are rejected. It adds no painted
coverage requirement and no finite-cut Alpha exemption: all four source edges
retain the ordinary transparent contour check. It does not certify camera travel.

Freezing regenerates the exact reviewed guide from reference bytes. Reception and
input export replay the same artifacts. Changed pixels, structure, correction,
frame or review require a new exact plan; old plans remain unchanged. No compute
authorization transfers. Reserve before the single authorized dispatch, retain
failed/unknown outcomes, and record human art acceptance independently.

After reception, inspect ownership and real Alpha openings, measure homologous
features on the complete native PNG and run the existing v6 feature gate. The
actual PNG may differ from the diagnostic raster size; calibrate its actual native
coordinates. Guide approval and technical success do not establish compliance.

Offline regression: `tests/source-frame-guide.test.mjs` uses a synthetic asymmetric
industrial frame, not a scene-specific object list. It checks exact registration,
unobserved reserve, reviewed correction binding, two-input replay, new-plan
authorization, incompatible scopes and retained four-edge Alpha rejection.
