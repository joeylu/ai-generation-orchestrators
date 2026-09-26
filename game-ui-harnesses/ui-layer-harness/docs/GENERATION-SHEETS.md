# Generation sheets (opt-in preview)

Delivery materials and generation requests are separate identities. A material
keeps its own ownership, visible state, target geometry and final PNG. A sheet is
one provider request containing several materials, never one merged UI layer.

Use `run --generation-mode sheets` for a new job. The default remains `single`.
`--max-calls` limits actual image requests in either mode, not final layer count.
No existing frozen job, approval or receipt can be converted in place.

## Frozen grouping

M1/M2 continue to plan delivery materials. The deterministic compiler groups at
most six compatible foreground materials, using visual kind, declared aspect and
size (dimensions within 2x, aspect ratios within 1.5x for every pair). Backgrounds,
panels, unknowns, logos and multi-control materials remain separate. Grouping is
conservative; it is not pixel reuse or proof that two artworks are identical.

The frozen `ui_generation_groups_v1` document binds ordered material IDs, equal
grid cells and suggested canvas size. `ui_visual_requests_preview_v2` contains
both single requests and sheet requests. A sheet request's `asset` is a request
ID; `materialIds` maps it to delivery assets. Its prompt, ordering and grouping
are hashed before authorization. Preflight reconstructs the groups and prompts
and requires every material exactly once. All requests use the full reference.

No sheet crop is dispatched as an additional reference. Grid indices are prompt
metadata, never visible numbers to draw. The model must preserve each material's
state, proportion, decorations and internal icon offset; every cell has clear
transparent margins. Unused cells stay empty. There is no shared backing.

## Receive, review and extract

One `next` reserves one sheet request; one `receive` binds the unchanged raw PNG.
An uncertain/failed request cannot be automatically resubmitted. Receiving a
valid PNG does not accept its visual quality. Sheets require native alpha.

During `resume`, the existing `raw_complete` node performs sheet extraction:

1. Preserve the original receipt and PNG. Create a separately hashed prepared
   copy using `sheet-alpha-floor-v1`: clear RGBA only where alpha is 0 or 1.
   Pixels with alpha >= 2 remain byte-for-byte unchanged. Record changed-pixel
   counts (including hidden RGB separately), policy and both fingerprints.
   This is deterministic cleanup, not segmentation or visual acceptance.
   Around each nominal grid seam, search at most one quarter of the nominal
   cell extent for exactly one full-span transparent band at least two pixels
   wide. Cut inside it; no band or multiple candidate bands stops extraction.
   Every resulting cell boundary must still be fully transparent, occupied
   cells need alpha support, and unused cells must remain empty. Never delete
   connected artwork, enlarge the cleanup threshold or add padding to pass.
2. If a newly frozen material explicitly uses `horizontal-frame-slice`, derive
   that verified cell first and assemble a separately fingerprinted review
   sheet; other cells remain unchanged. Use one existing Codex CLI read-only
   review per sheet with the full reference, a bounded observation copy of
   the reviewed sheet, and a deterministic close-up comparison. The comparison
   shows each frozen reference crop beside its generated cell after transparent
   padding is excluded. It is evidence for outlines, corner shapes, line weight
   and internal layout; its independent display scales are not measurements.
   The close-up image, source crop hashes, cell boxes and prompt are bound to the
   review request. Check identity/order, observed
   state, omissions, duplicates, shapes and details. Any uncertainty or issue
   stops. This review is model evidence, not human visual acceptance.
3. Crop unchanged cells from the prepared PNG at verified integer half-open
   boundaries; frame-adapted cells retain both their original prepared crop
   and reviewed derived PNG. The review receives the actual boxes of its
   observation sheet and their mapping. Bind raw SHA, prepared SHA, original
   cell box, reviewed-sheet SHA, adaptation evidence when present, material ID,
   review hash and output SHA. Preserve continuous alpha and all source files.
   Keep originals and model responses. Visual issues still stop extraction.
4. Feed independent PNGs into the existing material gates, registration and
   package builder. Extraction success does not bypass any of those checks.

No sheet is a successful delivery by itself. Failed extraction stops the DAG;
`resume` does not repeat the review. Partial diagnostic files are not packaged.
The image authorization covers the frozen image requests; the host must also
have permission for the documented read-only model review calls. Fewer image
requests does not necessarily mean less total wall time or compute cost.

