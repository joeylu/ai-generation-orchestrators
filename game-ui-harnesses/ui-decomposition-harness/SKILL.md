---
name: ui-decomposition
description: Split a UI reference into important reusable components and deliver a reviewed layered PSD or named PNG ZIP with deterministic local tools.
---
# UI Decomposition

Use this Skill when a user wants one UI reference image turned into editable
important components and a layered PSD or named PNG ZIP. This is an opt-in experimental route. It
does not apply to character animation, ordinary background removal, or a request
for pixel-perfect manual Photoshop reconstruction.

## Workflow

First select the requested deliverable. For reference-to-PNG decomposition only,
follow [assets-only v1](docs/assets-only-v1.md) and use `ai-ui-assets`. Stop at the
named PNG ZIP. Do not request shop facts, native UiDocument, state evidence,
appearance bindings, consumer setup, browser/Studio acceptance or v2 reference
scope for that task. Keep original material/source/review gates and timing.
The component workflow below applies only when runnable UI delivery is requested.
An asset ZIP does not establish interactive or human visual acceptance.

When delegating an authorized file-tool run, give the executor the frozen run,
digest and exported entry once; do not ask it to repeat planning. The loop emits
`completion-ready` after writing `completion.json` beside the exported entry. The coordinator may
read that small handoff immediately, verify official generation status, and begin
processing without waiting for a narrative reply. Keep tool time, dispatch/setup
and post-generation handoff time separate. Missing completion is not permission
to replay a request; inspect the durable journal and official state first.

Before freezing an assets-only plan, perform the independent reference inventory
and removal/ownership cross-check in [reference coverage](docs/reference-coverage-v1.md).
Scan the reference itself, including edge attachments, leather straps, clasps,
ties and ornaments; do not substitute the existing asset list for this scan.
Use `coverage-check` and `coverage-bind`; unresolved important elements block
new generation. At composite review recheck every declared element. Missing
important artwork is incomplete reference coverage, even in a technical draft;
do not treat it as an ordinary texture difference. This is caller visual review,
not automatic semantic detection. Never mark the review complete without looking.

For asset-only tasks, do not equate one output PNG with one generation call.
Review similar-material grouping with [independent asset boards](docs/assets-boards-v1.md)
before freezing the budget. Use the public board compile/freeze/preflight/process
commands; do not import a component DAG or hand-author successful extraction
receipts. Keep backgrounds, illustrations and unlike aspect ratios separate.
The chosen groups and extraction rules require review; fewer calls alone do not
establish better quality. Materialize boards into individual PNGs before delivery.

Begin [end-to-end timing](docs/timeline-v1.md) at reference input, before inspection.
Record every phase including planning, authorization waiting, generation, manual
review, code/environment repairs, processing, tests, packaging and acceptance.
Finish only at the final package handoff and attach the complete phase table and
JSON. Use explicit boundaries for Agent work and main CLI `--timeline` for commands;
unclassified gaps must stay visible. Never substitute generation-only duration for
total elapsed or claim historical file timestamps are measured phase durations.

For the bounded single-panel shop profile, use
[compact shop facts v1.0](docs/shop-facts-v1.md). Supply observed text, source
geometry and explicit derived runtime decisions once; the deterministic compiler
expands native components, repeated row children and references. In the repository
DAG select `planningProfile:"shop-facts-v1"` explicitly. Do not copy a previous
sample's native JSON or use this profile for unsupported layouts. Unknown
required observations block compilation; compact facts do not establish image
recognition accuracy or remove the fresh plan-bound generation authorization.
For this shop profile, explicitly record owned static icon tiles, visible symbol
support, row border weight, checkbox polarity and Panel dividers through the
optional materialObservations in that contract. Do not remove a declared static
backplate as though it were the enclosing runtime control. Verified fully visible
static interiors or divider strips may use the bounded reference-copy operations
in [processed-material refit](docs/material-refit-v1.md); inspect safe rectangles,
bind original bytes and preserve unknown states. Copying opaque pixels with an
authored margin is not Alpha recovery. Occupancy checks do not recognize missing
tiles, arbitrary residual text, or incorrect artwork colors.
For each observed selected/checked state, review the fill separately from the
outline and state mark. A blue outline does not establish a blue selected fill.
Record all visible differences in the frozen material observations, then compare
the assembled state against the reference before full browser acceptance. Report
an omitted fill or misregistered mark as a remaining visual defect even when
distinct-pixel, Alpha, geometry and interaction checks pass; never silently
recolor a generated surface or spend another generation attempt to hide it.
For matching monochrome Tabs glyph states, declare the native 1.2
[planned glyph derivation](docs/planned-glyphs-v1.md) using one canonical glyph
and explicit solid palette ROIs in the original reference. Generate the canonical
glyph only; the program verifies provenance and preserves Alpha for the derived
state. Distinct states must differ in actual pixels. This bounded route does not
support arbitrary multicolored icon recoloring.

