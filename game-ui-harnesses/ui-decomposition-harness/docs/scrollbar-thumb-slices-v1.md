# Scrollbar thumb source-pixel slices

Use the sole [consumer contract](../../ui-component-harness/docs/scrollbar-thumb-slices-v1.md).
The author location is `bindings[].states.scrollView.scrollbarThumbSlices` with
`version: "1.0"`, `coordinateSpace: "thumb-source-pixels"`, `top` and `bottom`.
The exact fields are described by
[schema](../references/scrollbar-thumb-slices-v1.schema.json).

Measure fixed caps on the authenticated thumb PNG. Both distances are nonnegative
integers in original PNG pixels, and their sum must be strictly below its height.
Do not scale these numbers during registration. Valid `scrollbarInsets` remains
mandatory; it describes track geometry in different units. Preserve `parts`,
`thumbPositions`, actual content/viewport dimensions and proportional thumb sizing.
Reject unknown versions, extra fields, invalid caps or missing referenced assets.
An absent extension keeps legacy whole-image stretching; it does not prove that
ornament proportions were accepted. A PNG without a stretchable middle is an art
gap, not permission to invent a substitute.

The standard handoff validator checks shape and actual source-layer height. State
acceptance checks the consumed extension against its binding and renders expected
caps separately from the stretched center. Real input and evidence roundtrips are
still required. Keep original observations, including unknown scroll values, and
`human_visual_acceptance: false`.

For an existing authenticated ZIP, the offline command
`python -m ai_ui_decomposition.thumb_slices_handoff --help` applies a digest-bound
plan and calls the official consumer CLI before and after packaging. It changes
only the binding and affected handoff digest; all other ZIP members are preserved
byte-for-byte. Its export report is not visual approval. Publish to a fresh output
directory and run stateful/Studio acceptance separately. No media calls occur.

Skill Library r009 measurement: the 12 by 60 PNG has transparent rows 0–1 and
58–59, curved/highlight caps ending at row 5 and beginning at row 54, and a
stretchable straight middle [6,54). Its measured 6/6 parameters are sample-specific,
not defaults for other art. The original 874/850 content/viewport and 32/32 track
insets remain unchanged.
