# Refined type and structure instruction: same-image trial

Executed on 2026-09-08 using the identical twenty images and frozen expectations
from the previous trials. Twenty new submissions used one frozen instruction;
subsequent calls only read their existing analysis IDs. No failed business
request was resubmitted. Expectations were not sent to the service.

| Gate | Original baseline | First flat trial | This trial |
| --- | ---: | ---: | ---: |
| Valid source-bound response envelope | 7/20 | 19/20 | 19/20 |
| Strict contract compilation | 6/20 | 14/20 | 18/20 |
| Compilation and all expected types present | 2/20 | 11/20 | 12/20 |

All nineteen returned descriptions were valid JSON. Sample 20 ended in a provider
task failure without a raw description; it is not counted as malformed JSON or
a type result. Sample 14 failed Tabs content references. Six compiled results
missed expected component types. No result returned `Unresolved`.

## Changes and verification

The instruction adds visual distinctions for CheckBox/Switch, Panel/Container,
List/Button, ProgressBar/Slider and Dialog/Panel. It explicitly requires global
IDs, direct-child Tabs content, referenced styles and source-hash self-checks.
The complete example remains realistic and the instruction stays below the
service's 4096-character bound. Unknown hidden content must not be invented.

The decoder checks equality between the observed and emitted type sets in both
directions. Stable error codes distinguish unused styles, invalid parent/style
references and cycles. Recognition preserves allowlisted semantic error codes;
contract issues have a separate code and user-facing message. Errors still clear
the canvas and disable export without another request. No missing fields, styles,
tab contents or IDs are automatically repaired.

Build, 252 unit tests, self-test, doctor and 59 browser tests passed, including
the error-detail/no-resubmission browser regression. A test-only HTTP helper was
changed from fetch to Node HTTP after an ephemeral port hit fetch's restricted
port list. Production origin/security validation was not changed. Generated
evidence is in `intent-refined-verification.json`.

## Detailed outcomes

| Sample | Outcome |
| --- | --- |
| 01 Button | Pass; typed Button with explicit label |
| 02 Switch | Pass |
| 03 CheckBox | Miss: Container/Image/Text again |
| 04 RadioGroup | Pass |
| 05 Input | Pass |
| 06 Select | Pass; no duplicate List/option IDs this time |
| 07 ProgressBar | Regression: Container/Image/Text; ProgressBar missing |
| 08 Slider | Pass |
| 09 Image | Pass |
| 10 Text | Pass |
| 11 Container | Pass |
| 12 Panel | Miss: Container/Text again |
| 13 Dialog | Pass |
| 14 Tabs | Rejected: inactive content IDs do not reference direct children |
| 15 List | Miss: Button/Container/Image again |
| 16 ScrollView | Pass for type coverage; hidden scroll extent remains unverified |
| 17 Settings | Pass; Panel, Switch and CheckBox present, false/true checked states retained |
| 18 Progress/Slider panel | Compiled with both controls, but Panel missing |
| 19 Form | Compiled with Input/CheckBox/Button, but Dialog missing |
| 20 Inventory | Provider task failure; no inspectable result |

The input digest is
`43f8b260e00d05981dc33b2c2aa9f1ba0a80ca69a42a7075aa54d4e169d3c1cd`.
It binds source facts/expectations, the instruction hashes and implementation
fingerprints. Private raw results and append-only records remain local.

## Interpretation

Compilation improved from 70% to 90%, while expected-type coverage only moved
from 55% to 60%. The gain does not establish stable perception: the progress bar
regressed, and three single-type misses persisted. Model self-reported type
consistency cannot independently establish whether the image is a CheckBox,
Panel or List. Sample 19's pre-existing Panel/Dialog ambiguity is not relabeled
to improve the score. Additional nodes are allowed by this coverage metric.

This is a small, tuned synthetic set with one attempt per image per instruction.
It is not held-out accuracy, repeated-run reliability, visual fidelity or full
behavioral acceptance. Future improvement should separate visible observations
from required runtime policy and evaluate perception independently of contract
serialization, rather than relaxing the compiler or adding more post-hoc fixes.
