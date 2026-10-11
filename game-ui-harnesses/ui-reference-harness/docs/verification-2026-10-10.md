# Source preview verification · 2026-10-10

Implemented scope: local project/style workspace, ui-panel prototype intake,
deterministic prompt compilation, one-use generation exchange and optional adapter
interface, PNG QA/normalization, explicit human review and uniform-style delivery.

Initial 0.1.0 validation performed:

- `node --test tests/*.test.mjs`: **29 passed, 0 failed**.
- `doctor`: supported Node, panel adapter present, external generation required;
  zero network/compute calls.
- `self-test`: preset rules and runtime fingerprint pass; zero compute calls.
- Skill creator's `quick_validate.py`: passed using a strict plain-scalar
  frontmatter parser for this two-field Skill because the bundled Python lacks
  PyYAML; the remaining upstream validation checks ran unchanged.
- Catalog documentation whitespace check passed.

Behavior covered: two-panel style/anchor inheritance, immutable user style bytes,
style migration and stale prototypes, current menu PanelBundle recompilation,
PNG RGB/grayscale/palette decoding, metadata stripping with unchanged pixels,
terminal technical rejection, digest-bound approvals, competing CLI dispatches,
indeterminate adapter outcomes, same-raw recovery, human rejection, deterministic
ZIP export, checksums, unexpected payload rejection and traversal/link protection.

All test images are synthetic programmatic fixtures and all test generation callbacks
are test doubles. The offline test suite used no real image tool, private service,
GPU or provider request.
No real human visual acceptance is claimed by fixture review records. Real model
layout/style/copy fidelity, complex prototype artwork preservation and artistic
quality remain unverified. PNG limitations and resolution policies are in
the README. This is source-preview evidence, not a tagged production release.

## Manual host exchange

One separate, explicitly authorized image-tool call was executed after freezing
and reviewing its plan. Its returned PNG had different pixel dimensions from the
requested prototype canvas. The CLI preserved the original bytes and receipt,
then terminated the attempt as `rejected_technical` with
`GENERATED_SIZE_MISMATCH`. No repeat submission, image resizing, human acceptance,
project anchor or accepted delivery was performed.

This exposed an integration limitation: a host tool that accepts a size request
only through prompt text cannot guarantee the initial exact-size contract.
That original failed attempt remains rejected under its frozen policy.

## 0.2.0 native-resolution update

- Full offline suite: **37 passed, 0 failed**. No tests call image providers.
- Default native resolution and optional exact resolution are frozen before compute.
- Native bounds and the 1% aspect-ratio boundary are checked with integer arithmetic.
- Logical/pixel canvases and rational transforms are verified in QA and v2 delivery.
- Rehashed manifest/ZIP pairs with a false coordinate transform are rejected.
- A separate zero-call local plan can reuse a verified exact-size rejection without
  changing source records, raw bytes, style, intent or original anchor conditioning.
- Provider dispatch is forbidden for zero-call plans. Invalid/unknown sources,
  reuse cycles, corrupted bytes and changed project context are rejected.
- Synthetic historical terminal records exercise read-only 0.1.0 compatibility;
  local reuse can recover an interrupted deterministic operation.
- doctor/self-test, JSON parsing, schema-reference resolution and whitespace checks pass.

Following the user's native-resolution decision, the earlier manual result was
processed through a new local plan. Technical QA passed with a 704x656 logical
canvas and a 1299x1211 pixel canvas. Decoded RGBA equality and unchanged source-file
checksums were verified. This update made zero image-generation calls and left
the original rejection intact. The new result is `pending_visual_review`; it is
not yet an accepted project anchor or an accepted delivery.

## 0.3.0 style catalog and custom packs

- Full offline suite: **47 passed, 0 failed**. Ten style/catalog tests passed again
  after adding the digest-linked sample-plan review document.
- Six website names and stable IDs are in order; concept-art is explicitly neutral
  readable 2D. UI adaptations record their own version plus character-source
  identity/version/SHA. No character-only generation or redesign rules are imported.
