# Two-stage intent evaluation

The implementation passed offline verification, but the live trial regressed.
The staged adapter remains experimental and was not selected as the default.

## Frozen scope and results

The original twenty images and expected labels were retained. Four independently
generated images added CheckBox, List, Panel and ProgressBar cases. Each image
received at most one observation submission and one contract submission. A valid
Observed response was required before the second task. In total, 24 observation
and 11 contract tasks were accepted; no failed task was resubmitted. All accepted
tasks reached terminal outcomes. Failed raw outputs were not repaired.

| Trial | Images | Valid observation envelopes | Observation expected-type passes | Compiled and bound | End-to-end expected-type passes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Staged original set | 20 | 13 | 8 | 3 | 2 |
| Staged independent set | 4 | 2 | 1 | 0 | 0 |

Valid observation envelopes include explicit Unresolved results. End-to-end
success requires compilation, cross-stage binding and every expected component
type; it does not certify pixel fidelity or behavior. The original-set passes
were Slider and Panel. The third compiled result omitted an expected Panel.

For comparison, original-set end-to-end passes were 2/20 at baseline, 11/20 with
the first flat protocol, and 12/20 with the refined single-stage protocol.
This trial's 2/20 is a regression, not evidence of increased stability.

## Failure analysis

- Observation still exposes rendering properties. Several otherwise correctly
  typed responses used boolean `wrap`, `overflow: visible`, `lineHeight: normal`,
  or string image regions, incompatible with the strict render schema.
- Observation hierarchy also inherits render restrictions: a Text label beneath
  ProgressBar was rejected because ProgressBar is not a composite render node.
- Contract instructions prohibit guessing runtime facts, while compilation
  requires fields such as `enabled`. Results either abstained or omitted required
  fields. Preview runtime policy must be explicit and separate from image facts.
- Two contracts reused the document ID for the root node, violating global ID
  uniqueness. One observation had a source-hash mismatch; one provider task failed.
- Semantic errors remain: the independent CheckBox became Container plus Text,
  and composite samples still omitted Panel. Correct raw types rejected by the
  schema are diagnostic evidence, not accepted successes.

The independent List observation passed but its contract duplicated an ID.
Independent Panel and ProgressBar observations had the correct main type but
invalid Text properties. None of the four reached an accepted contract.

## Verification and next boundary

Build, 268 unit tests, self-test, doctor and 63 browser tests passed using offline
fixtures/mocks. See `intent-staged-verification.json`. These verify protocol,
gating, binding and UI behavior, not real model reliability.

A subsequent revision should separate pure semantic observations from rendering
schema and define an explicit preview policy for nonvisual runtime settings.
Keep strict contract validation. The frozen trial must not be rescored by
silently normalizing failed outputs; further live submissions need a new trial.
