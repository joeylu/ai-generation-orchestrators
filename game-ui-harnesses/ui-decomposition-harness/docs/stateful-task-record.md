# Stateful appearance hardening — 2026-09-12

Implemented a strict, reusable stateful acceptance command rather than editing
Quest Journal delivery records. Existing archives remain compatible inputs.
Only successful official import, deterministic matrix QA and real PixiJS state
checks publish the draft ZIP copy into a new receipt directory. The legacy
packager alone does not establish stateful acceptance.

Implemented profiles: Tabs, Button, CheckBox, RadioGroup, Select, Switch, List.
Unimplemented profiles and extra requested states fail explicitly. See
[stateful delivery](stateful-delivery.md) for roles, evidence, errors and the
bounded template/opaque-core checks; these are not final human visual approval.

Actual validation on this checkout:

* Decomposition full unittest discovery, including `STATEFUL_BROWSER_TESTS=1`:
  **126 passed** (23.792 seconds).
* Isolated snapshot of exactly the staged harness (excluding other unfinished
  workspace changes): **107 passed**, including real-browser state tests
  (21.771 seconds). Wheel build from that snapshot passed and includes the
  browser driver, new entry point and evidence schema.
* UI Component full unit suite: **337 passed**. TypeScript/static build passed.
* Persisted stateful regression: **7 successful component cases / 16 state
  screenshots**, plus one expected `STATE_DISTINCT_DUPLICATE` rejection after
  successful official import. Every source ZIP remained byte-identical.
* UI Component full browser suite: **75 passed, 6 failed**. This is not a green
  full-suite claim. Two existing decomposition tests expect the old 17 resources
  (now 21 with per-tab icons) and old 50px scroll result (now about 26px with
  semantic thumb sizing). Four workflow tests hardcode the unavailable local
  port 4173, ignoring the externally configured ephemeral preview port. This
  task does not modify the component runtime or those pre-existing tests.
* `git diff --check`: passed.

Fresh local evidence is under `work/stateful-acceptance-20260912-02` at repository
root. `regression.json` records actual case results; each successful case has its
own `acceptance` directory with ZIP, matrix, browser receipt and screenshots.
The synthetic fixtures are deliberate local regression controls, not a visual
acceptance claim about Quest Journal artwork. The reproducible fixture and
runner sources are checked in; generated local evidence is not a release input.

Historical Quest Journal ZIP digests were checked unchanged:

* r006: `41c577aa0c92292b09178f8e0c76c3cef4fc9c1068f6a6acd772f9add27ff445`
* r007: `37bba2823d5db10cd08622a1c574afbde51862300170872f927e122c8844dac0`

All new receipts keep `human_visual_acceptance: false`. No model/service calls,
retries, private provider state or old-record modifications were involved.


### 2026-09-12 Inventory reference-visible scrollbar

Visibility-only offline rebind uses the consumer's existing always field, preserves
reference evidence and content extents, and validates source/candidate via official
CLI. Visual policy can explicitly require always. Producer tests: 209 total, 201
passed, 8 optional skipped. Consumer: 390 unit and 2 browser regressions passed.
Final v2 ZIP SHA-256: f0f5b28f22297ae35bf48ad2e851af0ed78ea277b22a2521fd544ff0b44fbfab.
Evidence: work/ui-decomposition/inventory-shop-scrollbar-always-20260912-r001/.
Studio-r003 confirms zero range, real input, no scroll events and visible chrome.
Original short-thumb geometry and unoccluded end ornaments are NOT restored; see
docs/scrollbar-reference-visibility.md. Unknown reference positions and scope are
unchanged. Human visual acceptance remains false. No media generation.

### 2026-09-15 Layout delivery gate and bounded compilation

Added data-only handoff-job and existing-v2 delivery-run commands; see
docs/layout-delivery-run-v1.md. Strict runs require complete ownership/layout and
visual text observations. Opaque Select safe surfaces are checked against verified
PNG Alpha, and real opened menu text/icon bounds against registered rows. Empty
composition coverage is not_checked; missing legacy observations are not_run.
World/local QA rectangle mismatch is rejected when explicitly enabled. Unified
receipt validation rejects reference replay, targeted runs and zero-pixel reference
comparison as substitutes for full acceptance. No automatic repair/provider call.

Executed 79 focused Python tests: 71 passed, 8 opt-in browser tests skipped; 2 JS
geometry tests passed. Consumer build and 2 real Select browser tests passed.
Official-finalizer-to-consumer compiler regression preserves original reference
bytes and rejects changed material fingerprints/unsafe paths. Actual immutable
Bilingual Expedition r008 popup has 17,132 of 107,016 content pixels below Alpha250
and is rejected by the new opaque-surface check; no sample assets were changed.
Final procedural Select benchmark-r003: 6.573175s (stateful/layout 1.999614s,
Studio 2.838696s, reference 1.728038s). Original fixture state is unknown, so result
is blocked_reference, publication not_run, and human_visual_acceptance=false.
Evidence: work/ui-decomposition/layout-gates-verification-20260915-r001/.
This is not 16-type visual acceptance or a reference-to-generation SLA. Bilingual
Button per-line contract, translucent-readability adapter, representative art timing
and forced-termination descendant cleanup remain unestablished. No commit.

