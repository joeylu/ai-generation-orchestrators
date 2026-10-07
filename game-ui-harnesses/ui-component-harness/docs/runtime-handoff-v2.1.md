# Component handoff 2.1: preserve sampling and saved runtime state

Version 2.0 and v1 remain unchanged. Version 2.1 retains kind
`ai_ui_component_handoff_v2`, requires schemaVersion `2.1` and one additional
manifest entry `runtime_bundle: {path: "runtime.ui-bundle.json", sha256}`.
This member reuses the existing UiBundle 0.1/0.2 contract. It cannot contain
componentHandoff or a recursive 0.3 bundle.

component.ui-bundle.json and appearance-binding.json retain their original
sampling values and bytes. All reference members remain byte-identical.
The runtime bundle must match the sampling bundle exactly except bundleVersion,
motion, motionSystem and these existing props: Tabs.activeId; CheckBox/Switch.checked;
RadioGroup/List/Select.selectedId; ScrollView.scrollX/scrollY; Input/Slider/ProgressBar.value;
Dialog.open. Its values and motion must pass normal bundle validation. IDs, options,
geometry, resources, provenance and all other fields cannot change.

The official component-handoff importer (also used by decomposition repair gates)
authenticates both bundles, applies binding against the sampling bundle, then restores
runtime values and motion. Studio does not overwrite an imported saved snapshot with
reference replay. Explicit reference replay/acceptance still uses original evidence,
including unknown values. Human visual acceptance stays false. Consumers supporting
only 2.0 must reject 2.1 rather than silently discard runtime state.

## Runtime-only handoff 1.1

Legacy `ai_ui_component_handoff_v1` packages may now be retained in the same
UiBundle 0.3 `componentHandoff` attachment. Source integrity, complete binding,
structure and resource checks remain mandatory. Missing reference evidence is
still `missing_reference_evidence`, never a successful reference comparison.

Saving a legacy runtime package writes `schemaVersion:"1.1"` and the existing
`runtime_bundle:{path:"runtime.ui-bundle.json",sha256}` entry. The exact original
component bundle, appearance binding and nested decomposition ZIP remain unchanged.
The snapshot follows the same restricted runtime-value/motion/linkageState rules
as handoff 2.1; geometry, options, prices, bindings and resources cannot change.
Only the manifest and runtime snapshot change on repeated exports. Unknown versions,
missing snapshots, recursive attachments and changed snapshot structure reject.
Older consumers must reject 1.1 instead of discarding saved state. Reference-less
archives cannot acquire reference observations by saving. Handoff 2.0/2.1 rules
and their reference-byte preservation remain unchanged.
