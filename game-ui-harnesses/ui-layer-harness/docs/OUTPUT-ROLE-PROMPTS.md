# Output-role prompt revision (0.1.0a10 source preview)

The equipment-shop live baseline exported all 36 candidates after 17 image
requests, yet its six backing cards retained separately exported illustrations,
coins and controls. Compositing duplicated those children. Its scene-only
background retained almost the complete UI, and one purchase button retained
ordinary text. The independent final review also found thicker borders and
occlusion errors. File counts and package integrity did not establish quality.

## Source changes

New jobs freeze context prompt v14 and board prompt v7. Both native request paths
use `output_role_prompt`, rather than separate per-crop and board prose contracts.
The final asset role precedes KEEP, a compact REMOVE inventory and locators.
Foreign identities, kinds, depth relations and object locators remain explicit;
foreign appearance paragraphs and redundant material summaries no longer act as
competing drawing descriptions. Text removal and exact exceptions share one
definition, including CJK glyph outlines, shadows and glow. Existing thin edges,
material, gaps, states and relative layout remain reference constraints.

A foreground with an owned panel/card surface and separate higher-layer children
is a clean substrate. The owned kinds must be limited to surface and fixed
decoration/icon/logo; an owned illustration or unknown kind prevents automatic
classification. Mere `kind=card` is insufficient. This is a deterministic prompt
projection of the reviewed plan, not a mask, pixel analysis or new ownership.
Removed overlays leave the original surface continued underneath; genuine owned
openings and translucency remain. A fixed illustration card keeps its own scene.

Background requests bind background-owned appearance and foreground identities.
Scene-only explicitly removes the entire UI, while preserve-underlay keeps
unexported UI and dimming. Visible scene subjects retain their original geometry;
only regions hidden by removed UI are completed from visible background evidence.

The M1 contract now distinguishes an empty backing surface from a complete
illustration and discourages guessed semantic names for tiny reliefs or settings.
M2 explicitly checks cross-layer contact ornaments, including selected-tab tips.
The existing single final review additionally checks output roles in the atlas,
including forbidden content hidden by opaque assembled layers, and records
unresolved role coverage in its summary. No additional model stage is added.

## Invariants and verification

Context versions v1–v13 and board versions v1–v6 retain their historical rendering.
Old host jobs reject changed runtime fingerprints; their authorization is not
ported. Original crop pixels, integer board packing, grouping, extraction,
registration, package manifests, compute ceilings and no-retry policy are intact.
Board v7 maps both owned and foreign object locators into the whole-board space
and retains reviewed texture-source bindings. The changed planning contract has
new locked hashes; this is not permission to accept arbitrary prompt edits.

Offline regressions cover clean cards versus fixed illustration cards, separate
children and repeated identities, exact text exceptions in both native paths,
scene-only versus preserve-underlay scope, whole-board foreign anchors, unchanged
reference pixels, old-version replay and single final-review call budgets.
Source-level prompt correctness is not proof of image-model compliance. A new
frozen job and explicit compute decision are required for live validation.

The first live comparison should measure leftover children on backing surfaces,
leftover UI on the background, text residue and assembled duplication before
judging border style or illustration scale. Do not shrink duplicated content to
hide ownership errors. Broader validation must include translucent HUDs, fixed
illustration cards, composite controls, small pictograms and protruding ornaments.

## Opt-in context v15 / board v8

The next equipment-shop live run cleared the background UI and ordinary button
text, but its six-card board collapsed into one large panel. The deterministic
partition gate excluded all six cards; only 29 of 35 candidates were delivered.
The role change is therefore a partial improvement, not a visual-quality pass.

Context v15 is an explicit validation option; the default remains v14 pending
live evidence. Standalone and background instructions retain v14 rendering.
Only the native combined-board path selects the new `cell_locked_prompt` v8.
It leads and ends with the exact output count, grid, aspect and slot inventory.
Each slot states its complete finished content, with separate overlay and
surrounding-context actions. Foreign locators are intersected with that slot's
reference crop; non-intersecting and edge-touch-only records are omitted.
Intersections locate visible evidence, never masks or inferred pixel boundaries.
The full reviewed ownership graph remains unchanged in the frozen evidence.

Similar backing surfaces must remain separate complete assets with transparent
gutters. Original shadows remain owned appearance; no new halo is licensed.
This changes neither reference pixels nor grouping, geometry, material ownership,
partition gates, retries or compute counts. Historical v14/v7 requests retain
their exact renderings. Selected-request exchange supports focused validation
from a compatible frozen snapshot with its own digest and user authorization.
The old planning runtime fingerprint cannot be reused to freeze v15 through the
current formal entry point: it rejects `RUNTIME_CHANGED_NEW_RUN_REQUIRED`.
Keep this gate intact and prepare fresh planning before live v15 validation.
Offline v7/v8 comparison on an existing snapshot remains read-only and does not
authorize generation or promote the old run.

## Opt-in context v16 / board v9