- Custom data-only UI packs support exact-version built-in inheritance, project
  rule overrides, optional primary PNG, and standalone rules without an image.
- Original pack, base pack and PNG bytes are snapshotted. Resolved rules are rebuilt
  during load/export validation; rehashing a manifest and ZIP cannot hide changed sources.
- Tests reject provider/script/character fields, traversal/device/link paths,
  conflicting primary inputs, oversized packs and invalid inheritance/version budgets.
- Known 0.2.0 outputs remain verifiable, reviewable and usable as same-style anchors;
  archived compute cannot be authorized, dispatched or finished.
- Six independent sample workspaces were prepared with one identical 960x800
  prototype, copy and saved state. The user explicitly approved all six concrete
  drafts; the CLI recorded that decision and froze six individual one-call plans.
- At that implementation checkpoint, the plans were awaiting_authorization and
  no image-generation calls had been made. The separately authorized host trial
  is recorded below; no human image acceptance is claimed.
- doctor/self-test, Node syntax and JSON parsing checks passed. Existing real
  pending-review image remains verifiable; no old attempt or result was rewritten.

## First six-style host generation trial

After the user's separate compute authorization, the CLI bound one authorization
to each of the six frozen plan digests. Each request was reserved before exactly
one built-in image-tool call. Frozen prompt and ordered layout PNG were forwarded
unchanged; no resubmission or provider fallback occurred.

All six results passed technical QA at 1374x1145 pixels for the shared 960x800
logical prototype. Original PNG bytes were retained; decoded RGBA equality after
normalization, receipts, plan/style identities and result hashes were verified.
All six remain pending_visual_review with no human review, accepted anchor,
accepted export or default-art-catalog registration.

Visual observations include closed dropdowns changed to parallel options in the
pixel and Chinese-fantasy drafts, smooth gradients in the pixel draft, a pink
primary button in the anime draft, and added landscape scenery/tab-width changes
in the Chinese-fantasy draft. These observations are not human acceptance records.
Real style/layout/copy fidelity is not established by the technical passes.

## 0.4.0 closed-Select semantics and scoped correction plans

- Full offline suite: **51 passed, 0 failed**. No provider calls in tests.
- The observed failure is reproduced by a historical compiler fixture that exposes
  all Select options. Current compilation projects only the selected label and
  explicitly freezes one closed field with a down-chevron; RadioGroup semantics
  remain distinct. Existing prototype blobs are not rewritten.
- A scoped correction snapshots a verified result, freezes visible Select target
  IDs, same project/prototype/style and source-plan identity, and places the source
  PNG first in the ordered request. An unaccepted source is edit context only.
- Tests verify fresh one-use compute, no resubmission, unchanged source files,
  invalid targets, changed style, rehashed source/parent tampering and self-reference
  rejection. Correction source chains and zero-call reuse of correction attempts
  are prohibited. Accepted correction exports retain verified source PNG evidence
  without private run paths.
- Known 0.3.0 output requests reconstruct with the original compiler and remain
  read-only, reviewable and usable as correction sources. All six real first-round
  image/plan/request identities were checked unchanged after the runtime update.
- doctor/self-test pass with zero network/compute; runtime modules import and JSON
  files parse successfully. Two new correction plans are prepared separately for
  the pixel and Chinese-fantasy images; this update makes no new image calls and
  records no new compute authorization or human acceptance.
- Source preservation outside the dropdown is an editing instruction, not an
  automated pixel-equality guarantee. The newly generated image still requires
  visual checks of the dropdown, unrelated regions, style and exact copy.

## Authorized two-image correction trial

After a separate explicit user compute decision for the frozen correction plans,
the CLI authorized and reserved each request once. The built-in image tool edited
each source once with the unchanged frozen prompt and ordered source/layout PNGs.
There was no resubmission or additional generation.

