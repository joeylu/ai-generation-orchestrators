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

When delivering Select/Tabs appearance states, preserve confirmed optional
`fieldTextColor`/`activeTextColor` as described in references/contract.md.
Never infer state text colors from runtime luminance or bake text into art.
ScrollView source thumb texture height must not determine contentHeight or final
thumb length: supply observed viewport/content semantics and track geometry.
For decorated tracks use [scrollbar end insets](docs/scrollbar-insets-v1.md), measured
from the registered track edges. Preserve ornaments and verify both real overflow
and zero-range behavior through actual Studio input.
Explicitly authorized content-bottom whitespace follows
[bottom-space planning](docs/scroll-bottom-space-v1.md). It changes existing
contentHeight only, preserves original unknown scroll evidence, and must never
be applied as a default 20px overflow policy.

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
   displaced or clipped parts; it does not automatically recover cell drift.
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
   files. New automatic component requests require native transparent PNG output
   and preserve its Alpha without chroma-key removal. Legacy plans that explicitly
   use `keyed_component` still remove magenta globally, including enclosed holes.
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