The six-card v15/v8 diagnostic preserved six independent slots but retained all
equipment, coins and button bases, with exterior residue. It is not a quality
pass. The shared text rule said to preserve neighboring icons while later slot
rules required removing them; its glyph-only repair and unrestricted fidelity
instructions also competed with empty-substrate output.

v16/v9 places final owned content ahead of text and fidelity. Text restoration
applies inside retained KEEP content; foreign overlays are removed as complete
units. Fidelity, pictogram retention and soft shadows apply only to KEEP. Empty
substrates and owned fixed illustrations retain distinct output semantics. The
same scoped rules cover standalone, board and background text processing.

The default remains v14. Historical v14/v7 and v15/v8 rendering is unchanged.
Reference pixels, ownership, locators, grouping and acceptance gates are unchanged.
Offline tests verify source contracts and version routing, not image quality.
Live validation requires a fresh frozen job and bound compute authorization.

## Selected-sheet local edit comparison (board v10)

The v16/v9 equipment sample produced six empty cards, but their borders and corners
drifted and exterior alpha residue remained. Board v10 tests shorter local-edit
instructions: preserve existing retained artwork, remove named overlays and restore
their backing. Per-cell evidence contains only target location, retained appearance,
overlay names and exact text exceptions. The complete ownership graph and geometry
stay in the immutable snapshot and deterministic board metadata. This is not a
pixel-preserving editing guarantee.

`experimental_executor prepare --local-edit-comparison --asset <sheet-id>` accepts
only one sheet from a v16 context snapshot and creates a new one-call job using
canonical v10. It changes neither the old snapshot nor the existing host job;
reference PNG bytes and packing are identical to v9. It cannot combine arbitrary
prompt overrides, cleanup, or layout changes. A new digest and explicit image
authorization are required. No additional model planning is needed for this
controlled selected-sheet diagnostic. Default host version selection is unchanged;
the comparison does not become an accepted full delivery.

### Reference-context comparison

The shorter v10 equipment sample retained empty cards, but included an unwanted
outer backing and side lines. An additional `--narrow-context-comparison` option
requires `--local-edit-comparison` and a sheet of classified substrates. It keeps
the same v10 prompt and placements, but limits each reference's visible context
to the frozen target box plus eight source pixels; the rest becomes neutral gray.
Target samples are copied unchanged. This rectangle is reference context only,
never an output alpha mask or a verified shadow boundary. Visual inspection is
required before compute because the original planned box may omit owned effects.
Reviewed texture regions outside the retained rectangle reject the experiment.
Canonical verification binds the policy, reference PNG and metadata; historical
boards and the parent snapshot remain unchanged. No live quality is implied.

### Native alpha audit before changing prompts

Use `ui_layer.py audit-native-alpha --source <raw.png> --output <fresh-dir>
--grid <columns> <rows>` for a model-free diagnostic. It writes an opaque
checkerboard display using the existing real-alpha renderer and binds it to the
unchanged source SHA-256. Histogram, nominal seam-band alpha maxima and existing
faint-glow partition observations are recorded separately from visual acceptance.
The diagnostic never changes source alpha, extracts accepted assets or calls a
model. Near-transparent colored RGB must not be judged as solid visible debris.

Offline audit of r005/r008/r009/r011 found alpha=1 throughout the previously
reported nonzero central seam pixels; their maximum 8-bit composite channel
contribution is one level. All four also have valid detected seams under the
existing faint-glow policy. Earlier counts of nonzero pixels therefore do not
establish a visible contamination failure or failed extraction. Real-alpha
previews still show the extra backing and border defects, which remain visual
quality failures. Historical reports are preserved with a separate correction.

### Closed-border scope comparison (board v11)

`--contour-edit-comparison` requires the isolated local-edit comparison and
adds one paragraph to v10. Empty backings end at their own observed closed
thin border plus their own soft shadow; similar-colored paper beyond that
border and the rectangular reference crop are not licensed as new artwork.
Explicitly owned protruding decorations remain retained. It may be combined
with the previously frozen narrow-context comparison to hold input constant.
This is a diagnostic hypothesis, not pixel-locked editing or new segmentation.
The v10 text, ownership evidence, source pixels and default host selection
remain unchanged; a separate one-call job and digest bind any new compute.

### Complete independent delivery diagnostics

`experimental_executor prepare --delivery-board-variants <json>` can prepare the
complete v16 request inventory with selected canonical v11 board choices. Each
choice declares `promptVersion: v11` and `referencePolicy` (null or the existing
eight-pixel context policy); all other requests keep their frozen default
rendering. Arbitrary text, partial inventories and mixed experiment policies are
rejected. Choices and canonical board descriptors are bound to the new job digest.
The parent snapshot and host job are not promoted or rewritten. All requests in
the new job require real receipts; prior selected-sheet diagnostics are not
converted into fake attempts. The complete genuine receipt set can use the
existing independent received-diagnostic packaging and final-composite review
path, retaining technical gates and unresolved visual findings.