For an integrated control whose label is removed, keep the original outer
contour and the icon's position and size relative to that contour. A received
sheet with a recentered or enlarged icon, changed empty label area, or changed
control aspect is a blocking generation discrepancy. It is not repaired by
placement. If the user chooses one correction after reviewing the evidence,
an isolated `sheet-crops-only` variant may use the original per-material crops
and a concise edit instruction to remove glyphs and exterior pixels while
preserving the remaining artwork. Bind it to a fresh prompt/job digest and
authorize it separately; do not switch every sheet to crop inputs by default.
Check the cropped-edit result against each original control, not only against
the failed full-reference sheet. Removing glyphs can preserve the upper icon
and lower label space while still compressing the outer frame or thickening its
border. Treat the raw contour error as a generation finding. A deterministic
whole-frame fit may be shown as a separately labelled display candidate when
the complete frame is present, with source hash and x/y scales recorded; it
does not rewrite the raw review or erase border-style warnings. Require a new
visual review and human acceptance before promoting such a candidate.

A separate `experimental_executor review-material --job RECEIVED_SINGLE_JOB
--output NEW_DIR` runs the existing deterministic material gate and one Codex CLI
read-only visual review for a selected single-material experiment. It binds the
receipt, original crop, raw output, close-up comparison, prompt, schema and model
response. Structured geometry/layout findings retain the sheet review severity
policy and stop that experiment; this command never promotes a failed parent DAG
or packages the variant. It is not a substitute for full delivered-UI acceptance.
It never silently reclassifies a finding. Its review prompt carries the same frozen
owned-object and `excludedForeignArtwork` evidence as the sheet reviewer. A
child card, icon, progress bar or button visible inside the rectangular source
crop but owned by another material must be absent from the isolated backing;
requiring its restoration is a false ownership finding. A second review, if
authorized, uses a new evidence directory and preserves the first result.

The default sheet image prompt starts with the actionable full-reference
instruction, without a `visual-sheet-prompt-v2:` protocol header. A real CLI
image tool call omitted that header while otherwise forwarding the frozen
prompt exactly, making the received image unusable under the exact-prompt gate.
New snapshots omit the non-visual header; old snapshots and their terminal
receipts remain unchanged. Host adapters must still audit the entire frozen
prompt verbatim and stop on any mismatch.

For an interrupted experiment whose compiler has changed, `received_bundle.py`
can verify received requests against a new frozen snapshot before considering
reuse. Selection is explicit per request ID. It checks each source job's immutable
snapshot, authorization and receipt, raw SHA-256, request fields, full reference,
crop, and exact prompt content. A request with an old prompt is rejected even if
its ID and dimensions match. A read-only check may list missing requests; only a
complete set can materialize a fresh, hashed raw bundle. This does not alter old
receipts, claim new provider calls, skip sheet extraction or material gates, or
turn the bundle into a delivered package. The public delivery CLI, statuses and
`ui_layer_composition_v1` remain unchanged; callers must still run the normal
extraction, registration and package checks on the complete verified sources.

## Read-only preview

For a separately authorized single-material prompt comparison, the experimental
executor exposes `prepare --asset ID --prompt-override UTF8_FILE` in a new output
directory. The unchanged snapshot and new prompt hash are bound to a new job
digest. A single-material request inside a grouped snapshot is supported, but
actual sheet requests and multiple selected materials cannot use this override.
Grouped snapshots retain full-reference-only mode. This prepares raw acquisition
only; it does not amend the parent delivery DAG or accept any previous failure.
Existing CLI defaults and the final composition contract remain unchanged.

`preview-groups --snapshot SNAPSHOT --snapshot-digest DIGEST --output NEW_DIR`
verifies an existing snapshot and writes grouping/prompt previews without model
or image calls. Output is `preview_only_new_run_required`, with no job or approval.
It does not fix or approve the source visual plan, and cannot be dispatched.

## Host and consumer compatibility

Existing commands and state names remain. `next` adds `materialIds` and `grid` for
sheets; hosts must treat `asset` as an opaque request ID and forward frozen tool
arguments unchanged. Status adds `generationMode`, `materialCount`,
`requestMaterials` and extraction evidence. Consumers must not equate request
count with material count or assume every raw request is a deliverable layer.

The final ZIP and `ui_layer_composition_v1` remain unchanged: one independently
positioned PNG per delivery material. Docker/Web integrations need opt-in request
mapping/progress support if they make the old one-request/one-layer assumption;
no Docker/Web code is implemented here. Old jobs keep their original runtime.