Both outputs passed technical QA at 1374x1145 pixels, including original-byte
retention, lossless RGBA normalization, receipts and digest verification. All
files in both original source runs matched their pre-execution fingerprints.
Agent visual inspection found a single closed quality dropdown showing only the
selected high-quality label and a right-side down indicator in both images.
Other major appearance was visually close to the sources; pixel equality outside
the target was not claimed. Both outputs remain pending_visual_review, with no
human acceptance, accepted export or default sample registration recorded.

## Accepted local default sample package

After the user's final visual feedback, the two corrected outputs were recorded
as accepted for layout, style and copy. The other four original outputs were
accepted using the earlier feedback that only the dropdown issue needed repair.
The deterministic review API retained the exact user feedback in each private
record. No project anchor was selected on the user's behalf.

All six current-style projects exported independently and passed delivery
validation. A private deterministic finalizer assembled the six deliveries into
a portable local preview catalog and a ZIP, checking style/image/prototype
identities, each delivery, the complete file allowlist and exact ZIP bytes.
The catalog contains relative artifact paths and neutral metadata, with no private
run paths, approval text or provider configuration. Images remain external to the
source tree. This finalization made zero image-generation calls and does not
implement website integration or automatic runtime loading of the local catalog.

## 0.5.0 explicit local sample intake and consistency preparation

- Full offline suite: 57 tests passed. New synthetic fixtures cover six catalog
  deliveries, CLI preview/import, PNG snapshot independence, absence of automatic
  style/compute approval, project-only anchor provenance, catalog resealing attacks,
  conflicting inputs and linked catalog roots. No test calls a real provider.
- Known 0.4.0 plan-v3 results remain read-only, reviewable and exportable. New
  compute and deterministic finish on archived plans remain forbidden. The two
  real accepted correction results were inspected with executable=false and their
  image fingerprints unchanged.
- The explicit catalog loader validated all six actual local default deliveries,
  including exact ZIP bytes, accepted state, immutable built-in rules and the
  recorded image/style/prototype/canvas identities. The source ships no artwork.
- doctor/self-test pass with zero network/compute. Schema JSON parses. The local
  catalog is a user-selected integrity-checked package, not an authorship proof.
- The selected concept-art pilot now has three prototypes compiled through the
  public panel producer: settings, a vertical-button main menu and a compact
  two-button exit confirmation. All use the same 960x800 logical canvas.
  Existing reviewed concept-art rules/palette and the accepted sample PNG are
  frozen as one project style. The first settings plan is awaiting_authorization,
  with layout-reference and primary-style only. No project anchor exists yet.
- This preparation makes zero new image calls. Multi-panel visual consistency
  remains unverified. The menu/dialog plans will be frozen after the human accepts
  and explicitly chooses the first representative panel as the project anchor.
  Website integration remains outside this local CLI preview.

## Authorized concept-art pilot: first panel

The user explicitly authorized the frozen first settings plan. The deterministic
CLI recorded that exact decision and reserved its request before one built-in
imagegen call. The frozen prompt and two ordered PNG inputs were forwarded
unchanged. No retry or other-panel generation occurred.

The received PNG passed technical QA at 1374x1145 pixels on a 960x800 logical
canvas. Raw bytes, receipt, lossless RGBA normalization and hashes verified.
Agent inspection observed the saved settings state, a single closed high-quality
dropdown and appearance close to the selected concept-art sample. This is not
human acceptance or pixel-identity proof. The image remains pending_visual_review;
no project anchor, accepted pilot export or multi-panel visual claim exists yet.

## Accepted first-panel anchor and remaining plans

The user subsequently confirmed the first settings image and its use as the
project's visual anchor. The deterministic review API recorded acceptance for
layout/style/copy with the user's exact feedback and useAsAnchor=true, then
snapshotted the accepted PNG under the active style revision. Original image,
raw evidence, frozen request and compute records were retained.

The main-menu and exit-confirmation plans now freeze that same accepted anchor,
primary-style image and project style revision, each with its own validated
prototype and one-call limit. Both await fresh compute decisions. This planning
step performs zero image calls; cross-panel visual consistency remains unverified
until those images are generated and separately reviewed.