For explicit native UiDocument plans involving Tabs/Input/Select/List/CheckBox,
vertical ScrollView or left-to-right ProgressBar,
use [native delivery input 1.0](docs/native-delivery-input-v1.md) through the
existing repository DAG. Preserve the consumer's props, appearance and reference
state contracts; this expands the supplied-data compiler, not the legacy
four-type vision prompt. For quantity, arithmetic, filtering, sorting and owned
List children, use [consumer linkage integration](docs/component-linkages-v1.md).
Require explicit versioned capability coverage and canonical source row geometry;
single-control base support does not establish cross-component acceptance.
For repeated ordinary Image symbols at the same size, use the bounded
[shared Image source v1.0](docs/shared-image-materials-v1.md) declaration and
retain every component's own layer binding and rectangle.
For an already received batch rejected by material quality, use only an explicit
[reviewed material recovery](docs/reviewed-material-recovery-v1.md) specification
bound to the original raw bytes. Preserve the failed report and every foreground
pixel; new extraction/Alpha declarations require independent validation. Never
turn a failed quality receipt into a pass or infer a new generation authorization.
For empty-frame fitting and monochrome state families, use the explicitly bound
[processed-material refit](docs/material-refit-v1.md) recipes. Declare canonical
glyph/palette provenance for derived color states; never claim independently
generated silhouettes have matching Alpha. Keep common-alpha repair limits intact.
For new frame-based handoffs, provide visibleMaterialGeometry at build time,
including visible extent and explicit ornament/text reservations. Missing declared
paint geometry is missing coverage, not automatic visual acceptance.

For title/subtitle roles in the four-type delivery compiler, provide
[source-relative text geometry](docs/text-geometry-preflight-v1.md) before compute.
Check real rendered center and width, not only authored font size and containment.
Missing geometry is missing coverage; never silently describe it as verified.

For single-row keyed component boards whose precise generated placement cannot
be guaranteed, explicitly plan [foreground-gap extraction](docs/foreground-gap-extraction-v1.md).
For uncertain canvas whitespace or icons containing disconnected strokes, evaluate
[content-based extraction 1.1](docs/content-gap-extraction-v1.1.md) before freeze.
For mixed-size icons, explicitly evaluate [mixed-size separation 1.2](docs/content-gap-extraction-v1.2.md)
instead of requiring the largest icon's full margin around each small neighbor.
For a grid glyph with observed disconnected columns and rows, explicitly declare
[glyph-column extraction 1.3](docs/content-gap-extraction-v1.3.md) before freeze.
Record its exact column/row-group counts and local gap evidence; do not enlarge the
global threshold or infer merges from the required number of assets. Existing
failed raw images require a separate revision and can still fail other gates.
For clear key gaps rejected only by the older height-multiple margin, evaluate
[verified gap separation 1.4](docs/content-gap-extraction-v1.4.md). It requires
external gaps wider than allowed internal merges and a verified pure-key cut
moat; it does not weaken part count, geometry or visual acceptance checks.
For reviewed independently connected objects, evaluate
[connected silhouette extraction 1.5](docs/content-gap-extraction-v1.5.md).
It preserves narrow verified key gaps without proximity merging; fragmented or
touching objects still fail. Do not require a wide visual gap solely for extraction.
When a returned empty frame has the wrong whole-image aspect, evaluate a
[measured nine-slice revision](docs/measured-frame-fit-v1.md). Inspect its actual
corners and stretch-safe bands; bind support pixels and raw fingerprints. Do not
apply guessed insets to icons or treat material-only revision as a successful
generation receipt. This is deterministic processing, not automatic regeneration.
For a returned row with a separately measured state mark and divider, the same
contract's protected-grid 1.2 may preserve the uniformly scaled mark and corners
while fitting reviewed empty bands. Bind the actual support hash and every grid
boundary; inspect the assembled output. It cannot add a missing fill, repaint
artwork, infer landmarks or turn an unreviewed row into visual acceptance.
Declare its bounded gap and per-part aspect tolerances; do not increase them after
failure or silently migrate a 1.0 receipt. This validates geometry, not identity or
paired-state Alpha agreement. New repository jobs use batch-end quality checking:
collect all authorized images, then report every material's quality failures before
processing. Retain ambiguous failures; do not retry or publish failed materials.
Use actual empty gaps for cuts and deterministic contain fitting; do not require
pixel-perfect generated partition lines. Preserve count, separation, edge and
semantic-review checks. Existing frozen attempts need separate revision evidence,
never an in-place strategy or receipt rewrite.