Offline tests cover receipt fan-out through the real ZIP builder, exact crop
pixels, continuous alpha, wrong identities, visual issues, uncertain transport,
missing/extra cells, faint seam pixels, tampering and no repeat on resume. Real
image generation has been exercised locally, but visual acceptance has not passed.

The preparation change applies only to new runtimes/jobs. Never modify an old
frozen runtime fingerprint or receipt to resume it with this implementation.
Existing failed outputs may be used for explicitly labelled offline diagnostics.
No CLI or final composition migration is required. Hosts relying on extraction
evidence should accept additive prepared-source hashes and actual cell boxes.

Sheet identity review uses the frozen `remove-business-text` policy: ordinary
button captions and counter numbers are expected to be absent from generated
assets. Only each material's `preserveText` exceptions must remain. Reviewers
compare visible outer contours and internal motifs for proportion, rather than
using the rectangular reference crop or deleted lettering as a shape target.
A real review incorrectly flagged removed labels while correctly detecting
widened controls; the prompt now separates these findings. An incorrect text
complaint never cancels a genuine contour error or unblocks extraction.

### Internal layout compilation

Sheet prompt v2 treats each material as one rigid group. For objects with existing
boxes, the compiler emits the original reference region and material-relative
center/size, replacing free-text object labels in generation requests to avoid a
second, conflicting layout instruction. Unboxed objects retain their descriptions;
no missing geometry is inferred. Single-material prompts use the same compiler.
Foreign artwork descriptions are shared once with per-entry exclusion references.

This changes new prompt fingerprints, not ui_layer_composition_v1 or public CLI
fields. Previously frozen requests and approvals remain unchanged and must use
their pinned runtime; a new run/digest is required to test these prompts. No
Docker/Web migration is needed for consumers of the final layer contract.


A targeted reference experiment may select exactly one non-sheet request from a
grouped snapshot using experimental_executor prepare --reference-mode full-and-crop
and an explicit --prompt-override. This binds the original full image, unchanged
frozen crop and variant prompt into a new single-use job. Default delivery and
actual sheet requests remain full-only. A rectangle is localization context, not
an ownership mask: foreign pixels around rounded contours must still be excluded.
Do not silently trim a crop or claim it is a clean isolated reference. Existing
receipts and snapshots remain immutable. Public delivery CLI/composition v1 are
unchanged; no Docker/Web work is included.

For a separate one-material **edit experiment**, `--reference-mode crop-only`
passes only the unchanged frozen reference crop to the image tool. It requires an
explicit prompt variant and refuses sheet requests or multiple assets. This mode
is useful when a full-reference generation or full-plus-crop variant visibly
redrew and distorted a control that only needs lettering and surrounding
background removed. The crop may include adjacent UI pixels; the prompt must
name the owned silhouette and request transparency only outside it. Image edits
still require a fresh digest-bound authorization, exact-argument forwarding,
raw receipt and visual review. A crop-only result is an isolated comparison,
not an automatically reusable source for a full-reference delivery bundle.
For any crop edit, ask for visible transparent space around the complete
silhouette. If opaque artwork touches the generated canvas edge, the existing
clipping gate remains blocking: adding an empty border afterward cannot
restore an end ornament the model may have cut off.

When a received sheet preserves cell identities but visibly distorts controls
whose original crops already contain the complete assemblies, a one-sheet
**edit comparison** may use `--reference-mode sheet-crops-only` with an explicit
prompt override. `next` forwards each unchanged frozen material crop in cell
order (two to four crops), without the full UI reference. The prompt must map
each input image to its grid cell, remove only specified business text and
outside background, and preserve the control's internal proportions and
ornaments. This mode is evidence-driven and experimental; its distinct
reference selection is bound to a fresh job digest and authorization. The
standard sheet identity, material, registration and package gates still apply.
Its raw cannot silently replace a full-reference frozen request in a received
bundle. The public delivery CLI and composition v1 remain unchanged; a host
using this experimental mode must intentionally support multiple ordered crop
references, but Docker/Web consumers of the public package need no migration.

The experimental executor prints ASCII-escaped JSON for host handoff. A real
crop-edit request with Chinese lettering was corrupted when native console
output was decoded before the image call; that accepted call was marked
`indeterminate_no_resubmit`, never received or reused. Hosts must parse the
escaped JSON and pass its decoded `arguments` object unchanged. A regression
test round-trips non-ASCII prompt text through the CLI with ASCII-only stdout.
When auditing a Codex CLI image call, decode the persisted UTF-8 session log
and compare its prompt value with the frozen request. Windows terminal output
may render Chinese glyphs incorrectly even when the stored Unicode code points
are intact. A static `String.raw` prompt is valid only without interpolation,
backslashes or escaped backticks and after an exact text comparison. Unsupported
source forms fail closed; a plausible PNG never substitutes for the audit.


