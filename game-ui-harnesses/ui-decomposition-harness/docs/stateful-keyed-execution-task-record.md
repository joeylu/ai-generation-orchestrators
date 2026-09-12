# Remaining samples: authorised keyed execution

The user authorised aggregate proposal
`e4ee1f47ed95f6665ea4426ee0e1a2f4a05af011119fe5150c40ec88b3202c6c`.
The three immutable generation plans run independently: Inventory 22 calls,
Battle HUD 38 calls, Reward Dialog 14 calls maximum, zero automatic retries.
Previously received results are reused through original result bindings.
No regression test invokes a generator or private service. Branch remains tony;
other tasks' working-tree changes are preserved and nothing is committed.

## Deterministic repairs during actual samples

- Native Alpha noise: contain formerly included distant Alpha 1..7 pixels in
  fitting bounds, then discarded them after resizing. Inventory's active tab
  shrank to a 223×59 visible area inside a 338×90 canvas. Applying the existing
  `<8` discard policy before the bounding-box step yields 338×88 visible support.
  Three local regressions cover noise independence, retained soft Alpha and
  entirely discarded noise. This is not new generation or semantic masking.
- Explicit foreground support: HUD fill canvases include known vertical margins.
  The new optional reference-evidenced insets contract distinguishes expected
  support from canvas dimensions, retaining the 15% tolerance and legacy default.
  See foreground-support.md. A three-asset official zero-compute reuse/process
  run establishes the correction without altering raw pixels.
- Reviewed empty stretchable surfaces use existing nine-slice processing when
  generated proportions are too short. Inventory filter-field preserves 20px
  corners; experience track and continuous, unsegmented full-range fill preserve
  10/5/10/5px corners. Independent diagnostics compare original corner pixels
  exactly. No icon, text or segmented meter is stretched. These explicit resize
  fields are frozen into a new zero-compute plan; rejected earlier fits remain.
- Native Tabs producer handoff validation now accepts the public per-tab items
  contract. Normal/active bases and icons receive separate layer nodes; shared
  icon pixels retain explicit source evidence rather than pretending distinct art.
- External vertical ScrollView tracks are validated against the target canvas;
  the thumb remains bounded by its explicit track. Runtime hit testing uses the
  union of viewport and track with an inert gap. Local negative tests preserve
  bounds safety; actual top/middle/bottom pointer dragging is exercised.
- Select field sibling Image overlays are checked with verified resource hashes,
  actual Alpha pixels and geometry. Rectangular image exemptions are not used.
- Fully covered viewport pixels are reported as occluded, with null pixel pass;
  the visible List and scrolling geometry still receive independent checks.
- Dialog modal probing chooses an actual visible background-button point outside
  the Dialog and inside the canvas, including partially overlapping buttons.
- Delivery default-state selection now covers Dialog, ProgressBar, Tabs, List,
  Select and vertical ScrollView, including numeric clipping and repeated states.

## Preserved evidence

Inventory base: `work/ui-decomposition/inventory-shop-fullchain-20260912-r001`.
Generation run is inventory-shop-keyed-r003. Completed raw results are officially
reused in inventory-shop-alpha-fit-r005 (zero calls), plan digest
`9eb1f3520e02de27d4230f0bf4007e317ca3503160a003a6b0b8502ed07f275d`.
It contains 31 materials and 42 delivery layers. Earlier postprocess-r004 and
delivery-r001 retain the Alpha-noise defect as historical evidence. Current
delivery-r002 is exported through the official CLI.

Reward base: `work/ui-decomposition/reward-dialog-fullchain-20260912-r002-keyed`.
All 14 new calls received; 15 processed materials. Final delivery-r002 handoff
and acceptance-r004 verify 19 real PixiJS states. delivery-check-r001 retains
REGION_VISUAL_QA_REJECTED; no reference-image visual pass is claimed.

The first merged suite passed 172 tests with STATEFUL_BROWSER_TESTS=1:
`work/ui-decomposition/parallel-keyed-full-tests-20260912-r001.log`.
This predates later native Tabs handoff and external-track/overlay repairs;
their final merged regression is recorded separately after completion.

Final merged validation after these repairs: **180 decomposition tests passed**
with STATEFUL_BROWSER_TESTS=1 (47.636 seconds), and **349 component unit tests
passed** (no skips). Logs are
`work/ui-decomposition/parallel-keyed-full-tests-20260912-r002.log` and
`work/ui-decomposition/parallel-keyed-component-tests-20260912-r001.log`.
`git diff --check` passed. These counts include local fixtures and are distinct
from each real sample's imported handoff/browser-state receipts.

HUD then exposed state-dependent Switch labels. Optional `stateLabels` and
`stateLabelLayouts` now update runtime ON/OFF text and position; old single-label
behavior remains compatible. State acceptance reads actual Pixi Text strings
and layout through inspection, alongside the existing color pixel checks; it
does not claim OCR or arbitrary glyph recognition. After this repair, the final
suite passed **182 decomposition tests** with browser fixtures (51.073 seconds)
and **350 component tests** including the explicit Switch label test. Logs:
`parallel-keyed-full-tests-20260912-r003.log` and
`parallel-keyed-component-tests-20260912-r002.log` under `work/ui-decomposition/`.

The user additionally authorised exactly one replacement for the known invalid
HUD squad fill, digest
`477c6369ce2feb45665022d9561bd3a91e67cd99f1b82e6dbeaff5513bdd5286`.
It uses an interior green reference crop excluding the trough and prior partial
state. This is a new explicit compute decision, not an automatic retry or a
transfer of the earlier authorisation. Its result is recorded by the owning
generation run, not inferred from the earlier technical state checks.

The authorised single replacement succeeded: a full-width green texture without
trough or baked old percentage. Its rectangular fill retains genuine partial
Alpha but no zero-alpha corners. The ProgressBar fill check now permits this
case while still rejecting fully opaque/empty fills and preserving strict icon,
track and background requirements. Three new local regressions pass. The final
complete decomposition suite is **185 passed** (50.670 seconds), log
`work/ui-decomposition/parallel-keyed-full-tests-20260912-r004.log`.
Component verification remains **350 passed**; no component change followed it.

Final actual handoff receipts are independently checked in
`work/ui-decomposition/remaining-three-final-20260912-r001/verified-results.json`:
Inventory 26 states, HUD 48 states, Reward 19 states, **93 total**. The audit
verifies every handoff, browser receipt and state screenshot hash. HUD final
delivery uses zero-compute runtime-geometry-r008, including the corrected green
fill and a 310px Slider fill derived by the official reuse_scaled route.
All three final delivery checks remain failed_visual_qa. These technical state
passes do not replace regional visual comparison or human review.

Every delivery remains human_visual_acceptance: false. Font substitution,
regenerated texture/ornament, inferred hidden backgrounds and unobserved UI
states remain explicit human-review items. Structure, interaction, screenshot
pixel checks and fixture test passes never imply human visual acceptance.
