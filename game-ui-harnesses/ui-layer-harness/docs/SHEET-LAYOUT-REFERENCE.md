# Combined sheet reference boards

## Current automatic input

New `context-crops` sheet jobs automatically combine their original reference
crops into one board, in frozen material order, using one common integer scale.
Each sheet receives that board once; standalone backgrounds/materials retain
their own input strategy. The host does not dispatch each sheet crop separately.
The job binds `sheetReferencePolicy` and `contextBoardReferences`; verification
rebuilds the board and prompt from the immutable snapshot. There is no silent
fallback to separate crop attachments. See [host integration](HOST-INTEGRATION.md).

For context prompt v13, automatic boards use board prompt v5: each cell's
ordinary-text removal precedes KEEP, and foreign scene people/scenery are removed
while assigned illustrations retain their own subjects. Independently reviewed
source-bound textures select board prompt v6, which additionally binds canonical
texture-to-cell mapping and preserves the original review evidence. It performs
no new texture review. Context and board prompt versions are separate contracts;
historical descriptors rebuild their own versions without conversion.

## Explicit single-board variant

The internal independent image exchange accepts an opt-in
`prepare --reference-mode sheet-layout-board` for exactly one reviewed sheet
from a `context-crops` snapshot. This creates a separate experiment job rather
than converting the parent snapshot or exposing a new public service command.
It is distinct from the automatic multi-request policy above. No grouping or
prompt-writing model is added.

The question is whether a single visible layout helps image generation preserve
material proportions better than separate crop attachments. The board and its
edit-oriented prompt are one input strategy; this experiment cannot attribute a
change independently to either factor. Offline checks do not demonstrate better
image fidelity.

## Deterministic input

The original expanded crops are arranged in the frozen output grid and material
order. Every crop uses the same largest fitting integer scale with nearest-neighbor
pixel replication and is centered in its cell. Padding is ten percent of the
shorter cell side, rounded up. If scale one cannot fit, preparation fails; there
is no individual stretching or silent downsampling. Unused cells stay empty.

Neutral gray fills the board outside the crops. It is reference context, not a
color-key instruction or output background. Source artwork and source context
inside each crop remain unchanged, including business text that the generation
prompt asks to remove. The program does not segment or repaint source pixels.

`sheet-layout/board.png`, `board.json` and `prompt.txt` are new job artifacts.
Their descriptor binds hashes, geometry and source identities. Loading the job
reconstructs their content from the verified parent snapshot and rejects
substitution even if an attacker recomputes the artifact hashes. Paths are fixed.

The compiler retains owned-part descriptions, observed states, exact permitted
text and foreign-unit exclusions. Target and reference boxes are transformed
into normalized board coordinates; per-material internal offsets retain their
meaning. The prompt asks to edit the shown layout, remove business labels and
foreign context, and preserve contours, proportions and continuous transparency.
It accepts no arbitrary prompt override. Prompt length is measured rather than
assumed to be shorter.

Historical board prompt `v2` places each cell's KEEP,
REMOVE, AFTER REMOVAL, exact text exceptions and LOCATION instructions together.
Only KEEP artwork inherits reference geometry; foreign exclusions take precedence
over copying the assembled reference. Removal includes the original per-object
descriptions, including repeated instances, without semantic summarization.
Exposed owned surfaces continue through removed footprints, while genuine gaps
and translucency remain. A parent panel's exclusion box is a locator, never a
mask that erases the assigned artwork.

The board descriptor binds its selected `promptVersion`. Historical descriptors
without that field rebuild the exact original `v1` prompt. Validation rejects
unknown versions, version substitution and changed action instructions even if
stored hashes are recomputed. The v1/v2 replay behavior remains unchanged;
current automatic selection is described above. Shorter wording or explicit
actions are not proof of model compliance.

The board changes only generation input. Original target crops, material IDs,
output dimensions, placement, grouping and review evidence stay frozen. Context
is not an ownership mask, and this mode cannot repair an incorrect reviewed box.

## Calls, evidence and stopping

The new job has its own digest and requires fresh single-use authorization.
The exact relay sends one board and its frozen prompt in one image request.
Collection verifies the arguments and board descriptor; old crop-reference
metadata cannot masquerade as the actual attachment. Persistent session rules,
native alpha checks and terminal no-resubmit behavior remain unchanged.

Any explicit per-request sheet review receives the original reference and
existing review evidence. Strict geometry findings still block under that
profile; fast warning jobs instead use one final composite review. A failed or
uncertain result stops; no alternate prompt, regenerated board or second image
is automatically submitted. Passing offline tests or image collection does not
authorize extraction, registration or delivery beyond their existing gates.

Historical snapshots, jobs, approvals and failed states are never modified.
The public service interface and `ui_layer_composition_v1` remain unchanged.
