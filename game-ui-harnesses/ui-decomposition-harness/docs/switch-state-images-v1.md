# Switch stateImages 1.0 producer integration

The sole public contract is the consumer [Switch state images v1](../../ui-component-harness/docs/switch-state-images-v1.md).
The exact `bindings[].states.switch.stateImages` object is version/off/on, with
trackLayerId and thumbLayerId in each side. Schema fragment:
[reference schema](../references/switch-state-images-v1.schema.json).
Do not add aliases. Keep parts.track/thumb, thumbPositions and authored labels.

Native component-handoff export checks all alternate layers, not just parts:
known authenticated layer IDs, base-matching dimensions, fingerprints, genuine
Alpha and nonempty paint. Missing sides, unknown versions, missing IDs or wrong
sizes fail explicitly. State rendering uses the exact authenticated alternate
layer bytes and the base geometry. Alternate source scene coordinates do not
move the control. Default-state delivery-check also selects the declared pair.

For an existing immutable package, author only the Switch stateImages changes
and run `ai-ui-decomposition switch-state-handoff --source OLD.zip --binding
NEW-binding.json --component-root COMPONENT_ROOT --output FRESH_DIRECTORY`.
The deterministic tool officially imports the source, verifies the binding-only
change, validates alternate bytes, updates the binding digest, officially imports
the candidate, and verifies archive readback before publishing its new draft ZIP.
Other package members, including original reference, mapping, state, scope,
derivatives, component bundle and nested art archive, stay byte-identical.
A failed official import leaves a candidate, not a successful published package.
No media service or provider integration is involved.

Stateful acceptance reports legacy_single_pair_not_full_state_appearance for
old Switch packages. Explicit pairs permit shared resources only with existing
shared evidence; explicit stateImages does not by itself establish distinct or
reference-observed art. Distinct relations still reject identical decoded pixels.

The browser adapter tests each Switch state via both real mouse input and Space
on a keyboard-focused canvas. It checks change events and their input source,
semantic values, settled thumb geometry, actual raster pixels, label content and
label layout/color. Keyboard focus screenshots are retained; the canvas is then
blurred for unobscured material comparison, without setValue. This avoids treating
the independent focus ring as a wrong texture. No color threshold was weakened.

Cross-control reuse must cite source observations and geometry/Alpha evidence.
Matching dimensions alone do not prove matching shape. Do not recolor by inference
or claim recovery when source evidence is insufficient. Keep residual silhouette
differences explicit and human_visual_acceptance:false.