For local workflow development or offline MCP simulation, see
[the fixed DAG prototype](docs/local-workflow-v1.md). New repository jobs'
immutable `deliveryProfile:"staged-draft-v1"` requires a real
default preview and explicit `awaiting_review` stop before full acceptance.
Review that exact reference/runtime/contact bundle; rejected or unknown review
never starts full acceptance. Reference unknowns may produce only
`completed_diagnostic_draft` with unchanged ZIP, diagnostic sidecar and receipts
after technical checks pass. This is not a reference pass or accepted final;
technical/visual failures still block. Existing jobs are never silently migrated.
Its lifecycle controls and four-type compiler are implemented. The repository adapter connects the official
v2 build entry and supports supplied-response preflight; real MCP execution still
requires new plan-bound authorization. The file bridges support
subagent/MCP transport via immutable `generationMode:"file"` and `reviewMode:"file"`; use their one-use
assignments and verified receive command, never hand-write DAG receipts or repeat
an assignment. New file bridge jobs require recording the exact tool arguments
with `workflow-record-submission` immediately before the single external call.
Invoke using those same recorded arguments, never reconstruct the prompt. The
serial [single-exchange entry](docs/generation-exchange-v1.md) combines receive,
next assignment and exact argument return. Forward those arguments directly in
the same tool orchestration cell to avoid separate Agent/file-read round trips;
retain per-call and whole-phase timings separately. No parallel dispatch is implied.
For the Windows PowerShell tool host, use the official `workflow-export-loop`
entry after fresh authorization, as documented in
[continuous serial loop](docs/continuous-generation-loop-v1.md). Execute the
exported packaged script unchanged in one awaited tool cell; do not rebuild its
exchange, persistence or path-resolution callbacks per task. It reads the frozen
budget, validates fresh job state, binds exact arguments and writes its timing
summary to the exclusive journal. Export itself never generates or authorizes.
For other hosts with verified result-path resolution and durable event storage, use the
[continuous serial loop](docs/continuous-generation-loop-v1.md) to avoid returning
to the Agent after every image. Validate its host callbacks first; an unknown
response format or interrupted call stops the loop without retry. Offline loop
completion does not establish real generation speed or visual acceptance.
The
record proves caller intent, not independent provider execution. Inspect status
for assigned/invocation_recorded/received progress. New repository jobs freeze
`materialPreflight:"after-generation-v1"`: received means transport complete with
quality pending, not material acceptance. Geometry, Alpha and key-background
checks run for all images after generation, before preview or packaging; failures
produce one per-material report and block delivery. Budget, request/source identity,
decode/resource limits and indeterminate outcomes still stop immediately. Existing
jobs retain their frozen `per-image-v1` behavior; never migrate old receipts.
Initial vision/repair still require a supplied response or trusted provider
configuration. The
separate test adapter uses synthetic fixtures. Do not present fixture
completion as user-artwork, Studio or visual acceptance. Keep existing full
delivery and plan-bound compute authorization requirements below.

