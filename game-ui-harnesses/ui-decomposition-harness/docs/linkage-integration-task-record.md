# Producer linkage integration checkpoint — 2026-09-16

Consumer authority: component-linkages-v1.md; componentLinkages/linkageState 1.0,
List.props.itemContents 1.0, valueTextBindings 1.1. Consumer code was not edited.
Work remains uncommitted on tony, with unrelated task changes preserved.

Implemented: separate producer capability profiles and version/ownership checks,
native canonical item-order material registration, row-local semantic coordinate
preservation, state matrix child coordinates/clips and explicit Text coverage.
Native source Image rectangles must agree with canonical owned row geometry.
Existing static Lists retain their former layout behavior.

The linked input driver is integrated into stateful acceptance. Its receipt binds
bundle/handoff hashes, tested participants and nonempty passing checks. A missing,
partial, failed or changed receipt prevents technical success. List interaction
is delegated; other linked controls retain existing raster state verification.
Studio now changes quantity through real mouse input before persistence checks.

Executed verification:

- Full producer suite after compatibility fix: 486 tests, 468 passed, 18 skipped.
- Final native/extension targeted run: 12 passed, after receipt/coverage hardening.
- Native owned-image fixture: compile → freeze → synthetic local raw receipts →
  process → official v2 import → real browser passed; second-row source-coordinate
  errors rejected, both semantic child y coordinates remained 8.
- Six-item / 30-child linkage fixture: final browser driver passed 1,277 assertions
  covering categories/sorts, every item selection, quantity boundaries/events,
  empty-result mouse/keyboard, positions/visibility/text and opaque pixel samples
  for independent images and normal/selected row surfaces.
- Studio real quantity 1→2, save/reopen/ZIP export/official CLI/Studio reimport
  passed, reference members and mapping retained byte-identically.
- Regression driver is in tests/test_linkage_browser.py, enabled explicitly with
  LINKAGE_BROWSER=1; it generates only a procedural local fixture.

First broad run found a legacy text-binding wrapper without a node type; fixed
item_offsets to preserve that legacy wrapper path. First new Studio run missed
await on asynchronous exportSelected; fixed and reran into a fresh directory.
Earlier failure artifacts are retained.

These are local fixtures, not Expedition Supplies art or human visual acceptance.
No media/private service was called. A delegated Luna browser task produced no
file within its work window and was interrupted; root implemented and verified
the driver. This does not demonstrate Luna independently completing this route.

Limits: directly owned Image/Text only; at most 128 quantity steps and an explicit
all-category mapping for this bounded input driver. Current Studio probe requires
an initially visible List item. Opaque pixel sampling is not full texture or alpha
edge equivalence; existing material/alpha checks remain required. The combined
Expedition artwork has not yet passed the full delivery pipeline. The source Name
label/observed-order conflict still needs an explicit derived planning decision,
not a fabricated original sorting algorithm.
