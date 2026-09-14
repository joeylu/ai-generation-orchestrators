# Dialog composition extension v1

This additive extension uses existing Dialog appearance fields. Legacy bodies and
native scrims retain their previous behavior. Current consumers are required for
new packages; older strict consumers may explicitly reject these optional fields.

- appearance.body and the body appearance-binding role are optional. Omission
  means no second body surface is drawn or acquired. Background and header remain
  required. Do not bind two complete framed panels to satisfy a role count.
- Background uses its actual positioned layer rectangle inside the Dialog, like
  header/body. Source canvas is the component canvas normalized by registration
  scale. Parts must remain contained. No implicit repositioning or crop is used.
- Dialog.props.backdrop optionally declares {color: '#000000', opacity: 0.6} for
  the native full-canvas scrim. Color is #RGB/#RRGGBB and opacity is finite 0..1.
  It requires modal:true and cannot coexist with raster overlayImage. Absence
  preserves #10233F at 0.28. Raster overlay behavior is unchanged.
- Input blocking and visible compositing are independent checks. A native backdrop
  parameter is an authored proposal unless its exact value has source evidence.
- Runtime inspection exposes renderedTextBounds for own Pixi text primitives,
  including content, actual bounds and font metrics. This is not OCR, texture-font
  matching or proof of visibility through every occluder.

Offline regression: dialog-composition.test.ts covers old/new imports and invalid
backdrops; decomposition Dialog-single-frame fixture covers inset background,
optional body, 60% black source-over pixels, open/closed/reopened and modal input.
No media/model services are called.
