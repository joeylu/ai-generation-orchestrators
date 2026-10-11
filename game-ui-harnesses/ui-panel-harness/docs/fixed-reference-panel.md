# Fixed reference input

`fixed-reference-1` is an explicit-coordinate, read-only reference mode for a known SDK skin or externally specified layout that the flow compiler cannot represent. It is separate from numbered interactive PanelSpec versions. It does not infer positions from control names or an image and does not implement game behavior.

`createFixedReferenceBundle(spec, core)` (also dispatched by `createPanelBundle(spec, null, core)`) accepts exactly `panelSpecVersion`, `id`, `title`, `canvas`, `document`, and `provenance`. The document is a strict Component Schema0.2 tree. Only Container, Text, Button, Select and ProgressBar without resources, raster appearance, interactions or linkage state are accepted. Every visible box must fit the logical canvas. The spec records full source geometry and authorship.

The result declares `panelBundleVersion: fixed-reference-1`, compiler `fixed-reference-1.0.0`, target `reference-only`, no bindings/actions and no session. `validatePanelBundle` fully recreates it from its embedded spec and compares the whole envelope, including the component bundle. Modifying compiled positions, capabilities or hashes alone cannot pass. State, asset, catalog and compiler overrides are rejected.

This mode is for reference-image consumers through the public bundle validator. Flow editing, planning, composition, interactive sessions, static panel delivery and Unity export are not advertised for this version. Existing numbered versions keep their exact compiler behavior and fingerprints. It is not a published tagged SDK release until the ordinary release process explicitly includes it.
