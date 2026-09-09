# PixiJS tree runtime

The default `/` page is the consumer studio (reference image, canvas, motion
comparison and export). The engineering workbench and `window.uiHarness`
integration API are served from `/workbench.html`. Both share this same runtime;
the CLI browser adapter resolves a root preview URL to the workbench.

The studio creates one preview normally or four independent previews during
comparison. Export reads the selected preview's current document and motion
system, with the original resource bytes and optional imported timeline. UI
scaling changes only the canvas display size; document geometry stays intact.
Reference uploads pass through the optional local vision bridge and strict
semantic compiler before a preview is created. Unresolved, unsupported, invalid
or unavailable recognition never falls back to Image/Button. Imported v0.2
bundles keep their existing structure without a new vision call. The studio does
not implicitly convert legacy bundles. Recognition remains an optional adapter
owned by the source workbench rather than the engine-neutral runtime.

`createTreePreview(host, onFatal)` is the browser adapter for a validated v0.2
`UiDocument`. Its public API exposes the canvas, tree loading, event
subscription, inspection, engine-neutral value mutations, zoom, temporary
motion, and teardown. The API does not return Pixi display objects.

## Loading and resources

`load(document, signal, imageResolver?, fontResolver?)` first validates and
clones the complete document. It resolves every unique image and explicit Text
`fontSource`, creates a detached candidate tree, and mounts it only after all
of that succeeds. A later load or `destroy()` invalidates the earlier load
generation. Cancellation, resource failure, a font failure, or a text overflow
therefore leaves the previously mounted tree intact.

The compiler checks Image regions against decoded facts. Direct runtime loads
repeat that check after their resolver decodes each image, so an out-of-bounds
crop cannot partially mount a tree.

The optional image resolver returns a decoded `HTMLImageElement`. The optional
font resolver returns the exact font bytes as an `ArrayBuffer`; this is useful
for a verified in-memory bundle. Without a font resolver the runtime performs
a bounded browser fetch. Fonts are loaded through `FontFace`, added only for
the candidate scope, and removed when the scope is released.

Each scope owns uncached Pixi textures. Image nodes and every raster part from
an applied appearance acquire a reference and release it when they are
destroyed. Multiple nodes pointing at the same source share the one decoded
texture; removing one node cannot invalidate the remaining sibling.
`destroyNode(id)` is provided for this lifecycle inspection and cannot remove
the document root.

## Text and visible controls

Text uses the document's exact `fontFamily`, `fontSize`, `fontWeight`, color,
pixel `lineHeight`, wrapping, and overflow policy. `clip` uses a Pixi mask,
`ellipsis` finds a fitting Unicode prefix, and `error` rejects a candidate that
does not fit its declared layout. A source font is never silently substituted
when its explicit loading request fails.

All document controls render with Pixi Graphics, Text, Sprite, and Container
objects. Button children remain separate Pixi children; if a Button has an
explicit Text child, its string label is not rendered again. Native DOM is used
only for a one-pixel invisible Input editor. Pixi draws the visible input while
the hidden editor supplies focus, keyboard input, paste, selection behavior,
and IME composition. It is removed during teardown.

Button, Switch, CheckBox, RadioGroup, Input, Select, ProgressBar, Slider, List, ScrollView,
Tabs, Dialog, Panel, Image, Text, and Container all have concrete Pixi
rendering. Select options are Pixi popup rows in a tree-scope overlay, so their
hit testing is not clipped by the Select base rectangle or covered by sibling
controls. ScrollView masks its content and supports wheel scrolling plus
mouse, pen, and touch drag scrolling. A drag commits on pointer release and
restores its starting position when cancelled. Raster ScrollViews also map
direct dragging of the authored scrollbar thumb to the complete scroll range. List has explicit
`text-row` layout. Tabs hide every
non-active content child. A modal Dialog blocks background handlers and draws a
Pixi overlay; it does not invent a dismiss action. Slider drag previews are
snapped to the inclusive document step lattice, commit on release, and restore
their original document value on cancellation.

A v0.2 appearance application re-authenticates the target bundle, imported ZIP,
and binding fingerprints. Missing or inconsistent roles, states, or geometry are
rejected. Image rebinds to an authenticated resource; Text uses its layer to
validate geometry while keeping semantic text and font rendering dynamic.
Container and Panel use explicit raster parts, and Panel keeps its title as
semantic text. This contract is portable; its current visual adapter and
acceptance evidence cover PixiJS only.

## Events, mutations, and inspection

Every event has an emitting `id`, `sourceId`, and `targetId`. For a RadioGroup,
Select, List, or Tabs the target is the chosen option, item, or tab; ordinary
controls use their own node ID for both. `source` records mouse, touch, pen,
keyboard, wheel, or programmatic control input. A listener exception is sent to
`onFatal` and cannot interrupt other listeners or teardown.

`setValue` validates the capability and value range before updating the cloned
document. `setEnabled` accepts only controls that declare `enabled`; disabled
controls do not start interactions. `setVisible` changes runtime visibility
without adding a non-contract field to the document. `getDocument()` validates
and returns a fresh engine-neutral snapshot of current contract values.
Dialog `open` is a contract value, so callers open or close it with
`setValue(dialogId, true|false)`; `setVisible` cannot override a closed Dialog.
Programmatic Slider and ScrollView values must already satisfy their document
range and step rules; they are rejected rather than coerced. Pointer and wheel
coordinates continue to clamp at their physical control bounds. `destroyNode`
first validates a candidate document without the node, then removes that node
from the live document and releases its subtree, so a later `getDocument()` or
bundle export cannot resurrect it. A referenced Tabs content child therefore
cannot be destroyed.
`inspect()` returns current node bounds, effective visibility, enabled state,
values, resource count, mounted instance count, and the number of native
listeners owned by this adapter.

`applyMotion(id, values)` applies offsets/multipliers to the Pixi view only:
`x` and `y` are offsets from the document layout, alpha multiplies the normal
component opacity, scale is a positive multiplier, and rotation is radians.
`resetMotion()` returns all views to their document geometry. Neither method
changes `getDocument()`.

## Interactive styles

`setMotionSystem(system|null)` validates bindings against the mounted tree and
replaces the previous system atomically after validation. It resets presentation
and cancels scheduled channels. Attachment does not automatically play entrance.
`getMotionSystem()` returns a clone; removal of a node prunes affected bindings.
`playMotionAction(id,action)` previews a bound action without committing state
or changing host visibility. `inspectMotionSystem()` exposes profile, binding
identity, scheduler state and numerical presentation for acceptance.

Playful, Premium and Corporate provide press/hover, selection, focus, value,
scroll, popup/dialog and tab transitions according to each type's action set.
Logical state changes immediately; separate presentation follows it. Generated
parts are owned by Pixi and never become synthetic contract targets. System
feedback scales around the layout center without shrinking its logical input
rectangle. A separate timeline may transform that logical view concurrently.

Clearing, hiding or disabling cancels affected channels and restores current
state. Hiding an ancestor also cancels descendants; unrelated control gestures
keep their ownership. Destruction cancels work before releasing visual objects.
Dialog close retains its stable modal blocker through the panel's closing
transition. Interrupted closure must finalize teardown when a system is cleared.

See the [16-type matrix](../skills/ui-motion/references/component-coverage.md)
and [versioned profiles](../skills/ui-motion/references/motion-system.md).
