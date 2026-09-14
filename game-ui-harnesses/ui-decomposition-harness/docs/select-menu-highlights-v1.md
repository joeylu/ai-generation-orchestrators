# Select menu highlight integration

The sole field contract is the consumer's
[select-menu-highlights-v1](../../ui-component-harness/docs/select-menu-highlights-v1.md).
Author only `bindings[].states.select.menuHighlights`, version1.0, together with
the existing `popupContentLayout`. No producer-specific alias or runtime field.

The producer validates exact fields, six-digit HEX, finite alpha in0..1,
nonnegative insets/radius, positive remaining row geometry, radius limits and
safe-area containment. It preserves explicit values verbatim in export, validates
the compiled runtime conversion during state acceptance and records them in the
state matrix. Missing fields are errors; absent extension preserves legacy behavior.

The state browser probes selected, selected+hover, unselected hover and pointer-out
using actual mouse movement. It compares unoccluded opaque menu cores with an
independent source-over calculation from the declared color/alpha and popup PNG.
Icon/text layout regions and the measured screenshot filter footprint are excluded
from this background-only check; existing icon/text checks remain active. This is
not a reference similarity score. A region with no measurable background pixels
fails explicitly rather than claiming visual evidence.

Planning profile: `Select/menu-highlights-v1`. This declares the implemented bounded
route, not sample acceptance or support by an arbitrary older consumer release.

Selected wins over hover even at alpha0. Neither background tints labels/icons.
The menu background image must not bake selected/hover bands into its pixels.
Colors come from explicit design intent/reference evidence, never automatic
luminance matching. Settings blue is an explicit derived design choice, not a
universal default or a newly observed original state. Keep original evidence and
human_visual_acceptance unchanged. Check the target consumer supports this
extension using official import before attempting a full delivery.