For every new full component handoff use the
[layout-gated delivery entry](docs/layout-delivery-run-v1.md). Record complete
Panel/Text background ownership, opaque/translucent popup intent, Button text
profiles and visual text observations before compute. Declare required profiles
in capability-check; do not omit unsupported translucent popup requirements.
For per-line Button text use the consumer's [labelLines 1.0](../ui-component-harness/docs/button-label-lines-v1.md)
and declare `per-line-text-layout`; provide an observation for every rendered line.
Measure visible Alpha support as well as the PNG canvas: equal canvas widths do
not establish aligned visible field edges. Refit existing empty frames only with
explicit measured nine-slice insets, and fit arrows/marks with explicit contain
insets. Imported materials may use these existing resize policies without media
calls; the frozen plan preserves the original source fingerprint. Never stretch
an ornament through a resizable band or call changed material bytes unchanged.
For observed decoration-to-text gaps, aligned visible field edges and icon/mark
padding, declare [explicit visual relations](docs/visual-relations-v1.md) inside
visualObservations before acceptance. Bind source ROIs and Alpha fingerprints to
the actual inspected paint regions. A native canvas-size match or text-only
containment does not cover these relationships. Record absent coverage explicitly;
the checker does not recognize arbitrary painted ornaments or infer relationships.
After materials are verified, use `handoff-job` (data-only build plan) or
`delivery-run` (existing v2 ZIP), instead of writing a per-sample packaging script.
Legacy stateful acceptance alone does not establish reference-layout fidelity.

Apply [bounded delivery and focused verification](docs/execution-efficiency-v1.md)
to every new sample. Separate sample execution from tool development, diagnose
affected controls before full interaction/Studio roundtrip, and run final full
acceptance after the candidate stabilizes. Targeted checks never publish an
accepted ZIP. Record phase timings and honor the local acceptance deadline;
never weaken quality gates or retry generation to meet a latency target.

For an explicitly user-requested single-approval draft with conditional replacements,
use [bounded execution](docs/bounded-execution-v1.md). Freeze every candidate prompt
and the shared budget before authorization. Replacements are distinct pre-approved
single-use requests, never resubmissions of unknown jobs. A user-approved keyed
route is the default for new plans: fixed solid #F808F8 followed by deterministic
local matte. Native transparency requires an explicit plan choice; never silently
change a frozen route or promote a provider merely because its version changed.

Before freezing a new reference sample, follow [component capability preflight](docs/capability-preflight-v1.md). Declare every required layout/state profile, run capability-check, and pass that plan-bound request to freeze --capabilities. Do not omit unsupported profiles to pass; type coverage is not variant coverage.


When a Slider or ProgressBar has visible numeric text, or a List has a visible
selected-item text label (consumer contract 1.1), follow
[value text integration](docs/value-text-bindings-v1.md). Declare its explicit
source/target relationship using the consumer contract, attach it through the
official CLI, and test actual rendered text after real input. Do not leave a
fixed reference numeral beside a changing control or infer bindings from names.

When delivering Select/Tabs appearance states, preserve confirmed optional
`fieldTextColor`/`activeTextColor` as described in references/contract.md.
Never infer state text colors from runtime luminance or bake text into art.
For explicit Select selected/hover backgrounds, follow
[menu highlight integration](docs/select-menu-highlights-v1.md). Preserve the
consumer's versioned menuHighlights and popupContentLayout, with selected taking
priority over hover. No inferred palette or new default for legacy packages.
For vertical Tabs, use the consumer's explicit versioned
[Tabs layout policy](docs/tabs-layout-v1.md), preserving native per-tab geometry,
state assets and independent content layouts. Never infer direction or replace
Tabs with buttons to bypass a missing capability.
For Tabs background ownership use the consumer's
[Tabs background contract](../ui-component-harness/docs/tabs-background-v1.md):
author semantic props.drawBackground=false when the parent Panel owns the exposed
background. Keep tab/state PNGs transparent and preserve icons/text/hit regions.
Do not add a states.tabs synonym or remove the plate globally for old packages.
Check actual exposed corner pixels against the parent, not only PNG Alpha.
ScrollView source thumb texture height must not determine contentHeight or final
thumb length: supply observed viewport/content semantics and track geometry.
For decorated tracks use [scrollbar end insets](docs/scrollbar-insets-v1.md), measured
from the registered track edges. Preserve ornaments and verify both real overflow
and zero-range behavior through actual Studio input.
Explicitly authorized content-bottom whitespace follows
[bottom-space planning](docs/scroll-bottom-space-v1.md). It changes existing
contentHeight only, preserves original unknown scroll evidence, and must never
be applied as a default 20px overflow policy.
Every new ScrollView must explicitly record bottom whitespace (including zero
with a reason). For Panel footer controls, declare the measured inner border and
minimum gap; check it with layout_spacing.check_layout_spacing before packaging.
Do not substitute outer-frame containment for usable-area padding. Keep text and
buttons separate, and verify the applied runtime document against the same plan.

