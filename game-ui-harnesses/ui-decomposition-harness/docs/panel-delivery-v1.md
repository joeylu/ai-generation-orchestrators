# Panel delivery

Follow ../../ui-component-harness/docs/panel-composition-v1.md.
A complete empty frame binds only background; title uses states.panel.titleLayout.
Do not fabricate a blank header. Preserve legacy independent parts.
Default delivery-check selects present Panel parts, respecting closed Dialogs.
panel-studio-browser.mjs checks the single-frame profile in actual Studio:
frame/title paint, visibility, and real input without fictitious value events.
It does not certify child controls or original-reference visual fidelity.
