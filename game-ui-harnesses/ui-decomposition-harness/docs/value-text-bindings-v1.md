# Value text integration

Use only [consumer Value-to-text binding 1.0 / 1.1](../../ui-component-harness/docs/value-text-bindings-v1.md)
and its document.valueTextBindings field. Official consumer validation owns the
engine-neutral contract. Do not introduce another formatting or linkage shape.

For every reference reconstruction, identify visible numeric labels belonging to
Slider or ProgressBar during semantic planning. Author explicit source/target IDs
and the consumer's bounded parts array; do not infer associations from ID names.
An independent Text fallback does not establish live numeric-label behavior.

After component-handoff, run the local-only producer integration:

```text
ai-ui-decomposition value-text-handoff --source input.zip --bindings bindings.json --component-root path/to/ui-component-harness --output fresh-directory
```

The bindings file is exactly the consumer's `valueTextBindings` object, with no
additional envelope. The command delegates attachment and validation to the
official CLI, independently reimports, checks the retained binding, verifies
unchanged non-contract package members and reference manifest, then publishes
`ui.component-handoff.draft.zip` and `export.json`. Failure logs remain in the fresh
directory; no accepted output is published after failure. No generation occurs.

For an authored document already carrying this extension, normal component-handoff
preserves its bytes; official consumer import remains required. Legacy documents
stay valid and are not automatically assigned relationships.

Real mouse drag and keyboard tests must compare Slider.value to the target's
`renderedTextBounds`, not fallback Text.props.text. Test ProgressBar current value
through the official program interface; max comes from a validated document.
Check source event counts, absence of target events, and saved/exported roundtrip.
Unknown original editing states and separate human visual review records remain
unchanged. Numeric binding acceptance is not full-reference visual acceptance.

Version 1.1 additionally projects List.selectedId to Text through the same parts
array: literal strings and `{field:"selectedId",items:[{itemId,text}],emptyText}`.
Declare every real item exactly once, explicit emptyText and exact source/target
IDs. Do not infer case conversion or fall back to item.label. Initial selection
remains List.props.selectedId. List mappings and existing numeric bindings may
coexist under 1.1; version 1.0 numeric and absent-field documents remain compatible.
The attachment CLI requires a draft v2 self-contained reference package, as for
numeric attachment; do not manufacture reference evidence to upgrade a legacy ZIP.

The producer's stateful route checks each List mouse/keyboard selection against
the external Text's actual renderedTextBounds, font/size/color and visible pixels.
It separately checks initial load, public API null, restoration and same-value
calls. Public API probes are labelled contract-derived tests and are not mouse
evidence. Text must not add input/change events; existing source API events remain.
The fallback Text.props.text is retained and is not used as proof of live text.
The bounded profile requires an ordinary non-overlapping, fully visible external
Text; binding targets nested inside the source List or clipped by ancestors fail
explicitly pending a broader adapter. This does not restrict the consumer contract.

Offline regression: `tests/test_list_text_bindings.py`, plus existing numeric
`tests/test_value_text_handoff.py`. Original bytes, mapping, state/scope and unknown
values are checked unchanged by attachment; all automated evidence remains false
for human_visual_acceptance. A passing fixture is not a generated sample delivery.
