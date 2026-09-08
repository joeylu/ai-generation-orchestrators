# Engine adapter semantics: timelines and interaction systems

The current implementation has one renderer adapter: PixiJS, with this package's
locked v8 dependency. Engine-neutral validation, recipe expansion and sampling
run without PixiJS or DOM imports. Other engines need both a UI contract adapter
and a motion/event adapter; a Skill is not a substitute for either.

## Portable timeline mapping

| Contract value | Required mapping |
| --- | --- |
| Time | Explicit milliseconds; monotonic clock and cancelable callbacks using the same epoch |
| x, y | Local logical-pixel offsets added to canonical layout; +x right, +y down; do not write into layout |
| scaleX, scaleY | Factors relative to unit local scale, not increments per frame |
| rotation | Radians about the local top-left origin; clockwise in the y-down coordinate system |
| alpha | Multiplies base/style and enabled-state opacity; does not alter visibility or input |
| linear | p |
| ease-out | 1 - (1 - p)^3 |
| ease-in-out | p*p*(3 - 2*p) |
| p | clamp((time - start) / duration, 0, 1) |

A native easing with the same name may use a different curve. Reuse
`sampleMotion` or reproduce these formulas rather than relying on that name.
Unity/Cocos coordinate origins, angle units and canvas scale would require
explicit conversion. This document does not supply those implementations.

The pulse recipe preserves the **layout rectangle's center** by emitting x/y
compensation together with scale: x = width*(1-scaleX)/2, y = height*(1-scaleY)/2.
It does not change the pivot or infer the visible artwork's center. All four
tracks share their easing. Composing other x/y/scale tracks at the same times
will fail overlap validation; concurrent rotation is not a centered pulse.

## Execution and lifecycle

`MotionTarget.applyMotion(id, values)` applies an absolute temporary sample;
reapplying a sample must not accumulate motion. `resetMotion()` restores base
layout, unit scale, zero rotation and current base alpha. Base state changes must
remain authoritative. Ancestor transforms and opacity affect descendants.

The current `MotionPlayer` resets the entire target before every sample. Give
one player ownership of that target and compose compatible tracks into it.
Independent players on the same target need a future property ownership/mixing
layer. Completed motion retains its terminal sample; stop restores base state.

The host binds manual/activate/change intent to playback. Event matching uses
the control node's ID, not an option/item/tab ID. Pointer, keyboard, focus, input,
cancel, disabled, modal and visibility rules remain with the UI state machine.
Current timelines have no press/release/cancel/focus/scroll/show/hide triggers.
They contain no business callbacks or native object references.

## Interaction-system mapping

The interaction system adds an independent presentation layer. It owns
press/hover/entry scales and component-specific markers, fill, popup and panel
presentation; authoritative state and legacy timeline transforms retain their
own ownership. Use the same validated profiles and action registry.

`MotionAnimator` accepts an injected `MotionClock` and absolute numeric values.
It shares one pending frame among concurrent channels; replacement affects only
the matching key. Retarget from current presentation. Cancel work before target
destruction and restore to current committed state on clear/disable/hide.
Spring uses the normalized damped response in `motion-system.ts` (damping 7.5,
angular frequency 11), not a native engine's similarly named curve. Exact step
endpoints are applied; alpha, checked and progress presentation are clamped to
[0,1] in the adapter. Do not put spring into legacy timeline JSON.

The Pixi system keeps a stable logical input rectangle outside its feedback
scale, maps Slider coordinates through inverse transforms, and separates a
Dialog's animated panel from its full-canvas modal blocker. A closing Dialog
retains blocking until the visual close ends. Select popup placement must follow
its transformed control. These behaviors require explicit ports in other
engines; sharing numerical tokens alone is insufficient.

## Acceptance before claiming another engine

1. Render the same validated UI/resources, preserving IDs, local transforms,
   clipping and control state; specify the engine and version.
2. Compare start, midpoint, boundary and end values against CLI `sample` output,
   including nonzero layout, nested parents, disabled opacity and delayed tracks.
3. Check seek, replay, repeated samples, stop, destroy, removed targets and
   failure cleanup without mutating the UI contract.
4. Exercise each claimed trigger with real input, and inspect transformed hit
   areas, Slider mapping, Select overlays and Dialog modality.
5. Export/reimport the same document/resources/motion and compare behavior.
6. Exercise every claimed system action, all three profiles, real focus/input,
   partial-progress retargeting, simultaneous controls, ancestor disable/hide,
   popup/dialog closure, removed targets and reattachment. Compare presentation
   and committed state separately; export/reimport both attachment types.

Headless reference tests only establish deterministic math and lifecycle. They
are not a second engine or a pixel/interaction equivalence certificate.
