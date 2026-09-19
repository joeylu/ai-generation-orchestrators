# Declared visible support validation

A PNG canvas size does not establish the size of its artwork. For explicit
foreground support or keyed board extraction with target padding, processing
checks nonzero Alpha bounds against the expected width and height after removing
the declared insets. Each dimension allows 15% structural error or two pixels
of raster rounding, whichever is greater. This is not pixel-perfect acceptance.

`visible_support_geometry` reports canvasSize, alphaBounds, visibleSize,
allowedInsets, actualInsets, expectedVisibleSize and relativeSizeError. A mismatch
raises `VISIBLE_SUPPORT_SIZE_MISMATCH` in existing preflight/processing/recovery
paths. A 305x123 canvas with two-pixel padding expects 301x119 artwork;
301x90 artwork fails even though the file dimensions match.

No expected support is inferred for legacy canvas-only ordinary assets. Explicit
source-Alpha preservation retains its original geometry policy: faint distant
pixels may enlarge bounds and must not be erased to force a pass. Existing thin
control aspect checks still apply. Nonzero Alpha bounds do not recognize semantic
edges or distinguish glow from a border; visual review remains required.

Existing successful reports are not rewritten. Re-extraction under current code
can reject a previously accepted keyed material. Preserve old failures and publish
new inspection evidence separately. Never enlarge declared margins merely to hide
an observed mismatch. Intentional larger margins need actual reference/user basis.

Frame fitting is not automatic repair: reviewed corner bands may preserve corner
pixels but stretch interior texture and border runs. Do not promise preservation
of all artwork, or silently apply whole-image anisotropic scaling.
