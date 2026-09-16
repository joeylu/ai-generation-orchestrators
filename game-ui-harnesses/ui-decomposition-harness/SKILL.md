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

For title/subtitle roles in the four-type delivery compiler, provide
[source-relative text geometry](docs/text-geometry-preflight-v1.md) before compute.
Check real rendered center and width, not only authored font size and containment.
Missing geometry is missing coverage; never silently describe it as verified.

For single-row keyed component boards whose precise generated placement cannot
be guaranteed, explicitly plan [foreground-gap extraction](docs/foreground-gap-extraction-v1.md).
Use actual empty gaps for cuts and deterministic contain fitting; do not require
pixel-perfect generated partition lines. Preserve count, separation, edge and
semantic-review checks. Existing frozen attempts need separate revision evidence,
never an in-place strategy or receipt rewrite.

For local workflow development or offline MCP simulation, see
[the fixed DAG prototype](docs/local-workflow-v1.md). Its lifecycle controls and
four-type compiler are implemented. The repository adapter connects the official
v2 build entry and supports supplied-response preflight; real MCP execution still
requires new plan-bound authorization. The file bridges support
subagent/MCP transport via immutable `generationMode:"file"` and `reviewMode:"file"`; use their one-use
assignments and verified receive command, never hand-write DAG receipts or repeat
an assignment. New file bridge jobs require recording the exact tool arguments
with `workflow-record-submission` immediately before the single external call.
Invoke using those same recorded arguments, never reconstruct the prompt. The
record proves caller intent, not independent provider execution. Inspect status
for assigned/invocation_recorded/received progress. Board canvas geometry is checked
before batch receipt; failure stops the job without dispatching the next material.
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
