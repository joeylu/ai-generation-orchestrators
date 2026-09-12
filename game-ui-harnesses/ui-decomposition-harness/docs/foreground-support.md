# Foreground support geometry

Generated isolated assets without nine-slice resizing may optionally declare
`foreground_support: {insets: [left, top, right, bottom], basis, note}`.
Insets are nonnegative integer pixels in the requested output canvas and must
leave positive support width and height. `basis` is `reference-observed`,
`reference-derived`, or `user-confirmed`; `note` must explain the source evidence.
This metadata is frozen into the plan digest and does not authorize generation.

The long-control geometry check compares actual nonzero-alpha support aspect
ratio with the canvas minus these insets. Its existing 15% tolerance remains.
Without this optional field, existing canvas-based behavior is unchanged.
The field changes neither matte pixels nor uniform containment, and does not
stretch an invalid bar or establish human visual acceptance. Insets describe
expected support dimensions, not a pixel-exact placement test.

For example, a reference-derived full-range fill in a 278×18 canvas may have
14 pixel visible height (`[0,2,0,2]`). A 278×15 result differs by 6.67% and passes;
a 278×10 result differs by 40% and fails. The evidence must describe the
reference measurement and any full-range derivation rather than fitting the
contract to arbitrary generated shapes. Existing received raw results may be
officially reused in a new frozen plan when generation semantics are identical.