## Authorized same-project menu and confirmation trial

After the user's explicit authorization for the two frozen plans, the CLI
created separate single-use authorizations and reserved each request before its
one built-in imagegen call. Both requests forwarded their frozen prompt and the
ordered layout-reference, primary-style and accepted-project-anchor PNGs. The
two calls had no retries or additional generation.

Both received PNGs passed technical QA at 1374x1145 pixels on the same 960x800
logical canvas. Original bytes, receipts, hashes and lossless RGBA normalization
were verified. Their shared style and accepted anchor identities were checked
against the frozen plan set, and the original accepted settings anchor remained
unchanged.

Agent comparison observed matching blue/gray palettes, gradient header strips,
light frames, shadows and primary/secondary button treatments. The menu retained
three vertical buttons; the confirmation retained two horizontal buttons and its
main copy. The menu title appeared larger than the anchor's title and its panel
proportions/position drifted from the prototype. The confirmation also still
requires geometric review. These observations do not establish exact layout,
typography or pixel identity. Both new images remain pending_visual_review, with
no human acceptance or whole-project export recorded.

## Accepted reference-use three-panel delivery

The user accepted the two remaining images for their intended reference-image
use after the observed title-size and panel-proportion differences were shown.
The deterministic review API recorded layout/style/copy acceptance with the
user's exact feedback. The existing settings anchor was retained; neither new
image replaced or extended that anchor. No new image calls occurred.

All three panels now report accepted_current_style under one immutable concept-art
style revision. The default whole-project export included all registered panels,
style-pack/primary-image snapshots, the accepted anchor, prototype projections,
provenance and handoffs. Standard validation passed for three panels, including
checksums, canvas mappings, the complete file allowlist and exact ZIP rebuilding.
The two derived-panel provenance records point to the same accepted anchor;
original settings raw/image/review fingerprints remain unchanged.

This validates the project-style to accepted-anchor to multi-panel-reference to
whole-project-delivery workflow for this pilot. Known visual differences remain
documented. Acceptance for reference use does not establish pixel-level layout
or control identity, every default style, complex UI, or downstream integration.

## 0.6.0 reusable same-project planning

The private pilot orchestration is now represented by public plan-project and
inspect-project-plans commands and library exports. Planning requires a fixed,
accepted current-style anchor and defaults to pending panels, with optional
explicit subsets, panel intents and a shared native/exact resolution policy.
All requests are checked under one project lock before run publication. The
sealed collection binds every plan/request/prototype digest to the shared style
and anchor; its review document links the frozen requests. No compute approval,
provider submission or retry occurs during preparation or inspection.

Offline validation: 64 tests passed, including seven new project-plan tests for
anchor choice, shared identity and optional inputs, all-request preflight, lock
behavior, disclosed subsets, stale contexts, resealed substitutions, completed
project no-op behavior and known 0.5 result compatibility. Doctor/self-test passed
with zero network/compute calls. Root catalog statements now reflect the accepted
six defaults and three-panel pilot; host integration is documented separately.

Read-only validation of the real pilot under 0.6 confirmed all three panels remain
accepted_current_style, all image fingerprints match the prior accepted record,
and the unchanged three-panel delivery still validates. Planning that completed
project returned nothing_to_plan with zero maximum/compute calls and no new plans.
Known 0.5 requests remain inspectable, reviewable, usable as accepted anchors and
exportable, but cannot acquire fresh authorization, dispatch or finish. No media
generation, website implementation or production release occurred in this step.

## Optional local reference workbench 0.1.0

The user subsequently requested a local website. The isolated web/ package now
provides a React/Vite frontend and loopback host calling the unchanged 0.6.0
core. It supports project persistence, default/custom style drafts and activation,
prototype import, immutable plan inspection, single-use authorization, generation
exchange or optional adapter, separate visual decisions, fixed anchors, remaining
panel planning and validated whole-project ZIP downloads. The supplied real
showcase remains read-only; real images are external private inputs, never bundled.

