# Input editing reference state 1.1 (authoritative contract)

This is the single producer/consumer integration contract. It extends existing
`ui-reference-state` to `schemaVersion: "1.1"`; v1.0 is unchanged and accepted.
No change to the outer handoff version is required. Store this same document in
`reference/reference-state.json`, update its existing manifest SHA-256, and retain
original image bytes. Schema: ui-decomposition-harness/references/reference-state-v1.1.schema.json.
Both reference_delivery.validate_states and the consumer validateReferenceStates
validate this version. Other component fields and acceptance-scope 1.0 are unchanged.

Every Input row in 1.1 requires these fields, each using the existing observed
`{status:"observed",value:...,evidence:"..."}` or unknown
`{status:"unknown",reason:"..."}` envelope:

| Field | Value |
| --- | --- |
| value | Existing string; unchanged semantics |
| focused | boolean, at most one observed focused Input |
| selectionStart | integer UTF-16 offset, inclusive |
| selectionEnd | integer UTF-16 offset, exclusive; start <= end |
| selectionDirection | none (collapsed), forward, backward |
| caretVisible | boolean for the observed screenshot phase, not a blink rate |

Offsets must fit observed value length (or maxLength if value unknown). Visible
caret requires observed focus=true, known equal offsets and editable/enabled input.
Disabled focus, multiple focused Inputs and contradictory caret evidence are errors.
Current replay supports text/password Inputs; email/number selection is unsupported.
For unfocused fields, use unknown for unobservable retained selection; do not invent
zero offsets. Unknown focus is not inferred from offsets. Unknown fields are not
written and continue to block or limit visual acceptance. A runtime mismatch is
reported rather than silently filled. Real interactions resume normal blinking.

Runtime: TreePreview.setInputEditing(id, partialState), inspection inputEditing.
Replay restores known values first, then known focus and selection. Repeated replay
sets state rather than toggling. caretVisible pins the screenshot phase until real
editing; actual mouse placement, keyboard selection, input and blur own live state.
Collapsed native browser directions are normalized to none. Selection highlight and
caret are Pixi graphics driven by the native editor, clipped to the text rectangle.
No screenshot or supplied image is used as a caret. Focus can be read-only, but no
insertion caret or modification is allowed there; disabled Inputs cannot focus.

Source observation and derived tests remain separate. Put actual original-image
observations in reference-state only. Keyboard QA strings, cursor movement, maxLength
probes and blink tests belong in acceptance-scope.derivedTestStates using its existing
contract-derived basis/description and in test reports. They are never original-image
observations. Do not create a parallel focus-state file or overwrite unknown values.

Create Hero upstream action: author a new 1.1 state through the normal packaging
pipeline after reviewing TITLE's visible caret; preserve NAME=Aria, TITLE="".
If TITLE focus, offset 0 and visible phase are confirmed, encode those as observed;
mark unobservable fields unknown. Keep voice-pitch.value unknown; runtime 64 remains
inherited draft data. This consumer has not edited the supplied ZIP or its evidence.

Limits: IME composition/candidate window, complex-script grapheme mouse placement,
mouse-drag selection, mobile/touch keyboards and email/number caret editing have not
been accepted. UTF-16 offsets do not promise grapheme-aware hit testing. Arbitrary
live focus/selection is transient, not an extra UiBundle property; saved reference
observations are preserved and explicitly replayable. human_visual_acceptance=false.
