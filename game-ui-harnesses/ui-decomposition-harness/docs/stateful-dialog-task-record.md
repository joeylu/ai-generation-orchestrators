# Dialog adapter work record — 2026-09-12

The confirmed reward source is `04-reward-dialog.png` in the five-image
integration sample set. The new original-reference plan is frozen under
`work/ui-decomposition/reward-dialog-fullchain-20260912-r001`, with digest
`68fc04cdf95be4074417c1bc599f41c8828b56c951449ae2c7bf70f28398cb8d`.
It contains 15 independent new image requests and zero reuse/automatic retries.
No generation authorization was assumed and no requests were dispatched.

Implemented independent modules: `stateful_dialog.py`,
`stateful-dialog-browser.mjs`, `stateful-dialog-fixtures.mjs`, and
`test_stateful_dialog.py`. Shared dispatcher integration was reserved for the
parent agent; exact candidate patches are retained beside the plan. Until
integrated, the normal CLI still rejects Dialog, and the new integrated test
cannot pass. Do not describe these candidate receipts as main-CLI completion.

Five metadata tests passed. A candidate dispatcher compiled from the exact
proposed hooks imported local fixtures through the official component CLI and
ran real PixiJS browser tests. It reproduced an actionable-but-hidden Close
button: Dialog header was painted above all children. The receiving runtime
now paints Dialog header in its surface layer below children while preserving
title foreground order. Build passed, and two candidate suites passed after
that fix: raster semitransparent overlay and native overlay, 15 states each.
The r001/r002 failure evidence and fresh r003 successes are retained. These
are procedural regression fixtures; none is the reward sample delivery.

The adapter checks explicit open/closed/reopened state, every child visibility,
open child activation and hidden suppression, background Button blocking while
modal and restoration when closed, and real RGBA source-over composition.
A modal fixture requires an observable background Button outside its rectangle;
absence fails `STATE_DIALOG_MODAL_PROBE_MISSING`. A Dialog without enabled child
Buttons fails `STATE_DIALOG_ACTION_PROBE_MISSING`. These limits are explicit.
The receiver exposes Dialog state through `getDocument().props.open`, not the
per-node `inspect().value` used by other controls.

A button's public `activate` and Dialog's `setValue(false)` are separate public
actions: the portable contract does not bind business routes, so neither reward
issuance nor close-on-activate is claimed. The unseen hidden backdrop and exact
undimmed colors cannot be recovered from the modal reference. The reward plan
uses conservative blank-surface completion and the public 0.28 modal overlay,
with those visual differences recorded for human review. All receipts retain
`human_visual_acceptance: false`.

## Integrated follow-up and Button Image children

The parent integrated the shared Dialog/Slider/Progress dispatchers after the
candidate stage. A new receiving-side keyboard focus ring exposed a stale-frame
bug on pointer press: clearing keyboard focus destroyed its Graphics without
rendering the new frame. The ordinary driver failed, while a diagnostic-only
same-state redraw passed; parent fixed the listener by rendering after clear.
The diagnostic workaround was not added to the acceptance driver.

Button child Image support is now integrated in the shared matrix/browser
entry points. `stateful_static_children.py` binds the consumed resource's byte,
pixel and Alpha fingerprints, native dimensions, local/world position and
inherited clip. `staticChildren` are semantic resource records, not invented
appearance roles or layer bindings. They join the screenshot compositor after
the background; their actual Alpha masks only covered background pixels, and
their own visible pixels are verified. Their actual runtime visibility and
bounds are checked separately, including the parent Button press transform.

Six dedicated tests passed, including one real-browser fixture containing four
Buttons with independent child Image layers and all three pointer states.
Fresh main-CLI evidence is `main-acceptance-child-images-r001` beneath the sample
proposal directory (15 states including Dialog). The adapter currently requires
direct native-size Image children with no atlas region, `drawBackground:false`
and opacity 1; unsupported nesting, compositional child types, opacity or
non-native geometry fail explicitly. No full-reference generation or new
sample ZIP has occurred, and no human visual acceptance is established.

## Authorized full-reference generation stopped at Alpha gate

The user subsequently authorized the exact frozen Reward plan through aggregate
manifest digest `d8136672035722d104c0832eb461800f102a78d8f024f75039116a2b7a91692a`.
The built-in Imagegen tool was used exactly twice, following frozen prompts:
scene imported successfully; dialog-background returned RGB with drawn
checkerboard and failed official import with `TRANSPARENT_RESULT_REQUIRED`.
The rejected sealed raw image is retained under the sample's
`outbox/dialog-background-r001/result.png`. No retry, mode change, checkerboard
removal, false indeterminate state or generated delivery was performed.
The runtime retains one received request, one reserved/rejected-import request,
and thirteen unsubmitted prepared requests. Full-reference sample testing is
incomplete; earlier browser receipts are still procedural regressions only.


## 2026-09-13 Reference visual repair

Real Reward repair uses imported verified existing materials with zero generation
requests and one official reuse_scaled background derivative. Redundant body is
omitted, background registered lower, source-readable background text restored,
and title/labels sized with actual Arial metrics. Explicit 60% black backdrop is
an authored approximation, not an exact source-alpha observation. Original bytes
and reference states are preserved in the new v2 archive.

The shared visualObservations gate verifies default Pixi strings, fonts, bounds,
text overlap, frame ownership, backdrop and real-Alpha bottom clearance before
acceptance ZIP publication. A detected 7px card title/caption overlap was corrected
in a fresh revision. Source pixel/ornament matching remains a separate limitation.
New evidence: work/ui-decomposition/reward-dialog-visual-repair-20260912-r001/,
acceptance-r004 and studio-r002. Human visual acceptance remains false.
