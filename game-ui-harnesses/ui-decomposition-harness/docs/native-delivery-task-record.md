# Native delivery compiler checkpoint — 2026-09-16

Prior decomposition changes were reviewed and committed as `90a8c4f` without
consumer or other Harness changes. The review also corrected the legacy vision
instruction to request the text geometry already required by its compiler.

The next bounded extension is the supplied native-document compiler, documented
in [native delivery input 1.0](native-delivery-input-v1.md). It reuses the public
consumer document validator and the existing receipt-bound generation, material
processing, official v2 handoff and state acceptance routes. It does not add a
second runtime or a business-rule language.

Executed local verification:

- Full decomposition suite: 480 tests, 462 passed and 18 skipped.
- Native and legacy adapter targeted run: 11 tests passed with real browser mode
  enabled for all five native fixture variants.
- Tabs, Input, Select, List and CheckBox each completed compile, local synthetic
  raw receipt, board extraction, official handoff import and actual browser state
  checks. The source reference bytes were preserved in the resulting v2 package.
- Invalid source hashes, layers, capability coverage, unsupported document event
  properties, state values, missing state sides, missing appearance coverage and
  missing required text geometry were rejected.
- Native input reached the DAG authorization boundary without a generation node.
- Board policy, dimensions and windows are present in the frozen request prompt.

These are deterministic synthetic fixtures, not Expedition Supplies artwork or
human visual acceptance. No provider/private service was called. This run does
not claim Studio roundtrip coverage for each new fixture or arbitrary optional
component profiles.

The new sample still needs consumer contracts for a Button-driven quantity value,
price arithmetic, and search/category/sort effects on the List. Current
`valueTextBindings` 1.1 supports the selected-item name but not these behaviors.
Do not proceed to media generation under the assumption they are implemented.