Offline verification passed all 64 core tests and six host/API tests. Host tests
exercise foreign-origin/path rejection, zero-compute planning, one reservation,
required human decisions, accepted-anchor inheritance, whole-project download
validation, terminal adapter uncertainty, read-only showcase and byte-exact custom
pack/PNG snapshots. The production frontend build and formatting check passed.

Browser/IAB verification exercised project creation, reviewed style activation,
prototype import, frozen request, explicit single-use authorization, two synthetic
provider results, explicit review and anchor selection, pending-panel planning,
validated ZIP download and style-change invalidation in an isolated test workspace.
Selecting a style no longer submits the enclosing form. The real six samples and
three accepted panels were checked read-only. Desktop 1536x1024, the browser's
1280x720 viewport and mobile 390x844 were inspected; mobile gallery/detail fit
without horizontal overflow. Design and browser screenshots were compared with
view_image and recorded privately. No real Harness generation or production
release occurred; live one-click generation requires a separately configured adapter.

### New-project cancellation regression

The initial browser flow published a project immediately after its name was
submitted; cancelling the following style dialog left that empty project behind.
The name step now stays in client state. Style previews use an unpublished draft,
and only the explicit final style/project decision activates and publishes it.
Draft identity, project name and style digest are checked together; repeated final
requests return the same project without creating another activation. General
buttons default to type=button, with the three form submissions explicitly typed.

All seven host/API tests, the frontend build and formatting check passed. Browser
checks covered name/style/preview cancellation, close and Escape, reload without
an extra project, one successful confirmation, and mobile 390x844. The rendered
page had no relevant console errors or framework overlay. The live localhost
service was restarted and the user's existing project list was preserved. No
existing empty projects were silently deleted and no media compute occurred.

### Whole-workbench bug audit

The follow-up audit covered project creation and selection, style drafts,
prototype file intake, generation failure/recovery, visual decisions, fixed
anchors and accepted-version export. The core runtime remains unchanged.

Confirmed fixes in the optional web package:

- Single-flight mutations, disabled navigation during pending operations and
  identity-checked reads prevent old requests from replacing another project's
  view. Selecting the current project is a no-op. Bootstrap/project/run reads
  expose loading and recoverable errors instead of silently showing empty state.
- Media actions refresh the persisted run even on failure, preserve the original
  error and never resubmit automatically. Inspection failures have a read-only
  retry. Terminal attempts show that a new plan requires a fresh decision.
- Import format changes remount file inputs and clear old payloads. Retained
  style files are named explicitly; changing source mode clears them. Missing,
  malformed or oversized files and failed network reads produce bounded errors.
- Review controls bind to the displayed run/image and require the reference
  preview. Gallery status describes the latest attempt; project ZIP export uses
  the latest accepted version. The difference is disclosed while an optimization
  remains unaccepted.
- The anchor viewer reads the verified fixed image directly. Optimizing its
  panel cannot redirect the viewer to a later result. A panel with no image or
  baseline is never labelled as an anchor.
- A custom pack whose primary path is reference.png reuses the exact uploaded
  bytes instead of colliding with the upload filename. One damaged project is
  marked unreadable without blocking other projects or startup.

Verification passed 64 core tests plus 16 web/API/state tests, including parallel
submission reaching one provider double, terminal failure refresh, corrupt-project
isolation, custom-reference byte identity and old/new accepted-version export.
The frontend production build and formatting check passed.

Browser checks used an isolated synthetic adapter and workspace: creation,
single-use authorization, prototype-preview review blocking, acceptance/anchor,
an explicitly injected terminal failure, a fresh optimization with a different
pixel size, fixed-anchor identity, format switching, malformed JSON, cancellation
and reload. Live read-only checks covered project selection, accepted filtering,
showcase protection and loaded images. Desktop 1280x720 and mobile 390x844 were
checked, including detail/anchor dialogs without horizontal overflow. The local
service was restarted with the original three-project list preserved. Private
screenshots are recorded under ignored work/ui-reference-studio/design/.

