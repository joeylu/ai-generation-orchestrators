# Content-gap 1.1 task record

2026-09-16: Expedition Supplies Tabs returned a landscape canvas instead of a
square packing canvas; its backpack strokes produced 15 projection runs for 12
parts. User authorized a general producer fix, without new generation.

Implemented opt-in extraction policy 1.1 in relative_board/component_boards,
full content preflight in material_preflight, and matching native compiler/request
prompts. Added bounded grouping, conservative separator rejection and individual
part aspect validation. Legacy 1.0 checks remain unchanged. See
[contract and limits](content-gap-extraction-v1.1.md).

Validation: 23 targeted tests passed; full producer suite 497 total, 478 passed,
19 skipped. Producer diff whitespace checks passed. Tests are local procedural
fixtures; no model/media services. Material-only revision on the retained failing
PNG extracted 12 parts; raw and failed workflow records remain unchanged.
Work evidence: `work/ui-decomposition/expedition-supplies-content-gap-20260916-r001/`.
No sample delivery ZIP, paired-state acceptance or Studio acceptance claimed.
Human acceptance remains false. No new generation or commit performed.