For an explicitly authorized unattended draft, use `auto-run` and the configured
optional provider as described in [docs/headless.md](docs/headless.md). It consumes
two vision calls and a bounded number of image calls: planning first, then a mandatory
post-generation visual-quality assessment over the reference, assembled preview and
contact sheet. The default strict policy exports only after that assessment passes;
an explicitly deployment-selected advisory policy can export a warning-marked draft
when it rejects or is unavailable. Do not substitute either route for a requested
reviewed delivery. Never invent an
accepted `review.json`; retain the original reviewed workflow below.

When the user supplies an already generated, visually inspected 4x4 transparent
asset board in the canonical 16-component order, use the offline `split-board`
command documented in [docs/headless.md](docs/headless.md). It performs no provider
call and produces an explicitly unreviewed `.draft.zip`; report that technical
Alpha, slot and archive validation does not establish full interactive-state
coverage or human acceptance.

1. Run `doctor` and `self-test`, then use `init` to copy an oriented reference and
   create a digest-bound starter plan. Create an `ai_ui_decomposition_plan_v1`
   from that starter. Read
   [references/contract.md](references/contract.md) when authoring or reviewing a
   plan. Prefer a small useful layer set: background and major panel surfaces,
   reusable card or button bases, distinct product or icon content, and controls
   that need independent editing. Merge tiny ornaments, shadows, and texture into
   their owning surface.
2. Apply the fixed text policy: remove ordinary raster text and pseudo-text while
   preserving deliberate pictograms and graphic symbols. Do not request fonts or
   reconstruct copy as image layers.
   Before asset-board generation, run `material-strategy` using observed target
   sizes and explicit source-reuse evidence. For new plans proposing one material
   board per component/style group, explicitly choose
   [component-family boards v1](docs/component-family-boards-v1.md). Keep bases,
   icons and state parts in separate cells and deliver independent PNG bindings.
   The legacy v1 strategy still separates controls from comparable icon boards;
   never reinterpret an old authorization. Strict extraction rejects missing,
   displaced or clipped parts. New keyed plans may explicitly select the bounded
   relative-cell extraction profile in that document before authorization; old
   fixed-cell plans are never reinterpreted.
   Nine-slice is only for reviewed empty stretchable bases; it must not distort
   pictograms or progress segment divisions.
3. When continuing from completed raw results, use `result-binding` and the
   `cached_result` plan field described in [references/provider-adapter.md](references/provider-adapter.md).
   Freeze a new plan and use `reuse-result`; never edit old attempts or import old
   pixels as a new generation. Cache reuse does not carry visual acceptance.
   Run `ai-ui-decomposition check`, then `freeze`. Freeze creates provider-neutral
   single-use request records; it does not call a provider. Before each external
   image call, use `adapter-export` to create one portable request bundle. Read
   [references/provider-adapter.md](references/provider-adapter.md) when wiring a
   local process, mounted container, MCP bridge, or service. Seal and import its
   one returned image. If the call may have been accepted but its outcome is
   unknown, run `indeterminate` and stop; never resubmit automatically.
4. Run `process`. Inspect `materials/contact-sheet.png` and the individual RGBA
   files. New automatic component requests use `keyed_component`: generate a
   uniform solid #F808F8 background, validate the declared key, then remove it
   globally, including enclosed holes. Never request a rendered checkerboard or
   infer a replacement key from the image. Explicit `transparent_component`
   plans preserve real Alpha and fail if the provider returns opaque artwork.
   Reused components are scaled uniformly and centered by default. Explicit
   nine-slice resizing is available for stretchable empty bases; choose fitted
   foreground insets in the plan rather than stretching pictograms or products.
