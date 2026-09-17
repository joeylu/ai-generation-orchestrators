# Compact shop planning integration

The observed failure was a large model-authored native document copied from an
earlier sample: duplicate IDs, row child bounds outside the available row height,
and unrelated material descriptions survived until native preflight. This work
adds an explicit bounded shop facts profile, expanded by deterministic code, so
the model supplies observations once and does not construct repeated native
document structures.

Related contracts: [shop facts](shop-facts-v1.md),
[planned glyphs](planned-glyphs-v1.md),
[native delivery](native-delivery-input-v1.md), and
[local workflow](local-workflow-v1.md).

The opt-in DAG profile retains fresh plan-digest authorization. Compilation and
synthetic tests are not actual-artwork generation or visual acceptance. Unknown
reference fields remain unknown. No provider, private service, or media call is
needed for offline preflight. All final evidence is recorded in the separate
sample work directory; historical failures are preserved.

The profile is limited to the documented single-panel shop layout. It does not
establish arbitrary screenshot recognition, all 16 component combinations, or a
20-minute successful-delivery guarantee. Runtime jobs use the tested compiler;
they must not ask an LLM to implement a new compiler for each screenshot.

The reviewed Skyport facts were rerun through the official offline workflow in
`work/ui-decomposition/skyport-supplies-facts-20260916-r001/offline-preflight-r004`:
43 components, 38 material declarations, nine planned generation requests,
approximately 4.90 seconds through freeze, zero provider/media calls. Five
unknown editing fields remain unknown. This is an awaiting-authorization plan,
not an artwork delivery. The sample report records hashes and retained failures.

The complete synthetic handoff regression caught missing quantity-button text
observations; these are now emitted by the compiler for every supported shop.
Synthetic board fixtures also exercise actual foreground separation, frame
occupancy and Select popup alpha containment before official consumer import.

Final offline suite: 544 tests, 525 passed and 19 skipped, zero failures
(132.982 seconds). The shop-facts/profile targeted suite passed all 18 tests.
Logs and the Chinese result report are under the same sample work directory;
`offline-suite-r003.log` is the final complete run. No artwork generation or
Studio/browser acceptance was performed in this compiler integration turn.

The subsequent Skyport Input generation exposed a prompt ownership gap: a search
icon was baked into the field despite having an independent Image binding. The
failed output and received receipt are retained; remaining requests were stopped.
Native compilation now emits material ownership instructions and binds their
digest into prompts, with the batch symbol rule subordinate to surface exclusions.
The change also covers Panel, Tabs, Select, List, CheckBox and Button surfaces.
See material-ownership-v1.md. The fresh source preflight and final offline log are
under ownership-preflight-r002 in the Skyport live work directory. No replacement
media is generated as part of this fix; no new completed handoff is claimed.

2026-09-17 continuation: the six separately authorized remaining requests were
received once each. Subsequent consolidated deliveries reuse their verified raw
sources; no retry or additional media call was made. List parent-background 1.0
is validated and compiled without a second List frame. Source-region revisions,
connected silhouette extraction and measured frame fitting retain source hashes
and old failures. The shop compiler also separates tab page visibility from
shared controls, avoids procedural shared-container backgrounds, reserves glyph
height, projects explicitly derived row pitch, and allows bounded long-name
wrapping in free footer space.

The r007 full offline run completed 576 tests: 557 passed, 19 skipped, no failures
(183.584 seconds). The 13 targeted shop tests passed. Its actual-artwork linkage
browser completed 1,493 checks, including real item selection, search/category/
sort combinations, quantity bounds, total text and empty selection. Final
stateful/Studio/reference results belong to the immutable delivery-r007 receipts
under the Skyport remaining-six-ownership-r001 work directory; these technical
results do not establish human visual acceptance.

The r007 state browser then reproduced zero background sample pixels on quantity
buttons because the entire button was reserved for text. The compiler now centers
the glyph reservation inside the frame; no pixel-check tolerance was relaxed.
The 13 targeted tests passed after this final change. Delivery r008 completed
1,493 linkage checks, 37 independent state/interaction records, and 11 Studio
checks including save/reopen and ZIP/CLI/Studio roundtrip. Isolated CLI import
passed with package SHA-256
1993303b2f2dcc8553f5e8afced798f282b3452128a861a90455ca23a3071cda.
Reference comparison remains blocked by the five original unknown Input editing
fields. The complete draft and Chinese report are in isolated-r008 and
验收报告-r008.md under remaining-six-ownership-r001. No human visual pass or
accepted final publish is claimed; visible artwork differences are recorded.

Visual comparison continuation: added explicit per-material source observations
and occupancy assertions, exact reviewed static-interior/reference-divider copying,
and bounded uniform visible-content fitting. Shared/derived targets are rebuilt
from canonical sources instead of retaining old target files. Offline regression:
582 tests, 563 passed, 19 skipped (202.501 seconds); 26 targeted tests passed.
Skyport visual-repair-20260917-r001 retains all intermediate failures and reports.
The latest r004 preview restores static tile interiors, enlarges coin/search
support and restores two inset divider lines. Its CLI/QA/default-layout checks
passed; it is not final full acceptance. Earlier r003 state/Studio checks passed
but reference comparison hit the execution budget; no old receipt was reused for
r004. Three frozen replacement requests (Tabs/List/CheckBox) await fresh user
authorization. See the sample 修补报告.md for exact source rectangles and hashes.

Following the user's fresh authorization of that frozen batch, Luna xhigh
completed all three requests exactly once (received 3, automatic retries 0).
The r005 source join reuses every other verified board and reapplies the seven
deterministic refits, preserving original reference/state bytes and mapping.
Tabs and CheckBox polarity improve; the new List has thinner borders but still
omits the observed pale-blue selected fill and retains an oversized right mark.
These are model-reviewed visual defects, not hidden by technical pass receipts.
The frozen observation mentioned the selected outline but omitted the fill;
the Skill and facts contract now require separate fill/outline/mark/registration
review before generation and assembled-state review before full acceptance.
This adds no claim of automatic semantic color recognition. See the r005
visual review, comparison, raw receipt index and new acceptance report under
visual-repair-20260917-r001. No additional media was submitted to fix the omission.

The r005 final technical run completed in 509.372 seconds: 1,493 linkage checks,
37 independent state/interaction records and 11 Studio roundtrip checks passed.
The official reference comparison remains blocked by the same five unknown
Input editing fields; no accepted final publish was produced. Isolated official
CLI import passed for draft SHA-256
33d620a3d5a1dac375c1dadb21ea659bc051d2ecbd2956f73782de5c7dcecd84.
The Chinese 验收报告-r005.md links all raw, reference, runtime and Studio evidence
and explicitly retains the selected-fill and registration defects. No human
visual pass is claimed.