### 2026-09-15 Bilingual Expedition r009 layout repair and representative timing

Follow-up to the preceding audit: Button per-line labels are now implemented in
both producer and consumer, using the sole docs/button-label-lines-v1.md consumer
contract. Producer schema, semantic validation, exclusions/text regions and actual
browser geometry checks are integrated. Strict stateful acceptance now captures
the default view and checks observed text layout before running all state inputs;
default capture alone cannot qualify as full acceptance. appearance-revision can
append validated contract-derived scope descriptions without replacing reference
observations or scope modes. Studio runs now exercise explicitly configured
Select popup layouts and Button labelLines with real inputs before roundtrip.

The existing-art sample uses popupContentLayout {x:64,y:14,width:442,height:192},
measured against the unchanged verified popup PNG. Buttons use centered Chinese
32/bold and English 20/normal in separate target-local rectangles. Fixed header
and help-text overlap through explicit deterministic semantic layout adjustments;
six derived descriptions are appended to acceptance-scope. Original image bytes,
reference-state, coordinate mapping and nested artwork remain unchanged.

Evidence: work/ui-decomposition/bilingual-expedition-layout-r009-20260915-r001/.
Final draft: revision-r006/ui.component-handoff.draft.zip; SHA-256
8f308f9822b6eb612c0e760a68fb1a50ef82409c7aeb0b74475ab4491bb8d44d.
acceptance-r004: 26 stateful rows / 187 checks passed; default/final observed text
checks and Studio save/reopen/export/official CLI/Studio reimport passed.
studio-layout-probe-r001 separately passed actual Studio menu opening and four
Button mouse/keyboard activations. studio-fixture-r001 passed the updated normal
Studio path and roundtrip. Producer focused suite: 59 passed, 8 opt-in skipped
(67 total); consumer build, 511 offline tests and 1 dedicated browser test passed.

Actual existing-art acceptance elapsed 245.339754 seconds, including stateful,
Studio roundtrip and reference readiness check. It excludes development, planning
and generation and does not establish a universal 20-minute service SLA. Earlier
text-layout failure cost 96.70 seconds; the new default preflight rejected the
remaining overlap in 14.37 seconds before the full state sequence. Failed attempts
remain in separate directories. Ten original Input editing unknowns keep the
final status blocked_reference, publication not_run, human_visual_acceptance=false.
Remaining visual differences include font metrics/spacing and preserved artwork;
the reference does not show an opened menu, so that layout is derived. Translucent
popup readability and forced-termination descendant cleanup remain separate gaps.
No media/model/private-service calls or commit; unrelated work is preserved.

### 2026-09-15 Bilingual Expedition r010 visible spacing repair

Added optional visualRelations to the existing observations gate. Explicit
resource/Alpha/ROI references and actual Pixi inspection now check decoration/text
gaps, visible field-edge alignment and icon insets. No automatic ornament
recognition or inferred relations. The same observations digest covers both the
default preflight and final full-state checks. A paint-region index remains an
explicit renderer-order selection, so its source/region association must be
reviewed when authoring the plan. New imported_material plans may explicitly use
the existing contain/nine_slice resize contract; omitted resize preserves exact
import behavior. Source snapshots remain fingerprinted and generation calls zero.

Sample source r009 SHA8f308f98... was rebuilt through freeze/process/handoff build
and appearance-revision, not by editing delivery receipts. Four PNGs changed:
Select field/popup, arrow and CheckBox mark. Eight other PNGs, original reference
bytes, original reference-state and coordinate mapping are identical. Popup uses
the existing empty field surface with measured 12px nine-slice caps, replacing
the old narrow ornamental popup as an explicit derived design. It is not claimed
as an observed opened state. Eleven derived descriptions were appended; original
scope modes and descriptions remain intact. Text adjustments include subtitle24,
Button English18, help down18px and note down24px with lineHeight34.

Evidence: work/ui-decomposition/bilingual-expedition-layout-r010-20260915-r001/.
Final draft revision-r001/ui.component-handoff.draft.zip SHA-256:
e8dd5bac9ea9186e9741d0be0a4cedc58a6c73342f517e31a04e997b76ecdeaa.
The same eight relation targets reject the old package and pass the new one:
actual gaps12/17px, field left/right deltas1px, mark left/right insets10px,
top/bottom13px and arrow right inset24px. Initial r010 preview failed a12px
clearance target (actual6); a further6px text adjustment passed without weakening
the target. Related offline suite:75 tests,67 passed/8 opt-in skipped; final new
relations suite14 passed, including the observation-gate integration negative.
Initial import/build/revision focused suite22 passed. Full actual sample:26 result
rows/187 checks passed; Studio6 checks covering menu/Button real input and
save/reopen/export/official CLI/Studio reimport passed. Final local acceptance
elapsed245.451434s, excludes development/planning/material processing. Original10
unknown Input editing states keep blocked_reference and publish not_run;
human_visual_acceptance=false. Font spacing, panel art and texture remain visual
limitations. No consumer source change this round, no generation/service or commit.
