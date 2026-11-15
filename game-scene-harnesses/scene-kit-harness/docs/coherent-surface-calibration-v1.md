# Explicit author surface calibration

Accepted reference observations can contain steep stair edges closer than the
existing curve contract's 32-world control spacing. Do not drop points silently,
rewrite the accepted analysis, or weaken the curve/editor contract.

`createCoherentSurfaceCalibration(target, {calibrationId,
maximumDeviationWorld, surfaces, notes})` freezes an additive authoring decision.
Each surface row contains `surfaceId` and authored `{x,y}` points. It binds the
original target and all original surface observations, covers every ground
surface exactly once, preserves both endpoints, and checks the existing integer
point, spacing and bounds rules. The declared maximum vertical difference,
bounded to 32 world, compares the original and authored **linear control
polylines at their combined breakpoints**. This does not certify an exact Hermite
contour, recovered rock geometry, walkability or visual acceptance.

Supply `surfaceCalibration` explicitly to `createCoherentComposition`,
`createMeasuredCoherentComposition` or `createFeatureCoherentComposition`.
The absent-field behavior remains unchanged. Actual author curves still compile
through the existing slope, tessellation, work and editor constraints. Source
observations, named feature tolerances, material measurements and PNG bytes stay
unchanged. The terrain layout evidence distinguishes `observedPoints` from
`authoredPoints` and binds the calibration SHA. A `surface-review` based on that
composition retains the explicit calibration. New deliveries and portable replay
must independently check the complete composition. This is no image computation,
reference-feature correction, automatic art acceptance or permission to fill air
outside a bank's original horizontal endpoints.

For fractional world coordinates produced by reference scaling, explicitly opt
into `endpointPolicy: 'inward-integer-world-v1'`. This creates calibration v2:
the left endpoint uses `ceil(x)`, the right uses `floor(x)`, and their heights
round the original linear polyline at those new positions. Less than one world
unit is removed at each horizontal edge; no air becomes terrain. The deviation
bound is checked on the retained domain, including both new endpoints. Original
observations and the target digest remain unchanged in the evidence. This is an
authoring approximation, not recovered geometry. Without the option, v1 retains
its exact-endpoint behavior and bytes.
