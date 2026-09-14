# Value-to-text binding 1.0 / 1.1 — unique producer/consumer contract

Authoritative field: optional `UiDocument.valueTextBindings` on validated document
schemaVersion 0.2. Version `1.0` supports numeric sources unchanged. Version `1.1`
adds List selected-item text and may also contain the same numeric bindings.
Older documents with no field are unchanged. Older consumers that do not support
the field reject it; they must not silently drop bindings.

```json
{"version":"1.0","bindings":[
  {"sourceId":"power-slider","targetId":"power-label","parts":[
    {"field":"value","fractionDigits":0,"grouping":"none"}
  ]},
  {"sourceId":"experience","targetId":"experience-label","parts":[
    {"field":"value","fractionDigits":0,"grouping":"comma"},
    " / ",
    {"field":"max","fractionDigits":0,"grouping":"comma"}
  ]}
]}
```

For numeric bindings, source IDs must reference Slider or ProgressBar; target IDs must reference Text.
Slider exposes value; ProgressBar exposes value and max. No name matching, scripts,
expressions, DOM selectors, arbitrary locales, format strings or business rules.
Each target can have only one binding; one source may have multiple targets. Source
and target type sets are disjoint, so cyclic/reverse edges are rejected by type
validation. A Text cannot become a numeric source. Unknown keys are rejected.

Limits: up to256 bindings, 1–16 parts per binding, at least one numeric part for a numeric binding. Literal
parts are at most128 characters without control characters. Each numeric part
requires fractionDigits (integer0–6) and grouping (none/comma); no implicit defaults.
Formatting uses JavaScript fixed-point rounding, decimal period and optional comma
thousands grouping; there is no evaluation. Extreme numbers >=1e21 retain JavaScript
toFixed's scientific notation. Authors must provide a Text layout large enough;
existing overflow policy still applies. The binding does not resize text or guess fonts.

Runtime calculates visible Text on initial load, source changes and redraw. Slider
shows its live drag value as well as its committed value. Formal numeric
TreePreview.setValue, uiHarness.setValue and uiStudio.setValue update the same chain.
ProgressBar.max is read from its validated component props; numeric setValue updates
its current value. Changing max requires a new validated document and follows existing
reference-staleness rules, not an invented second mutable-value API. The local fixture
covers max=5000 and max=6000 with the same binding.

Bindings update presentation only: original Text.props.text remains authored fallback
and is not overwritten. inspection.renderedTextBounds exposes actual visible text.
Text updates emit no change/input events and never write source props. Source events
retain their normal counts and input provenance. Original sampling semantics and
reference-state evidence stay distinct from saved runtime values.

Bundle serialization naturally includes document.valueTextBindings. The complete
handoff stores it in component.ui-bundle.json, whose digest and the appearance
binding documentSha256 must be recomputed. New runtime snapshots retain the identical
binding. Geometry/resources/reference images/mapping/state/scope are unchanged.

Official deterministic attachment command (new output only):

```sh
node scripts/cli.mjs bind-value-text input.zip bindings.json --output new.zip
```

bindings.json contains the valueTextBindings object shown above. The command verifies
the input, attaches exactly the explicit binding, updates affected fingerprints, then
reimports before writing. Existing outputs are rejected. Normal component-handoff,
Studio save/reopen, reference-export and reference-accept work with the result.

For CHARACTER Panel use sourceId alchemy-power -> targetId alchemy-value, value/no
fractions/no grouping; character-experience -> experience-label, value then literal
" / " then max with comma grouping. This is an explicit sample configuration, not
runtime special-casing. Keep Input editing fields unknown and human_visual_acceptance
false. Derived state tests do not create original-image observation evidence.

## List selection extension 1.1

This file remains the ONLY authoring contract. Use the same
`UiDocument.valueTextBindings`, stored in `component.ui-bundle.json.document`.
Do not put these fields in appearance-binding, item labels, Text props, or a
second selection-binding document. The existing `bind-value-text` CLI accepts 1.1.

