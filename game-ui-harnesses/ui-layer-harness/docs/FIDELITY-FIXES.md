# Complex reference fidelity fixes — 0.1.0a5

These changes are included in `ui-layers-v0.1.0-alpha.5`. Offline fixtures exercise
the behavior. A bounded native CLI reference-to-delivery run and a subsequent
one-sheet CJK text-removal validation have completed; style differences remain
warnings. See [release scope](release-0.1.0a5.md). No retry or acceptance is implied
for an old failed run.

## Background edits

New context jobs freeze `contextPromptVersion=v13`. A scene-only background uses
the full original reference exactly once and starts with:

> 去掉原参考图中的所有 UI，只保留背景。

The remaining short instructions preserve canvas, camera, visible subjects'
positions, size, contours and colors, enforce the exact text policy and request
an opaque PNG. There is no reconstruction, redrawing or hidden-surface completion
instruction. Scene labels, detailed object descriptions and generic foreground
reconstruction/alpha guidance are not appended.
Explicit texture or protected-region contracts retain their own bound guidance.
`preserve-underlay` removes only exported foregrounds, preserving unexported UI
and dimming. v1–v11 requests retain their previous compiled prompts.

Foregrounds and sheets also edit the supplied reference: remove foreign owners
and ordinary text, keep the assigned original subject. The shared policy suffix,
reference-board prompt v5 and declared internal-geometry suffix use the same
edit-only instruction; none requests reconstruction or surface completion.
Ownership, exact text exceptions, alpha, padding and frozen grid checks remain.
Optional cleanup jobs derived from v12/v13 snapshots bind edit-only cleanup v7/v8;
historical cleanup versions remain unchanged. Protected-region background guidance
also keeps the reference-edit task without requesting replacement scenery.

This removes an avoidable redraw incentive. Prompt simplification alone cannot
prove that a model preserves composition; compare the next native background
and final recomposition with the original before accepting them.

## Sheet geometry and uncertain partitions

Fresh host jobs default to `compact-controls-context-grid-v5`. Complete illustrated
cards remain independent owners and retain the v3 compatibility requirements.
Flat controls now also require compatible dimensions/aspect. A grid may contain
one unused slot rather than forcing a prime count into a narrow single row or
column. Full reference resolution, common scale, margins and empty-slot validation
are retained. Planning reports actual calls before M2; counts can increase when
incompatible materials separate. Generation mode remains `sheets`.
All two-to-six-owner sheets budget context rims and board padding during grouping,
preventing an integer-copy reference board from failing only after M2. v4 retains
its historical six-owner-only board budget.
New context jobs bind `sheetReferencePolicy=all-context-sheets-board-v1` and combine
every sheet's crops into one canonical reference board before dispatch. Each cell
retains its original crop pixels, common integer scale and frozen row-major order;
unused cells stay empty. Native generation receives one board, with no fallback
to separate attachments. This preparation adds no generation calls. Neighboring
UI is removed by the reference edit. Historical jobs without the new policy keep
their original input transport. Backgrounds and standalone materials remain
independent requests.

New local warning jobs bind
`sheetCompositePolicy=detect-alpha-floor-preserve-raw-sheet-cells-v2`.
Both the pre-review sheet check and diagnostic delivery use the same
`sheet-alpha-floor-v1` detection preparation before selecting cuts: only alpha 0/1 pixels
are zeroed in the detection copy. Rendering sources retain **every nonzero raw
RGBA pixel**, including alpha=1 glow tails, inside a two-pixel transparent guard;
only hidden RGB at alpha zero is cleared. Faint native PNG
noise in seams and unused cells therefore cannot exclude otherwise separable
materials. Detection sheets/cells, guarded rendering cells and hashes are archived separately
from unchanged raw PNGs and raw capacity crops. Both raw and prepared partitions
retain reconstruction proof. Historical explicit v1 contracts still use raw
partitions, and missing policies retain their old behavior.

If the received sheet has no verified candidate partition, its nominal grid
crops remain diagnostic evidence. They are excluded from the composition rather
than registered as individual materials. Original sheets and **all capacity
crops**, including unused cells, remain archived with pixel reconstruction proof.
Genuine reviewed extraction sources can replace the diagnostic crops. Reused
instances inherit an unverified prototype's exclusion unless independently
reviewed sources are available.

`excludedUncertainMaterialIds` and
`UNCERTAIN_SHEET_CELLS_EXCLUDED_FROM_COMPOSITE` disclose the omitted materials.
Layout refinement excludes those sources and reports affected constraints as
unresolved; it does not mark the original whole layout passed while materials
are missing. Remaining materials continue to the
diagnostic preview and ZIP without more generation or body-observation calls.
This is an honest partial diagnostic, not a complete material delivery. Older
contracts without this policy retain their existing behavior; strict gates remain.

## Carrier registration

M1 now receives explicit guidance to use frame adaptation for stretchable carrier
surfaces while keeping separately owned illustration cards uniform. A carrier
with its own non-deformable illustration stays uniform, with possible fit gaps
declared. The original M1 answer and declared modes are never silently rewritten.
Foreground v12/v13 prompts specify the owned width/height before padding, so the
canvas aspect cannot be mistaken for the artwork aspect. Frame adaptation still
requires the reviewed declaration; no automatic stretching of illustrated art is
introduced.
