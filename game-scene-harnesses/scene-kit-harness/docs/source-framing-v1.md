# Isolated source framing

For a new `isolated-layer-v4` source, explicitly select
`framingProfile: 'complete-silhouette-v1'` in its `createLayerSourceScopes` brief
override, or call `withSourceFraming(existingItemScope)` before a supported
revision. This applies to isolated backdrop, landmark, scenery, valley,
platform and foreground groups. Opaque material/sky and continuous bands reject
the option; their own fill, finite-cut and camera-coverage rules remain in force.

The prompt requests the complete contour, continuous Alpha, real openings and
enough space for antialiased edges, owned shadows and glow. It no longer demands
a fixed 12 percent on every side. No extra image input or compute is added.
Native PNG border checks, source ownership, feature calibration and human art
acceptance remain separate and unchanged. A small transparent margin is not
evidence of clipping; a large one is not evidence of completeness.

```js
const scopes = createLayerSourceScopes(requirements, [{
  subjectId: 'fixture', parentRole: 'foreground',
  content: 'One complete fixture with its own mounts.',
  exclusions: ['Host wall and separate equipment'],
  framingProfile: 'complete-silhouette-v1'
}]);
// A revised item scope may instead use withSourceFraming(oldPlan.recipe.sourceScope).
// Freeze a new exact plan through the existing revision API before compute.
```

Absent-field requests keep their original prompt and plan bytes. In particular,
historical 12-percent requests, attempts and raw PNGs are never rewritten.
The selected option changes the plan digest and needs a fresh compute decision;
an old unused authorization cannot authorize the revised request.

For an existing source, preserve any observed mismatch with its historical
prompt as evidence. Do not turn the old percentage into an additional universal
adoption gate. Review actual truncation, transparent openings, effects at the
edge and the intended placement. A complete technically valid source may proceed
to placement review with a smaller margin. Do not silently pad, crop, shrink,
erase or recolor the source to satisfy a percentage. Other failures, especially
foreign-owner content or failed structural checks, continue to block assembly.

When internal registration needs an additional visual hint, use the separate
[isolated source frame guide](source-frame-guide-v1.md) with an exact reviewed
reference frame. It adds a second input explicitly; the framing profile alone
still adds none. Neither option turns an isolated group into a continuous band
or requires painted content at the side and bottom edges.

Keep the technical border verdict distinct from visible contour completeness.
An isolated source may show ample clear space while a few very faint nonzero
Alpha samples exceed its frozen border threshold. Record their values and locations
alongside a continuous-Alpha preview; do not call this proof of visibly clipped
architecture or insufficient percentage padding. Preserve the failed QA and raw
PNG. Neither a visual judgment nor a diagnostic Alpha threshold permits silently
erasing those samples, changing the quality policy or adopting the failed source.
