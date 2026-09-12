# Visible-only reference planning

When a single reference does not reveal hidden list items or menu choices, use
the explicit `visible_content_only` draft policy. This policy is a recorded
planning decision, never a claim about unseen source content.

```text
python -m ai_ui_decomposition.reference_semantics --facts facts.json --output NEW-policy.json
```

Input kind `ui_visible_content_facts_v1` contains `scrollViews` and `selects`.
Scroll entries have `id`, `viewport: [width,height]`, and `knownItemBounds` as
viewport-local `[x,y,width,height]` rectangles. Select entries have `id`,
`selectedId`, and nonempty `observedOptions: [{id,label}]`; the current visible
value counts as an observed option. Observations still require reference review;
this command is not image recognition.

Content extent is the maximum of viewport size and the known children's right
and bottom edges. A short thumb is not evidence of extra rows. No known overflow
means a full-track thumb and zero scroll range. Horizontal overflow is rejected
until its acceptance adapter exists. The output does not change source artwork
or prescribe an authored thumb texture height. Apply it to the existing public
ScrollView sizing rule and preserve the reference-proportion difference as a
limitation. A known partially visible item's full authored rectangle may produce
overflow; guessed extra items may not.

Select options remain exactly the observed set, including a singleton menu.
Missing selected values fail instead of picking an arbitrary first option.
Unobserved popup geometry and appearance must be explicitly proposed and marked
`contract-derived`, not `observed`. This does not grant source fidelity or human
visual acceptance. The output is a proposal, not a delivery receipt or generation
authorization. The command refuses an existing output file.

Regression covers the six-visible-row inventory case, known partial overflow,
missing options/selection, nonfinite dimensions and unsupported horizontal
overflow. It uses local data and makes no provider calls.
