# HUD Slider and ProgressBar candidate acceptance — 2026-09-12

Parallel sample owner inspected the original `03-battle-hud.png` from the confirmed
five-image set. Work stays on `tony`; no commit or reset was made. Existing shared
source edits remain untouched. No provider call occurred.

Added `stateful_slider.py` with native Slider geometry, positive-step validation,
consumer-compatible midpoint snapping, full-range fill clipping and thumb endpoint
expectations. It also provides ProgressBar initial/empty/middle/full expectations.
Added eight local unit regressions plus one opt-in integration test in
`tests/test_stateful_slider.py`. Eight passed; the browser test is intentionally
opt-in and requires the pending shared integration below.

The untracked work directory `work/ui-decomposition/battle-hud-fullchain-20260912-r001`
contains isolated candidate copies and exact unified integration patches:

- `stateful.py.patch`: dispatch Slider and ProgressBar, record actual fill clip.
- `stateful_browser.mjs.patch`: real Slider pointer drags, public ProgressBar value
  updates, per-part fill clipping and clipped-layer occlusion masks.
- `stateful-fixtures.mjs.patch`: public deterministic Slider/ProgressBar fixtures.

**The shared dispatcher has not been edited. Candidate success is not a claim
that these capabilities are already integrated in `ai-ui-stateful`.**

Executed candidate verification used the official component-handoff CLI and real
local PixiJS canvas with procedural PNG fixtures. All five r002 cases passed:

- Slider: min/middle/max pointer-drag states (3).
- ProgressBar baseline: initial/empty/middle/full (4).
- ProgressBar health, shield, energy: initial 78/42/65, then empty/middle/full
  for each (12).

The five `candidate-acceptance-*-r002` directories preserve byte-identical fixture
ZIPs, consumed bundles, state matrices, browser receipts and screenshots. Their
19 technical states are local regression evidence, not generated sample delivery
or human visual approval. `doctor`, `self-test` and `git diff --check` also passed.

The sample preparation itself remains unfinished. The source Tabs have unequal
rectangles (~368/276/275px width with gaps), whereas the public Tabs runtime and
importer use equal cells and one normal/active base pair. To avoid stretching the
reference, revised `project/plan-native-tabs-r002.json` preserves per-tab native
rectangles and proposes separate normal/active bases. It validates at 44 assets,
39 fresh generation calls and five original-image crops. It is not frozen or
authorized until the general per-tab geometry/material capability is resolved.
The earlier equal-cell plan remains preserved and must not be executed.

No sample ZIP exists. No generated material is recycled. Unobserved alternate
appearances remain contract-derived, shared icon evidence remains explicit, and
`human_visual_acceptance` remains false throughout.

## Native Tabs continuation

The receiver now implements optional `states.tabs.items` with native unequal
rectangles, per-tab normal/active bases and local label/hit areas. Legacy equal
cells are unchanged. Its corresponding `appearance.items` is authenticated,
resource-checked, drawn and pointer-tested using the same rectangles. Four new
receiver regression tests passed, including malformed inputs, missing resources
and 2x registration. Existing appearance tests also passed. `npm run build` passed.
The native/legacy Tabs Playwright assertions both printed `ok`; Windows server
teardown stalled and was interrupted, so that runner's exit was not successful.
The primary agent owns the integrated stateful browser receipts.

The Slider expectation module was checked directly against the current public
`snapSlider` function. This reproduced precision differences at step `1e-5` and
the binary half-tie min `.125` / step `.01`; both are now fixed, with two added
regressions. Ten pure tests pass. Integer-step HUD geometry is unchanged.

The fresh r003 plan has been checked, material-strategy evaluated, and officially
frozen under `workspace/runs/battle-hud-r003`. Current plan is
`project/plan-native-tabs-r003.json`; digest:
`c853bbe65bf9081ec4cb66732cfbec86fb608ba3e882dd401963433272f3aa1f`.
Maximum calls: 39, plus five original-image crops; zero automatic retries.
It awaits fresh compute authorization. No request has been dispatched.

`layout-facts-r003.json` preserves the stable automation decision that known
numeric percentage text defines Slider value. The reference 70% thumb is drawn
approximately at 76%; the plan repositions its unchanged 33x33 extraction 20px
left to the endpoint-derived 70% location. This visible reference inconsistency
is explicitly unaccepted visually. List row slots are consistently 102px.
