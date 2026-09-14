# Stateful appearance acceptance

The strict stateful route accepts an immutable component handoff, explicit
reference evidence, and the current local UI Component checkout. It imports with
the official `component-handoff` CLI before deriving a state matrix from the
actual consumed bundle. No provider, model, or image generation is used.

List state QA follows the consumer paint stack: every item retains its normal
row, and the selected item adds the selected-row overlay. Transparent pixels in
that overlay reveal the normal row, not the List background. The state matrix
keeps both ordered parts under the existing `row/<itemId>` relation slot, and
default-state selection preserves the normal underlay. Opaque and transparent
selected templates use the same rule; pixel tolerances are unchanged.

```text
ai-ui-stateful --handoff input/ui.component-handoff.draft.zip \
  --evidence input/state-evidence.json \
  --component-root ../ui-component-harness --output new-state-acceptance
```

Prepare the component checkout with its documented dependency installation and
`npm run build`. Browser acceptance uses that checkout's Playwright and built
PixiJS distribution, served temporarily on loopback. On Windows the default
browser is installed Chrome; `UI_HARNESS_BROWSER` selects a Playwright channel.
It never connects to a production service. `--qa-only` is a diagnostic mode and
does **not** release a copy of the ZIP or establish browser acceptance.

Successful browser execution writes a byte-identical copy of the draft ZIP,
`consumed.json`, `state-matrix.json`, `browser.json`, numbered screenshots and
`acceptance.json` into a **new** directory. Failure leaves diagnostic receipts
but no accepted ZIP. No existing output directory is reused. Matrix and browser
receipts are sidecars bound by SHA-256; the old four-member archive contract is
unchanged. Distribute the receipt directory with the ZIP. A bare legacy export
does not establish stateful acceptance.
Reference images and rebased `state-evidence.json` are included in the receipt
directory so the sidecars remain inspectable after moving the directory. The
matrix records both the original evidence digest and the rebased evidence digest.

## Evidence contract: `ui_state_evidence_v1`

Required fields are `kind`, `handoffSha256`, `reference` (`path`, `sha256`) and
`components`, keyed by component ID. Reference paths are relative to the evidence
document and cannot escape its directory. Each component supplies exactly:

* `states`: every expected state name maps to `{basis, region, note}`. `basis`
  is `observed`, `user-confirmed`, or `contract-derived`; `region` is `[x,y,width,height]` in reference
  pixels. Notes must identify the observed or confirmed state semantics. Never
  claim an unseen state was observed, or infer state colors from luminance.
  `contract-derived` identifies runtime regression targets from the immutable
  supplied semantic/binding contract; it does not claim an alternate screenshot
  exists or that a human approved the appearance.
* `relations`: every part slot maps to `{mode, note}`. `mode` is `distinct` or
  `shared`. Notes explain the reference basis, including deliberate same-state
  reuse. The relevant state evidence is recorded alongside every matrix state.

Slots and supported public roles:

| Component | Enumerated states | Slots / roles |
|---|---|---|
| Tabs | every tab ID | `background/<id>`: tab, active-tab; `icon/<id>`: icon, active-icon |
| Button | default, hover, pressed | background |
| CheckBox | off, on | box, mark (mark visible only on) |
| RadioGroup | every option ID | option/id, indicator/id |
| Select | every selected option, menu reopened | background, indicator, popup |
| Switch | off, on | track, thumb (shared texture, distinct positions) |
| List | every item selected | background, row/id (row, selected-row) |
| ScrollView | top, middle, bottom | viewport, track (scrollbar-track), thumb (scrollbar-thumb) |
| Slider | min, middle, max | track, fill, thumb; pointer drag and fill clipping |
| ProgressBar | initial, empty, middle, full | track, fill; programmatic value and fill clipping |
| Dialog | open, closed, reopened | background, body, header, optional overlay; child visibility and modal blocking |

Tabs with explicit public `items` use each tab's native rectangle, hit area,
label rectangle and independently bound normal/active bases. Gaps remain gaps;
they do not become equal-width clickable cells. Legacy Tabs without `items`
retain equal-width geometry. All Tabs require a per-tab explicit `icon` and `active-icon` binding and both
local layouts. Both PNGs have identical dimensions, alpha bytes and
`target-item-local` geometry. Different states need different file **and decoded
pixel** hashes. Shared visuals need explicit evidence; merely duplicating files
cannot satisfy a distinct relation. Backgrounds must not contain the icons.
Text remains runtime-drawn; Tabs activeTextColor and Select fieldTextColor are
checked independently from menu/base textColor.

The matrix records component ID, type, state, visibility, role, layer, resource
path, file/pixel/alpha hashes, source canvas, absolute geometry, Tabs local
geometry and reference evidence. Relations describe visual resources, not
whether a shared mark is currently visible or a shared thumb has moved.

