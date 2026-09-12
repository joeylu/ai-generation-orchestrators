# Inventory scrollbar insets task record — 2026-09-13

Source: inventory-shop-scrollbar-always-20260912-r001/delivery/ui.component-handoff.draft.zip.
Output: work/ui-decomposition/inventory-shop-scrollbar-insets-20260913-r001/acceptance-r002/ui.component-handoff.draft.zip.
SHA256: ff2c8ad7c7adf75c98f86cecfe196d63ff7db51f107329b675ba3f3116a90a41.

Producer adopted consumer scrollbar-insets-v1 verbatim: schema, registered-layer validation,
stateful/default compositor geometry, export and real Studio driver. Six new local tests;
producer full suite220, consumer393, sample26 states passed. Studio12 checks each for
20px and zero overflow passed. No consumer source changes or provider calls.

Measured top36/bottom40 of 24x640 track; usable564. Viewport629/content649 gives
20px scroll, thumb546.619414 and travel17.380586. Track/thumb bytes unchanged; hidden
viewport material cropped with evidence; full six-item List subtree unchanged.
Reference image/state bytes identical; original offsets unknown; derived scope retained.
Isolated official import passed; full reference comparison blocked and delivery-check
visual QA unpassed. All evidence remains human_visual_acceptance:false. See output
中文报告.md and audit.json. No commits or history overwrites.
