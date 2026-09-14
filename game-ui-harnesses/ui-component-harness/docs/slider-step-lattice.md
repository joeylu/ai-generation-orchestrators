# Slider legal step lattice

No new fields. Pointer input and keyboard arrows/Home/End share snapSlider.
Preserve fractional min and scientific step. Final value is the last min+n*step
inside [min,max], even if max is off-step; keep max/step unchanged. Repeated
boundary input emits no extra change. Programmatic setValue still validates.
Unrepresentable values fail explicitly. Producer expectations match this rule.

runtime-state.test.ts and slider-lattice.spec.ts cover fractional origins,
non-aligned upper bounds and tiny scientific steps: actual Studio mouse/keyboard,
events, visible raster changes, saved bundle validation and reopen. No vertical
or range Slider is added.