One frozen sheet may use a new, explicitly bound prompt-variant job for a visual
comparison. The default frozen prompt and earlier receipts are untouched. The
optional compact_sheet_prompt compiler emits each original material, its ordered
parts and each part's normalized center/size, plus foreign ownership exclusions.
It emphasizes retaining small icons at their original offset when nearby text
is removed. It omits repeated explanatory JSON from the default prompt; it does
not change material count or permit sheets to use cropped references. A variant
remains an experiment until real visual review supports promotion to the normal
compiler. The experimental prepare CLI accepts a prompt override for exactly
one selected sheet; the job digest binds it and its one-call authorization. This
is an additive host option, with no final composition schema change. Hosts that
used the previous experimental restriction should allow this option deliberately;
Docker/Web code is not changed here.

When shortening a sheet prompt, retain the frozen grid and canvas aspect as
explicit generation instructions. A real six-card variant omitted the canvas
aspect, returned near-square cells, and left some card contours only a few
pixels from the cell cut despite passing the existing non-clipping gate.
Prompt variants remain separate jobs; neither the receiver nor the final fit may
reshape an incorrect card to compensate for a missing generation constraint.
Conversely, a correct sheet canvas aspect does not prove that each material kept
its own aspect: measure the visible per-cell artwork against the frozen material
geometry and review its internal icons before accepting a sheet. A six-card
follow-up restored the canvas aspect but produced consistently widened cards.

The compact variant now states explicitly that each grid cell is transparent
padding, not a target shape: the artwork outer contour and internal parts must
share one x/y scale. This addresses observed flattened card frames in a real
six-card sheet without changing the frozen request or accepting a bad source.

A 1.2x pairwise aspect limit was tested in a separately frozen forest snapshot:
it separated a shorter claim button from two longer resource counters. The model
still widened the isolated button and both counters, despite explicit target
proportions. This experiment did not establish grouping as the cause, so the
default remains the 1.5x rule. Frozen `generation-groups.json` selects either
version during preflight; both snapshots and their raw receipts stay verifiable.
Do not promote a grouping change based only on a separable sheet or receipt.
The generated contour still requires visual review before registration.

Sheet identity review compares each control's visible contour and internal
geometry, not its position inside a transparent grid cell. A real two-control
edit was flagged for unequal vertical padding even though later extraction
uses the artwork bounds. The shared review prompt now excludes that irrelevant
cell placement; it still reports changed overlaps, icon scale, decoration and
other internal geometry. An earlier failed review remains failed and cannot be
rewritten into a pass by this prompt change.

For a received one-sheet variant, `python -m ai_ui_layers.experimental_executor
review-sheet --job JOB --output NEW_DIR` reuses the normal sheet pixel and
read-only identity review gates, then writes independent crops with hashes.
It refuses an unfinished or multi-request job, and the output is explicitly
`selected_sheet_extracted_pending_material_validation`. It is not a replacement
for the complete delivery DAG: no other requests, registration or composition
are inferred, and a failed review cannot be repeated in the same output.

### Exact image-call transport

The official `next` request is the source of the image tool's prompt and full
reference paths. A host that relays it through a model session must compare the
**actual image-tool arguments**, not just the session text, with those frozen
arguments before `receive`. A successful CLI turn or a plausible PNG does not
prove that a long prompt was copied exactly. In a real sheet attempt the CLI
omitted two closing JSON delimiters while relaying a 4.8k-character prompt.
That request was marked `indeterminate_no_resubmit`; its PNG was retained only
for diagnostics. Do not normalize away changed punctuation or submit the same
request again. Create a fresh digest-bound job and obtain fresh authorization.

For future hosts, prefer an exact-argument image-tool adapter when a CLI session
cannot relay frozen prompt bytes reliably. This changes transport only: the
snapshot, reference selection, request and receipt fingerprints, sheet identity
review, material quality gates, and `ui_layer_composition_v1` remain unchanged.

The optional experimental `review-sheet --request-id ID` operation can inspect
one explicitly selected sheet from a complete received job, retaining identical
receipt/hash and visual gates. Omitting the ID retains the one-request-job
requirement. Selection does not authorize regeneration, change other sheets,
or promote the parent delivery result.