## Failure codes and limits

| Code | Meaning |
|---|---|
| STATE_MISSING | state, binding, or per-tab icon absent |
| STATE_RELATION_MISSING | incomplete explicit relationship declaration |
| STATE_REFERENCE_EVIDENCE_MISSING | absent/invalid evidence or reference digest |
| STATE_DISTINCT_DUPLICATE | distinct visuals reuse bytes or decoded pixels |
| STATE_SHARED_MISMATCH | shared declaration contradicts decoded pixels |
| STATE_GEOMETRY_MISMATCH | canvas or icon alpha contour/local geometry differs |
| STATE_ALPHA_INVALID | non-RGBA, empty, or fully opaque state part |
| STATE_BACKGROUND_BAKED_CONFLICT | known icon template also found in a Tab background |
| STATE_ROLE_UNSUPPORTED | role absent from the current public adapter |
| STATE_CAPABILITY_MISSING | unsupported component/state adapter; no fallback |
| STATE_NOT_VISIBLE | a required state cannot be reached in the visible fixture |
| STATE_RESOURCE_MISMATCH | resources or bound package changed |
| STATE_COMPONENT_IMPORT_FAILED | official CLI rejected the archive |
| STATE_BROWSER_FAILED | browser receipt contains the specific runtime/pixel failure |
| STATE_SCROLL_SEMANTICS_MISSING | missing/nonpositive/nonfinite content or viewport dimensions |
| STATE_SCROLL_GEOMETRY_INVALID | invalid track, thumb positions, or thumb outside track |

Version 1 requires native-size geometry and all enumerated items visible, with
the explicit runtime-sized ScrollView thumb exception below. Text Input has a
bounded [native-input profile](stateful-input-v1.md); unsupported input types and
caret/IME remain explicit gaps. Additional pressed,
disabled, error or focus *image roles* cannot be invented. If a reference requires
them, this profile cannot establish complete acceptance. It does not silently
substitute procedural controls. Button uses the public shared background with
the runtime's observable press transform, not a fictional pressed-image role.

Known-template background detection scans integer positions at the delivered
scale. It detects copies of the provided icon, not arbitrary repainted or
rescaled semantic equivalents. It checks the immediate silhouette halo and
requires 95% core per-channel matches, preventing a distant panel border from
manufacturing a match. Opaque-core browser comparison uses RGB tolerance
12 and a maximum 5% outlier fraction, masks text and genuinely covering layers,
and requires actual visible pixels. Parts covered by higher verified state
parts have `occluded: true, pass: null`; zero pixels never become a pixel pass.
Transformed textures are compared using rendered pixel-center expectations,
not nearest source pixels. Text tests check the expected color in each
label area, not OCR/font identity. Alpha-contour equality is deterministic;
arbitrary edge compositing fidelity still needs human review.

Switch optionally uses `props.stateLabels: {on, off}` and corresponding
`states.switch.stateLabelLayouts: {on, off}` for runtime-drawn labels on either
side of its thumb. Both layouts are required when state labels are supplied;
the old fixed label remains supported. Acceptance additionally compares actual
Pixi Text strings and their layout through runtime inspection. This confirms
state-dependent text updates without claiming OCR or exact font identity.

A rectangular ProgressBar fill may reach every edge of its canvas while
retaining genuine partial Alpha (`minimum < 255`, nonempty maximum). It need
not invent completely transparent corners. Fully opaque fills remain rejected;
icon, track, background and other isolated-part Alpha requirements are unchanged.
This rule verifies Alpha presence, not correct full-range fill semantics.

## ScrollView acceptance

The vertical adapter records viewport and track rectangles, `thumbPositions`,
content/viewport dimensions, source thumb canvas, runtime thumb rectangle and
scroll range for each state. It reproduces the current public runtime rule:
`min(trackHeight, max(sourceThumbHeight, trackHeight * min(1, viewportHeight / contentHeight)))`.
Thus short templates expand; explicitly larger authored thumbs retain current
runtime compatibility. This is an acceptance expectation, never a rewrite of
the source asset or invented content height. Expanded-thumb travel uses remaining
track height; otherwise the public authored positions apply.

Actual pointer drags verify top/middle/bottom scroll values, thumb pixels and
direct-child coordinate movement. Nested coordinates include viewport offset,
initial scroll and clipping. Horizontal overflow fails explicitly with
`STATE_CAPABILITY_MISSING:HORIZONTAL_SCROLL`. No-overflow content yields a full
track thumb and zero scroll. Quest Journal's 600px content / 596px viewport on a
524px track yields a 520.507px thumb, 3.493px travel and 0/2/4px scroll values;
the 90px PNG remains unchanged.

Regular state backgrounds must share canvas dimensions, but may have different
alpha artwork. Exact alpha-contour equality remains mandatory for Tabs icons.

