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
