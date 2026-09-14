# Scrollbar end insets v1 — consumer integration

Optional versioned extension on appearance binding 0.2:
`bindings[].states.scrollView.scrollbarInsets`:

```json
{"version":"1.0","top":34,"bottom":30}
```

Numbers above illustrate syntax only, not measured sample values. Producer must
measure the usable track boundaries from existing material. Values are distances
from the registered track top/bottom in target-component units, not absolute y.
Both distances must be finite and nonnegative; remaining height must be positive
and fit the full source thumb. Unknown versions and fields fail validation.

The compiler emits `props.appearance.scrollbarInsets` with the same fields, scaled
once to sourceCanvas units. Keep existing track/thumb parts and thumbPositions.
With insets present, thumbPositions.min.x supplies the thumb x coordinate; vertical
travel is derived from inset top, usable track height and proportional thumb height.
Legacy min/max declarations remain validated inside the track but their y travel
is superseded by the explicit inset policy. Without insets all legacy behavior
is preserved.

Thumb height = min(usableHeight, max(sourceThumbHeight,
usableHeight * min(1, viewportHeight/contentHeight))). No overflow means zero
travel and a full usable-height thumb. Small overflow creates real but small travel.
Insets preserve end decorations baked into the track; they do not add arrow
buttons, synthesize missing artwork, force short thumbs or create hidden content.

Save/reopen, resource packaging and replay retain the extension. Human visual
acceptance is unchanged. Producer schema/validation/stateful rendering/export must
adopt this exact versioned extension before claiming support. This consumer task
does not modify the inventory archive or guess its inset dimensions.

For the user-approved slight inventory scroll, retain the six existing items and
reduce the viewport slightly using measured/explicit new layout values. Update
viewport material geometry/binding coherently. Preserve unknown original scroll
reference fields and describe the runtime layout as a derived design adjustment.