```json
{
  "version": "1.1",
  "bindings": [{
    "sourceId": "skill-list",
    "targetId": "selected-name",
    "parts": ["Selected: ", {
      "field": "selectedId",
      "items": [
        {"itemId": "ember", "text": "Ember Strike"},
        {"itemId": "tidal", "text": "Tidal Guard"},
        {"itemId": "shadow", "text": "Shadow Step"},
        {"itemId": "verdant", "text": "Verdant Mend"},
        {"itemId": "chain", "text": "Chain Spark"},
        {"itemId": "iron", "text": "Iron Resolve"}
      ],
      "emptyText": "(none)"
    }]
  }]
}
```

Initial selection is still authored ONLY in `List.props.selectedId: "tidal"`.
The binding never selects an item. A non-null selectedId performs an exact,
case-sensitive itemId lookup. Map order is irrelevant. Labels may be uppercase
in List while the footer uses the explicitly supplied title case. There is no
automatic case conversion, implicit item.label fallback, or name inference.

`emptyText` is REQUIRED and is used only when selectedId is null. Literal parts
are concatenated as usual, so the example outputs `Selected: (none)` for null.
Empty strings are permitted, including an intentionally blank emptyText. Missing
or invalid selected IDs fail; they are never treated as null. This projects text
only, without equipment, filter, navigation, persistence or other business actions.

### Additional strict validation

- Both version strings are exact; unsupported versions fail. A 1.0 document
  cannot use List sources. Older consumers rejecting 1.1 must not downgrade it.
- In 1.1 a List source supports only the selectedId part, with EXACT keys
  `field`, `items`, `emptyText`. Each map entry has EXACT keys `itemId`, `text`.
- Every List item must appear exactly once, even if not currently selected.
  Unknown/duplicate IDs, missing entries, invalid ID/path references, wrong types
  or unsupported fields fail. Empty List requires an empty map and null selection.
- All text literals, mapped texts and emptyText are strings of at most 128 UTF-16
  code units, without U+0000–001F or U+007F. They are literal Pixi text, never
  evaluated as scripts, expressions, templates, HTML, selectors or resource paths.
- Existing limits (256 bindings, 1–16 parts, at least one source field) apply.
  List parts cannot be mixed with numeric fields in the same binding. Separate
  List and numeric bindings may coexist in a single 1.1 document.
- Targets remain exclusively Text, with one binding per target across ALL source
  types. Text cannot source a binding, so cycles/reverse edges are invalid by type.
- Changing a List's item set requires validating its complete mapping again.
  Saved reference attachments still enforce staleness for structural/binding edits.

### Runtime and persistence

Initial load, real mouse selection, Tab/arrow-key selection and the public
TreePreview/uiHarness/uiStudio `setValue(listId, itemIdOrNull)` call the same
presentation chain. Text.props.text remains the authored fallback. Read the live
text in `inspection.nodes[].renderedTextBounds`; do not inject setText scripts.
Binding updates emit no events, never reverse-write List, and preserve normal
source change counts. Mouse/keyboard selecting the same item emits no change;
the existing public setValue API emits one control/change per valid call, even
for the same value. Initial reference replay may emit that control event too.
The binding adds zero events to either path; tests count input deltas separately
from replay. This extension does not change the existing programmatic API semantics.

Studio save/reopen, full ZIP export, official component-handoff reimport and the
binding CLI preserve the 1.1 document and its explicit mapping. Original reference
bytes/mapping/state/scope stay separate and unchanged. Fixture states are test
facts only; they do not fill unknown scroll values or author original art evidence.

Regression: `tests/list-text-bindings.test.ts` and
`tests/browser/list-text-bindings.spec.ts`. The six-item package is a deterministic
program fixture, NOT a completed Skill Library decomposition or visual approval.
