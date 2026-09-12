# Scrollbar end insets

Use the consumer's [scrollbar-insets-v1](../../ui-component-harness/docs/scrollbar-insets-v1.md)
contract verbatim. The producer schema is `references/scrollbar-insets-v1.schema.json`.
`bindings[].states.scrollView.scrollbarInsets` requires version `1.0` and finite,
nonnegative `top` and `bottom` distances from the registered track edges, in
target-component units. Remaining height must be positive and fit the source thumb.
Export validates the bound track/thumb layer dimensions after registration scale;
unknown versions, missing fields, unknown fields and invalid ranges fail explicitly.

Keep parts and thumbPositions. With explicit insets, the consumer uses min.x;
vertical travel comes from the usable track and real viewport/content ratio.
Stateful expectations and the default-state compositor share this calculation.
Legacy geometry remains unchanged when the extension is absent.

Measure ornaments in the actual verified PNG; example values are not presets.
Keep the frame and track at their authored dimensions. A user-approved shorter
viewport may crop its existing hidden viewport material using a recorded crop;
never stretch the outer frame, add items or invent contentHeight. Record this as
a derived layout in acceptance-scope; unknown reference offsets stay unknown.

`scroll-insets-studio-browser.mjs COMPONENT_ROOT ZIP NEW_OUTPUT COMPONENT_ID`
imports the full handoff into actual Studio and uses wheel, drag and keyboard.
It checks values, scroll events, visible child translation, thumb geometry and
boundary no-ops, and captures top/middle/bottom. Run both positive and zero-range
variants. This driver performs no setValue or provider calls.

Optional visualObservations.scrollViews entries bind componentId, viewportHeight,
contentHeight and scrollbarInsets to the measured/authorized layout and check
actual paint regions. This is scoped geometric evidence, not source-state recovery
or arbitrary ornament recognition. Human visual acceptance stays false.
