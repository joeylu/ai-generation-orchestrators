# Deterministic contract compilation: offline replay

Replayed the original, unmodified observation results from the frozen semantic
v0.2 trial, input digest
`5b616fba3ebc1e09dc182d4d25e570f9ae74876c4395def1e6d8f9c551217209`.
All image hashes were verified. This replay made zero provider calls, generated
no new images, applied no manual corrections and did not change previous scores.

| Gate | Original 20 | Added 4 | Total |
| --- | ---: | ---: | ---: |
| Observation includes expected types | 18 | 4 | 22 |
| Deterministically compiled | 14 | 4 | 18 |
| Compiled with all expected types | 13 | 4 | 17 |
| Explicitly missing semantic information | 6 | 0 | 6 |
| Compiler rejection | 0 | 0 | 0 |

The final complete-type count remains 17/24, matching the preceding live
two-stage trial. This is not an accuracy gain: it removes the second model task
and turns avoidable contract-authoring failures into deterministic behavior or
explicit missing information. Eighteen accepted documents were packaged as
validated portable bundles.

Switch and Slider now compile without the former type-declaration/parenting
errors. Input and the combined progress/slider panels now require missing facts
to be supplied rather than allowing a second model to introduce them.

## Missing information

| Sample | Required facts absent from the frozen observation |
| --- | --- |
| 05 Input | current value and input type |
| 14 Tabs | page content mapping |
| 16 ScrollView | containing Panel title |
| 18 ProgressBar/Slider panels | two Panel titles |
| 19 Form | Input placeholder and input type |
| 20 Panel/Tabs/List | page content mapping and Panel title |

Sample 03 still compiles as Image/Text/Container and misses CheckBox. The form
observation still omits Dialog. The deterministic compiler cannot correct a
wrong model classification by itself.

## Acceptance boundaries

This is a neutral procedural structural preview. It does not reconstruct the
reference artwork's style, remove duplicate visual labels, establish hidden tab
contents or certify pixel fidelity. Type accuracy, semantic completeness,
deterministic compilation and final visual acceptance are separate measures.

Browser regression covers editing a CheckBox into a Switch, preservation of
explicit false/empty values, missing-field blocking, export invalidation during
edits, one provider request across local corrections, and neutral bundle restore.
The replayed added List bundle was opened in the local Studio, with canvas and
export available; this is a functional loading check, not visual fidelity signoff.

Final verification is recorded in `intent-deterministic-verification.json`.
Build, 291 unit tests, 66 browser tests, self-test and doctor passed. The review
also fixed concurrent same-task polling persistence and local editor cleanup
after failed rendering. The local entry was switched to the observation-only
adapter and restarted; read-only health reported configured=true and the adapter
module loaded successfully. No live provider submission was used for this check.