This audit establishes the tested local workflows, not absence of all possible
bugs. Tests made no real provider requests. The live service remains in explicit
input-package exchange mode; online adapter/network behavior was not exercised.

### Recoverable project deletion

The workbench now has a project-level delete confirmation and a separate recycle
bin with restore. Cancellation makes no mutation. Deletion atomically marks only
host metadata, preserves the original project/export files and hides the project
from the active list. Archived reads, mutations and old asset/download links are
blocked until restoration. Restore retains the original identity, authorization
and attempt history. No permanent-delete operation is exposed. Showcase projects
are protected, and a running host adapter call blocks deletion. Damaged project
contents can also be archived/restored without pretending that they are valid.

All 18 web/API/state tests passed. New regression evidence covers byte-exact
project/export preservation, accepted anchor identity, idempotent delete/restore,
blocked archived access, single-use authorization after restoration, last-project
deletion, same-name isolation, persisted deletion across host restart, corrupt
project recovery and in-flight compute protection. Core source is unchanged.

IAB checks exercised cancel/reload, delete-last-project, recycle-bin persistence,
restore with the original style/prototype, and mobile confirmation/bin layouts at
390x844 without horizontal overflow. Screenshots use synthetic private fixture
projects. Real user projects were not deleted or modified during verification.

### Unified style options

The default/custom mode tabs were replaced by one seven-card selection grid in
both the style dialog and library. The custom option expands its upload/base-style
fields below the same grid. Selecting a preset hides and clears custom files;
selection buttons never submit the form. The first-stage button now reads 确认,
while the existing reviewed activation/final project confirmation remains intact.

The build and formatting check passed. IAB checks covered all seven choices,
custom expansion, preset switching, review entry through 确认, cancellation/reload
without publication, successful synthetic project creation and library-to-custom
entry. Desktop and mobile 390x844 showed no horizontal overflow or relevant
console errors. The live six-sample grid was verified without creating a project
or changing a style; the user's open old-version form was preserved for refresh.

### Custom style input for ordinary users

Custom style now presents the reference PNG and optional description directly.
The base preset and existing JSON rules import live in a collapsed optional
advanced section, with explicit copy that rules files are supplied by development
teams and are unnecessary for ordinary use. A retained import filename remains
visible in the advanced summary. Existing review and final confirmation gates
are unchanged; no image analysis or provider call was added.

The production build and formatting check passed. IAB verification created a
synthetic project using only a reference PNG and description, checked the
reviewed image/notes, returned to adjustment with retained inputs, expanded the
advanced section and completed final confirmation. Desktop 1280x720 and mobile
390x844 rendered without horizontal overflow, console warnings/errors or a
framework overlay. The isolated host recorded no generation calls. Screenshots
remain under ignored work/ui-reference-studio/design/. No live project data was
changed by this verification.

### Unified prototype upload and illustrated examples

The import dialog now has two entries: public examples and one prototype upload.
JSON format is recognized from its top-level producer marker; ambiguous or
unrelated documents are blocked before submission. Specs expose the optional
catalog, while complete bundles reuse their own authored inputs. Changing import
mode clears retained uploads, and pending imports disable form/navigation actions.
The upstream validators and original core import remain authoritative.

All three public examples now have thumbnails and a linked selected large
preview. Read-only SVG layout illustrations use the public producer compiler and
core visible-node projection, retain the initial selected tab/dropdown state,
escape text and clip geometry, and are explicitly labelled as illustrations.
Preview requests write no project files and never invoke an adapter.

All 20 web/API/state tests, the production build and formatting check passed.
IAB checks at desktop 1280x720 and mobile 390x844 covered all three preview
selections, actual spec import with the default catalog, complete-bundle import,
example import, unrelated-JSON rejection, mode reset and cancellation. Images
loaded, the dialog had no horizontal overflow, and the console/overlay checks
were clear. The synthetic fixture recorded no generation calls. The live local
host was restarted with unchanged active/trash project identities; its preview
images were checked read-only and the user's existing tab was preserved.
