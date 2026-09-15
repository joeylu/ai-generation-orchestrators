# Button label lines 1.0

Optional extension at `bindings[].states.button.labelLines`. Keep the existing
`labelLayout` and background part. No change to Button input events or legacy
single-label packages. This is the sole contract for this feature.

```json
{
  "version":"1.0",
  "coordinateSpace":"target-component-local",
  "lines":[
    {"text":"返回","fontSize":32,"fontWeight":"bold","align":"center",
     "layout":{"x":16,"y":20,"width":326,"height":42}},
    {"text":"BACK","fontSize":20,"fontWeight":"normal","align":"center",
     "layout":{"x":16,"y":63,"width":326,"height":28}}
  ]
}
```

Numbers are an example for a 358×108 Button, not universal defaults. Each line
owns a finite positive font size and a nonoverlapping local rectangle inside the
target Button. Height must be at least fontSize×1.25. One to eight nonempty lines,
no embedded newline; joining texts with `\n` must exactly equal `Button.props.label`.
No inferred strings, automatic font shrinking, ellipsis, or baked text. A font
overflow at actual rendering throws TEXT_OVERFLOW instead of hiding the problem.

Font family and color inherit the Button style. `fontWeight` is normal|bold;
`align` is left|center|right. Text is centered vertically inside its rectangle.
Different rectangle y/height defines interline spacing. Font family recovery,
letter spacing, rich text and automatic translation are outside this extension.

The consumer preserves the same object at `props.appearance.labelLines`. Its
rectangles/font sizes are target-component units, so they are not divided by the
raster background registration scale. Background scaling and legacy labelLayout
retain their existing rules. A subsequently resized semantic Button must still
contain these explicit target rectangles or fail validation; line positions are
not inferred from the new size. Press/hover transforms apply to background and
all text together. Raster Button Text-child conflict remains rejected.

Wrong versions, unknown fields, missing properties, bad strings/styles, overflow
rectangles and overlapping line rectangles fail in binding and semantic import.
Omitting labelLines preserves old behavior. Official import, bundle save/reopen
and handoff reexport preserve all fields. Automated/runtime validation remains
distinct from human visual acceptance.