5. Run `review-template`. Show the contact sheet to the user. Only after the user
   accepts that exact sheet, change `decision` to `accept` and fill
   `reviewed_asset_ids` with every planned asset. Do not approve the review on the
   user's behalf or change any digest field.
6. Run `finalize` into a fresh output directory, then `export`. Report the PSD
   file-roundtrip result separately from application validation. For a PNG-only
   handoff, select `--output-format png_zip`; memory estimates are advisory and
   never reject either delivery format.

Before `component-handoff`, require every generated interactive asset to use its
reference target dimensions. A different target size needs an explicit nine-slice
contract; do not stretch a full control image. Interactive appearance PNGs must
contain real transparent pixels. Missing reference-matched state art, font evidence,
or focus/caret evidence keeps the component handoff visually unaccepted even when
its schema and browser interaction checks pass.

Follow [visual delivery acceptance](docs/visual-delivery.md) for every reference
reconstruction handoff. Keep the ordered layer preview separate from the runtime
screenshot. Never create synthetic batch/material receipts to package a sample.
Run same-state `region-qa` on the consumed runtime before handing it to a recipient;
declare coverage and thresholds before evaluation. A rejected or missing comparison
does not establish visual acceptance. Do not silently relax thresholds or generate
again. Preserve missing font/state evidence as explicit limitations.

For a component handoff, after importing the draft in the component runtime and
capturing its evidence, run `delivery-check --config <check.json> --output <fresh-dir>`
as the final delivery stage described in docs/visual-delivery.md. It automatically
selects supported initial-state parts, reports missing font/state evidence, binds
the candidate and screenshot hashes, and invokes regional QA. A failed report
keeps the package draft and must be shown before handing it to a recipient.
Do not replace missing browser observations with assumed values. The checker
does not generate assets or grant human visual acceptance.

When authoring a 0.2 appearance binding for a Select, always provide
`states.select.popupContentLayout` in `target-popup-local` coordinates. Measure
the rectangle from the transparent popup asset so option labels, hit areas and
selection feedback stay inside its usable interior and avoid ornamental borders,
shadows and pointers. Do not infer this rectangle from the semantic component or
silently use the full popup canvas for a new handoff.

For copyable commands, read [docs/quickstart.md](docs/quickstart.md). For a
user-managed container, read
[docs/container-integration.md](docs/container-integration.md).

## Boundaries

For user-approved functional drafts, use [functional material audit](docs/functional-material-audit-v1.md)
to collect all material defects and separate cosmetic warnings from functional blockers.
Its offline repair proposal does not authorize generation or replace runtime acceptance.

- The model quality gate can withhold an unattended draft, but it is not human
  visual acceptance and does not establish perfect semantic importance or fidelity.
- Keep this Harness isolated. Do not alter another Harness, its environment, or
  its runtime configuration to make this route work.
- Only explicitly authorized `auto-run` invokes a configured optional provider.
  Other commands remain offline; none retries generation, downloads models or
  starts Photoshop. `job-status` is read-only and never resumes a job.
- `auto` selects PSD. Explicit PSB is rejected until a PSB writer and independent
  roundtrip test exist.
- Keep every attempt, review, and delivery immutable. Create a new run when a
  component or prompt must change.

## Stateful appearance delivery (required for new stateful acceptance)

Use the formal [Studio/composition entries](docs/studio-composition-acceptance-v1.md)
instead of copying sample-specific Studio scripts for supported ScrollViews.
Before full acceptance, check explicit background ownership and screenshot-bound
visible row spacing with `composition-check`. Report unchecked coverage; density
warnings do not trigger automatic repairs. After full stateful acceptance, run
`studio-acceptance` for real input and persistence, then the final delivery-check.
Unsupported Studio profiles require an explicit specialized result, never a silent
skip. Studio display-scale screenshots must not be treated as native pixel oracles.

For ScrollView thumb cap preservation, follow [source-pixel thumb slices](docs/scrollbar-thumb-slices-v1.md)
and the linked sole consumer contract. Measure each authenticated PNG; never copy
fixture cut lines or scale source-pixel caps during registration. Keep valid track
insets and real proportional scroll geometry. Missing stretchable art is a gap.

Text Input uses the [bounded native-input profile](docs/stateful-input-v1.md).
Keep observed content separate from QA strings; never infer caret, IME, non-text
input types or error-skin coverage from ordinary text-entry tests.

