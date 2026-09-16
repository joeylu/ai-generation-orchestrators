# Text geometry preflight 1.0

Producer-side visual observations may add `geometry` to an existing text entry:

```json
{"version":"1.0","referenceBounds":[350,372,245,110],"maxCenterOffset":[6,20],"widthRatio":[0.8,1.2],"evidence":"Measured or reviewed source extent; explicit system-font tolerance"}
```

Coordinates are runtime-world units after reference mapping. Values above describe
one example, not universal source measurements. Evidence must state the source
and the permitted typography difference. `region` remains a containment envelope;
`referenceBounds` is the independent source-relative target and must not be
replaced with current output bounds to make a failure pass.

The default-layout preflight uses the actual consumer `renderedTextBounds`, checks
horizontal/vertical center error and width relative to the source target, and
retains the existing font, text identity, visibility, overlap and containment
checks. These are runtime font layout bounds, not segmented glyph Alpha or OCR.
The checker cannot detect an incorrect source observation or arbitrary text baked
into an image. System-font differences can use explicit tolerances without
requiring pixel-identical typography.

`requiredTextGeometryIds` lists owners that must have geometry observations.
Missing declarations fail with `TEXT_GEOMETRY_MISSING`. Legacy observations remain
valid but the report lists their undeclared geometry coverage; their success must
not be presented as center/width verification.

The four-type delivery compiler accepts `observations.textGeometry`, an object
keyed by real Text/Button IDs with the geometry values above. Title and subtitle
roles require entries before compilation; other text may explicitly opt in.
The compiler emits the required IDs and geometry into visual observations, which
the existing real-browser default preflight executes before interaction checks.
No consumer schema change or model call is required.
