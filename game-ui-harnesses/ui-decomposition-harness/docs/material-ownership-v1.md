# Material ownership in generation plans

Native compilation emits `material-ownership.json` version 1.0 from existing
material rectangles and appearance part roles. Its digest is included in generated
asset prompts as `native-material-ownership-v1:`. No new consumer field is added.

Surface prompts exclude overlapping independently rendered icons, marks, arrows,
images and child controls, including children owned by the same component. State
alternatives (tab/active-tab, row/selected-row) are not each other's contents.
An explicitly assigned state symbol may remain in its owning surface when no
separate layer owns it. Independent image prompts retain their own internal detail.
Runtime text remains separate from raster surfaces.
Containing surfaces owned by other components are recorded in
`surroundingLayerIds`; their outer frames, headers and crests must not be copied
into child surfaces. A viewport rectangle does not establish a decorated Panel.

The batch prompt's generic symbol-preservation instruction defers to these scoped
ownership instructions. Previously frozen requests are unchanged. Changed prompts
require a new immutable plan and fresh generation authorization.

This is a deterministic prompt compilation rule, not a detector of arbitrary baked
icons. A provider can still violate the prompt; returned materials must be inspected
before delivery. Historical failed raw output and receipts are retained. Compilation
alone does not establish visual acceptance; `human_visual_acceptance` remains false.

Regression coverage includes separate Input icons, same-component marks, List row
surfaces, state alternatives and legacy batch prompt behavior.
