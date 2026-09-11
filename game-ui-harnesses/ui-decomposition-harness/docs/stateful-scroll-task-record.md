# ScrollView adapter and Quest Journal regression — 2026-09-12

Added vertical ScrollView state acceptance to `ai-ui-stateful`: semantic sizing,
three pointer-drag positions, actual child offsets, native source canvas vs
runtime-sized thumb geometry, and clipping. The current public consumer rule
is used explicitly; no texture resizing or hidden-content invention is written
back to the handoff. Unsupported horizontal overflow fails explicitly.

Real artwork exposed three acceptance defects, fixed with local coverage:

* Mean template contrast could mistake a panel border for a dark icon. Matching
  now checks the immediate halo and per-channel core agreement. True baked-icon
  fixtures remain rejected.
* Fully covered state parts were incorrectly treated as missing pixels. Receipts
  now distinguish occlusion (`pass: null`) from visible-pixel verification.
* Nearest-pixel sampling falsely rejected textured pressed buttons at 0.97 scale.
  Expected pixels are now rendered at transformed pixel centers; the local
  Button fixture includes texture to exercise interpolation.

Reference evidence is portable with the output directory. `contract-derived`
evidence explicitly identifies states inferred from the supplied public contract,
without claiming that unseen states were observed or human-approved. Icon alpha
equality is retained; background alpha artwork is allowed to differ on equal
canvases.

Validation:

* Full decomposition suite: **132 tests passed**, including the eight-type local
  browser suite, semantic/no-overflow/invalid-geometry and border regressions.
* Isolated staged snapshot excluding other unfinished workspace changes:
  **113 tests passed**, including real-browser state tests (23.799 seconds).
* Current UI Component TypeScript/static build passed, including commit `77290a2`.
* Quest Journal: official CLI reverse import and **22 real browser state captures
  passed**. Scroll values were 0, approximately 1.999973, and 4; child content
  coordinates and thumb pixels passed in all three states. Tabs dark/light icon
  states and Select light field/dark options passed.

Fresh evidence: `work/ui-decomposition/quest-journal-r001/stateful-r008/acceptance-07`
at repository root. Failed exploratory runs remain separate diagnostic directories.
The accepted ZIP reuses the immutable r007 materials and bytes, SHA-256
`37bba2823d5db10cd08622a1c574afbde51862300170872f927e122c8844dac0`.
This is a new acceptance run, not a fresh image-generation run or a claim of
improved artwork. r006 and r007 were not overwritten. Every acceptance receipt
keeps `human_visual_acceptance: false` for human review.
