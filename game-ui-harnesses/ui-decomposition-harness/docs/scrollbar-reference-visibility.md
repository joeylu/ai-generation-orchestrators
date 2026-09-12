# Reference-visible ScrollView delivery

Use the consumer's existing `ScrollView.props.scrollbarVisibility: "always"`
when the reference visibly includes the scrollbar, even if known content fits.
No additional consumer field is introduced. The policy checker accepts an
explicit `scrollViews[].scrollbarVisibility`; omitted policy values retain auto.

Offline visibility-only rebind (requires a built current consumer):

```text
python -m ai_ui_decomposition.scroll_visibility_handoff --source INPUT.zip --component-root COMPONENT_ROOT --output NEW_DIRECTORY --component-id ID --visibility always
node src/ai_ui_decomposition/scroll-studio-browser.mjs COMPONENT_ROOT INPUT.zip NEW_EVIDENCE_DIRECTORY ID
```

The rebind verifies the source through the official CLI, changes only the selected
ScrollView visibility, obtains the canonical document digest from the consumer,
updates binding and outer digests, and validates the candidate through the CLI.
Original artwork, mapping, reference state, acceptance scope and layered artwork
remain unchanged. Output directories must be new. No provider calls are involved.

Always-visible is not evidence of overflow or a known original scroll position.
No-op wheel and drag must keep values finite and in bounds without scroll events.
Studio verification uses ZIP upload and actual mouse/keyboard input. Screenshots
and display-list bounds verify chrome separately from semantic scroll values.

Current limitation: the consumer expands a short thumb to viewport/content ratio.
At zero range it covers the whole track. Existing fields cannot retain a short
reference thumb at zero range or reserve space for ornaments baked into the track.
Required future consumer capability: explicitly separate observed thumb display
geometry from semantic scroll range and identify the usable rail inside decorated
track artwork. This describes a gap, not a new accepted field or implemented API.
Do not invent content, guess observed values, remove scopes or replace interactive
parts with static decorations to conceal that gap. Human visual acceptance is false.
