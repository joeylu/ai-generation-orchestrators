# Producer integration of consumer component linkages

The sole field/schema authority is the consumer's
[component-linkages-v1.md](../../ui-component-harness/docs/component-linkages-v1.md).
Keep `document.componentLinkages` 1.0, optional `document.linkageState` 1.0,
`List.props.itemContents` 1.0 and existing `valueTextBindings` 1.1 unchanged.
Do not put them in appearance states or reference observations.

The native supplied-data compiler runs the official document validator, then
requires producer capability profiles `component-linkages-v1` on each pipeline
List and `item-contents-v1` on each declared owned-content List. These profiles
exist only in producer capability requests; they are not new consumer fields or
component types. Declaring a profile without its configuration, omitting a
required profile, or using an unknown version fails before generation.
Standard freeze requires the semantic document for these profiles too.

The compiler writes a digest-bound `document-extensions.json` preflight result.
`supported` describes an implemented route, not successful sample interaction.
The official CLI remains authoritative for complete mapping, arithmetic, state,
reference and conflict validation. The producer does not implement a second
linkage rule schema or infer business rules from pixels.

## Source registration and runtime placement

For explicitly owned direct Image/Text children, source geometry is the List's
canonical declared item order: List world origin + item index * itemHeight +
child item-local layout. Resolve ownership by itemId/childIds, never child array
order, naming or y position. Material rectangles for native Images must match
that source registration. Semantic child coordinates stay item-local and are
preserved through compile and official import. Runtime sorting/filtering uses
the consumer projection and must not modify canonical source placement.

Owned rows suppress the synthetic List label. Text coverage comes from explicit
Text children. Static Lists without itemContents retain their legacy coordinates
and label behavior. Children are direct Image/Text only; nested interactive
controls, unsupported opacity/background combinations and ambiguous ownership
remain explicit failures in their applicable validators.

## Acceptance

Single-control static material checks remain required. Linked participants must
also pass the separate real-input linkage driver before a full stateful receipt
can claim technical success. Single-control List actions are delegated to this
bound receipt to avoid stale source-order expectations against a changing List.
Other linked controls retain their generic raster state checks. Default
layout/visual checks and checks for unlinked controls remain required.
Offline-only state matrices explicitly report
linkageCoverage not_run. Partial or missing linkage evidence is not complete
acceptance. Studio persistence and reference comparison are separate existing
delivery stages; source unknowns and human_visual_acceptance=false remain intact.

This bounded real-input driver requires an all-category mapping and at most 128
quantity steps between min and max; native preflight rejects a larger requirement.
It verifies every declared category/sort combination, item selection by mouse,
quantity mouse input and keyboard boundary input, empty-result keyboard/mouse,
owned child position/visibility/text and opaque source pixel samples for images
and row/selection surfaces. Pixel sampling is not full texture equivalence.
Studio additionally changes quantity through a real mouse action before its
existing save/reopen/export/official CLI/Studio reimport equality checks. Its
bounded profile requires an initially visible List item. These limits do not
reduce the consumer contract or authorize inferred/hidden product data.

The source image's visible order may contradict a visible sort label. Record that
conflict explicitly. Do not invent sort keys, alter original evidence or silently
change the initial layout; any chosen runtime layout is a separately declared
derived decision. No deferred-sort or initial-order extension is introduced here.
