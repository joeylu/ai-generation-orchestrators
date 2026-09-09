# Semantic observation v0.2: frozen same-image retest

Executed after explicit user retest authorization on 2026-09-09. The original
twenty samples and the four added samples retain identical image bytes and
expected component types. No expectations, review notes or sample prompts were
sent to the model. Each image received one observation task and one contract
task: 48 accepted tasks, all completed, no resubmissions or output repairs.

Input digest:
`5b616fba3ebc1e09dc182d4d25e570f9ae74876c4395def1e6d8f9c551217209`.
It binds images, expectations, runner, instruction hashes and implementation,
including the preview policy. Raw results and immutable events remain local.

## Results

| Gate | Previous staged, original 20 | This retest, original 20 | Previous staged, added 4 | This retest, added 4 |
| --- | ---: | ---: | ---: | ---: |
| Valid observation envelopes | 13/20 | 20/20 | 2/4 | 4/4 |
| Observation contains all expected types | 8/20 | 18/20 | 1/4 | 4/4 |
| Strict contract compilation and binding | 3/20 | 14/20 | 0/4 | 4/4 |
| Compilation, binding and all expected types | 2/20 | 13/20 | 0/4 | 4/4 |

All 24 observations and 24 contract responses were valid JSON. All observations
were Observed. Two contracts were explicitly Unresolved, four failed strict
compilation, and one compiled with a missing expected type. Overall end-to-end
expected-type coverage is 17/24 (70.8%). No accepted contract failed the preview
policy or cross-stage binding checks.

The refined single-stage trial passed 12/20 on the original set and compiled
18/20. This retest passes 13/20 but compiles only 14/20 and uses two model tasks
per sample. The small net coverage gain does not justify changing the default.
Compared with that single-stage trial, ProgressBar, Panel, List and the combined
ProgressBar/Slider Panel gained passes; Switch, Slider and ScrollView lost passes.

The added four are reused regression samples in this retest, not a new unseen
holdout set. Each image has one trial result; repeatability and statistical
stability have not been established. Type coverage does not certify pixel
fidelity, hidden state, interactions or browser visual acceptance.

## Per-sample outcomes

| Sample | Outcome |
| --- | --- |
| 01 Button | Pass |
| 02 Switch | Rejected: VISION_SEMANTIC_COVERAGE_MISMATCH |
| 03 CheckBox | Compiled Container/Image/Text; CheckBox missing |
| 04 RadioGroup | Pass |
| 05 Input | Pass |
| 06 Select | Pass |
| 07 ProgressBar | Pass |
| 08 Slider | Rejected: VISION_PARENT_NOT_COMPOSITE |
| 09 Image | Pass |
| 10 Text | Pass |
| 11 Container | Pass |
| 12 Panel | Pass |
| 13 Dialog | Pass |
| 14 Tabs | Unresolved: hidden tab content is not observable |
| 15 List | Pass |
| 16 ScrollView | Rejected: missing Panel title and invalid scrollX/scrollY |
| 17 Switch/CheckBox settings | Pass |
| 18 ProgressBar/Slider Panel | Pass |
| 19 Form | Rejected: missing Input placeholder; observation also omitted Dialog |
| 20 Panel/Tabs/List | Unresolved: hidden Materials tab content is not observable |
| 21 Added CheckBox | Pass |
| 22 Added List | Pass |
| 23 Added Panel | Pass |
| 24 Added ProgressBar | Pass |

## Interpretation

Removing render fields from observation eliminated the previous observation
schema failures in this batch. Explicit preview values no longer blocked the
same cases on missing enabled/readOnly fields. Perception still misses the
original CheckBox and form Dialog, and the contract stage remains a bottleneck.

The next work should target explicit contract type declarations, legal render
parenting, absent text versus unknown text, and how a preview represents unseen
tab content. Those require defined semantics, not automatic repair or fabricated
content. Keep the refined single-stage default and preserve strict rejection.

The preceding implementation verification passed 278 unit tests, 64 browser
tests, build, self-test and doctor. This retest changed no implementation code
and made no new image-generation calls. Its live model evidence is separate
from the offline verification described in [revision notes](intent-semantic-v2.md).