Tabs icon alpha validation additionally rejects near-solid rectangular plates:
at least 2% of the alpha bounding box must remain transparent. A transparent
one-pixel outer border is insufficient. Intentionally solid rectangular icons
require a future explicit shape-evidence capability and are not silently waived.

Every receipt keeps `human_visual_acceptance: false`. Technical success,
successful screenshots and hash validation never promote a draft to final
human visual acceptance.

## Local regression

Slider probes use actual pointer drags at min/middle/max, consumer-compatible
step rounding, thumb positions and clipped fill pixels. ProgressBar adds the
supplied initial value plus empty/middle/full via the public value API; it is
not presented as a directly draggable control.

Dialog probes open/closed/reopened, child visibility, child Button activation,
and a visible underlying Button outside the dialog to verify modal blocking
and restoration. When a delivery has no such background Button, the adapter
creates a separate procedural bundle with an explicit hit probe, records its
SHA-256 and three real-click screenshots (closed/open/closed), then reloads the
original bundle. This fixture is never included in the delivery ZIP or treated
as reference evidence. Unsupported roots, no exterior click area, or missing
dialog action buttons still fail explicitly. Child visibility follows the
selected Tabs branch and nested Dialog open states. They distinguish activation
from business routing: no reward grant or application-specific close handler
is invented. Dialog compositing compares source-over pixels, including a raster
overlay when supplied or the current native overlay otherwise. A full-canvas
partially transparent overlay is valid without zero-alpha pixels; other state
parts retain the usual alpha requirement. Unobserved underlying artwork is
still a completion proposal, not source-matched evidence.

Select material comparison preserves fractional image registration. Popup
pixels inside declared content exclusions are reported as occluded, not as
successful base-image comparisons; option icons, text and declared menu
highlights have their own checks. Keyboard focus screenshots are retained,
then focus decoration is removed for material comparison. Popup teardown uses
real Escape input after restoring canvas focus and checks that popup bounds
and items are destroyed without changing the selected value.

```text
node tests/stateful-fixtures.mjs ../ui-component-harness NEW_FIXTURE_DIRECTORY
python -m unittest discover -s tests -p test_stateful.py -v
```

Set `STATEFUL_BROWSER_TESTS=1` after the component build to run real browser
acceptance for all eight types. Tests generate local deterministic PNG fixtures:
`Tabs-identical` reproduces r006 and must fail after official import; `Tabs`
reproduces r007's dark/light icons across ACTIVE, COMPLETED and ARCHIVE. They
neither read nor overwrite the historical Quest Journal packages. Other tests
exercise missing evidence/roles/states, explicit sharing, geometry, alpha and
baked template detection. Dependency setup is not performed by tests.

For persistent fresh evidence, run `python tests/run_stateful_regression.py
--component-root ../ui-component-harness --output NEW_DIRECTORY` with the package
installed (or `PYTHONPATH=src`). It records all eight browser cases and the
expected duplicate-state rejection in `regression.json`.

List profile `structured-image-text-child-acceptance` uses the existing tree
contract, with direct non-overlapping Image/Text children inside the List bounds.
Images require digest-verified native-size RGBA resources with real alpha;
Text uses ordinary system-font copy, word/no wrapping and clip/ellipsis/error.
Nested or interactive children, scaled images, child background plates, opacity
compositing and rich/custom-font text are outside this bounded profile and fail
explicitly. Every item must retain a visible hit region in the initial viewport;
automatic reveal of entirely hidden items is not implemented.

The adapter compares each child's actual geometry and runtime text/font, then
isolates child paint with public visibility controls and checks image source-over
pixels, text color and leakage outside declared List/ScrollView clipping. Fully
clipped children are recorded as clipped, not as visually inspected artwork.
An intersecting nonempty text region without measurable text pixels fails; it is
not silently excluded. Child regions remain excluded from the underlying row
template comparison only because these independent checks own their paint.

For a direct List inside a vertical ScrollView, real mouse and keyboard select
each item; wheel, thumb drag and keyboard visit top/middle/bottom where applicable.
Checks cover content displacement, values, events, repeated boundary input and
zero-range behavior. Material snapshots wait for scrolling/selection/recoil
presentation to settle. Hidden/restored and focused screenshots are separately
hashed. Public visibility setup is pixel isolation, never proof of user input.
No new consumer field is introduced. List-selected-label to external Text uses
the consumer's existing valueTextBindings 1.1 through
[value text integration](value-text-bindings-v1.md), with separate actual-text and
event checks for each real selection plus initial/null/restore/control probes.

Run `STATEFUL_BROWSER_TESTS=1` with `tests/test_list_children.py` for local
procedural fixtures, including deliberately wrong copy, color, clipping, resource
digests and unsupported geometry. These fixtures do not generate reference art
or establish sample/human visual acceptance.
