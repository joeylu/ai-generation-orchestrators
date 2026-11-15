# Exposed side termination

The optional `sideTerminationProfile: "exposed-side-only-v1"` on v6 terrain edges
limits native corner and side decoration to the actual exposed side interval.
It is intended for manufactured end trims that must stop where an adjoining
lower solid starts. It does not round an industrial corner or modify the solid.

The existing complete native source-over junction can retain a corner's painted
tail over supporting solid below the exposed interval. This remains the default
when the new field is absent. A package with the explicit profile suppresses that
supported tail and the associated material cutback below the interval. Original
PNG bytes, alpha, authored cells/curves and collision suggestions stay separate
and unchanged. Source-over overlap within the exposed side is retained.

For a new source delivery, opt in through the same field in the controls beside
`materialProfile: "union-world-body-local-surface-v1"`, `gridProfile`, `junctions`
and the four measured side/corner controls. The field requires the v6 union
material path; unknown values fail validation. Existing packages do not acquire
it implicitly. Adding it produces a distinct kit revision and delivery, with
independent replay and actual Studio evidence.

This profile controls geometric termination. It does not certify that generated
fascia depths, panel periods, light or colors match the body. Those remain source
calibration and visual-review concerns. It does not authorize image generation,
change source plans or add an editing-host generation endpoint.