Switch ON/OFF art must use the existing consumer stateImages 1.0 extension; see
[Switch delivery](docs/switch-state-images-v1.md). Never infer colors or silently
fall back when an explicit state pair is incomplete. Legacy single-pair import
does not establish complete state appearance.

For drafts opting into standard system typography and layout, follow
[visual layout policy v1](docs/visual-layout-policy.md). Separate row paint from
row intervals, fit icon content inside its owner, preserve reference-visible chrome
with explicit scrollbarVisibility:always even without overflow (report unsupported
thumb geometry), and constrain progress fill to the inner cavity. Run the policy
checker against the applied bundle; technical checks never grant human approval.

New visual handoffs must follow [reference handoff v2](docs/reference-handoff-v2.md):
include byte-identical original artwork, explicit coordinate mapping, observed/unknown
reference state and acceptance scope. Preserve normalized derivatives separately.
Never substitute preview.png or normalized PNG bytes for the original. The legacy
export is explicitly runtime-only and is not ready for reference visual acceptance.

After producing a component handoff, follow [stateful delivery](docs/stateful-delivery.md)
and run `ai-ui-stateful` with explicit reference evidence and the current local
component CLI/build. A legacy packaging success is not stateful acceptance.
Use only public roles. Tabs require per-tab transparent icon/active-icon layers,
matching alpha/local geometry, and explicit distinct/shared evidence. Never
silently copy a state, bake its icon into the background, or replace missing
appearance capabilities with procedural drawing. Missing adapters fail explicitly.
New reference-driven visual repairs must attach digest-bound visualObservations
as described in [visual observations](docs/visual-observations-v1.md). Inventory
all readable removed text and its runtime owner; verify actual font-size/bounds,
text overlap, frame ownership and modal compositing before publishing acceptance.
Dialog body is optional; do not force a second framed panel. Use an explicit
native backdrop or raster overlay, never both. Legacy runtime-only checks do not
establish these visual-layout guarantees.
Only a fresh receipt directory whose browser verification succeeded contains the
accepted draft ZIP copy. Deliver its matrix and browser receipts alongside it.
Keep `human_visual_acceptance: false`; final visual acceptance remains human.

For static Panel delivery follow [Panel delivery](docs/panel-delivery-v1.md). Bind a complete frame once; never overlay duplicate header/body crops. Use the current consumer optional-header capability and report visual fidelity separately from static runtime checks.

For Select popup option icons follow [Select option icons](docs/select-option-icons-v1.md)
and its linked consumer contract. Use optionId-bound optionIcons with explicit safe-row
icon/label layouts. Preserve full PNG alpha padding and contain aspect ratio; never
bake menu icons into popup backgrounds or simulate them with field Image overlays.
Keep unknown reference state unknown; obtain fresh plan authorization before new media.

Standard freeze with Panel/ScrollView capabilities requires --component-document
and --layout-spacing. Standard component-handoff (including Python API) requires
spacing plan 1.1 for ScrollView or direct Panel buttons, validates the final tree,
and rejects missing decisions before export. Explicitly classify header buttons
through nonFooterButtons; standalone plan 1.0 cannot satisfy this gate. See
[required spacing entry gates](docs/scroll-bottom-space-v1.md).

Native generation must compile [material ownership](docs/material-ownership-v1.md)
into surface and icon prompts. Independently bound icons and child controls must
not be baked into their enclosing surface; generic symbol-preservation wording
must respect these exclusions. Inspect returned content; prompt rules alone do not
prove successful separation.

For List surfaces use the consumer's sole [background policy 1.0](../ui-component-harness/docs/list-background-v1.md).
Explicit `states.list.backgroundPolicy` parent mode binds only row/selected-row;
do not generate a placeholder background. Own or absent retains the three-part
contract. Register `list-background-v1` and preserve the policy in state evidence.
Shop facts require explicit background evidence; a failed generation never selects
parent mode automatically.
For returned boards with an explicitly reviewed alternative arrangement, use
[source-region revision](docs/source-region-revision-v1.md), retaining all original
parts and provenance. A later contract may select a verified subset; it may not
erase the original failure or fabricate generation acceptance.
