# Text Input state acceptance

Use existing consumer states.input.textLayout and placeholderLayout and the single
background role. No new appearance format. Supported: inputType:text at native-size
registered geometry. Editable states: initial/empty/edited/limit; readonly or disabled:
initial/readonly or initial/disabled. QA text is QA truncated to maxLength; the limit
probe uses maxLength Q characters plus attempted EXCESS. maxLength above256 and
password/email/number fail explicitly rather than skipping checks.

Real mouse focus, native keyboard typing/deletion, values, input/change events,
Pixi rendered text, text-color pixels and background pixels are checked. Focused
screenshots are retained. The four-pixel focus-stroke edge and dynamic text regions
are excluded only from background-template comparison. Readonly/disabled attempts
must retain the value without input/change events. This is a bounded profile, not
full Input visual approval.

Reference-state value preserves observed content; QA strings are contract-derived.
Reference-state 1.1 now supports focused field, UTF-16 selection and caret phase via
[the sole consumer contract](../../ui-component-harness/docs/input-editing-reference-v1.1.md).
The separate input-reference-browser driver verifies repeated official replay, real
keyboard selection/replacement and mouse blur, with caret pixel evidence. The ordinary
text-entry matrix alone does not establish this editing-reference coverage. IME,
mouse-drag selection, non-text entry profiles and error skins remain unaccepted.
Human acceptance is false.

input-studio-browser.mjs COMPONENT_ROOT ZIP NEW_OUTPUT imports an editable Input /
RadioGroup sample in actual Studio and uses real mouse and keyboard; blocked states
are separately covered by local fixtures. No setValue or provider calls.
