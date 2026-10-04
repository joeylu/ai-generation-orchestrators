# Portable UI button interactions

`Button.props.interaction` is optional for historical v0.2 documents. Fresh native
layer proposals must declare every Button as an internal UI operation or explicitly
external with a reason. No script, endpoint, game action ID or code execution is
accepted. New run records bind this requirement; historical collection remains
compatible. Close/cancel, detail selection and numeric stepping belong to UI
delivery even when game integration is out of scope.

Internal: `{version:'1.0',mode:'internal',effects:[...]}`. External:
`{version:'1.0',mode:'external',reason:'...'}`, retaining the existing activate event.

| Effect | Explicit fields | Behavior |
| --- | --- | --- |
| dialog-open | targetId, boolean open | Open/close an existing Dialog and its modal blocker. |
| input-step | targetId, integer delta/min/max | Step an editable number Input. Bounds fit maxLength. Limits and invalid/empty/disabled inputs make the Button unavailable. Must be its only effect. Bounds are explicit UI proposals, not inventory facts. |
| copy-text | sourceId, targetId | Copy an existing Text value without inventing a label. |
| copy-image | sourceId, targetId | Reuse an existing Image source/crop; retain target geometry/fit/style. Disclose scaling differences. |

References are type checked; duplicate writes, copy chains/cycles and conflicting
value/list controllers are rejected. Copies persist as optional
`document.interactionState={version:'1.0',copies:[{targetId,sourceId}]}`. Only declared
pairs are valid. Snapshots retain frozen target source/text fields, while the state
selects an authenticated existing source. Source-bound Bundle validation still
recompiles its immutable plan and compares all resources. Input values and
Dialog.open retain their existing mutable state contract.

The local render gate executes declared effects with actual pointer input and UI
open/close paths rather than control-API state setup, checks activations and state,
then restores/rechecks initial rendering. Missing modal exits or unreachable
targets are repairable construction errors sharing the existing correction budget.
Keyboard, limits, repeated choices and export/reopen have browser regressions.
External declarations are reported separately and never claim a host action.
