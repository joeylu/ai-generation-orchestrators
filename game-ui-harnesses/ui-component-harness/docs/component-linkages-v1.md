# Component linkages 1.0

## Composite List contents extension 1.0

The sole additional field is `List.props.itemContents` (independent version 1.0;
componentLinkages stays 1.0). No item ownership is inferred. Complete example of
the extension for a List with exactly two items and four direct children:

```json
{
  "version": "1.0",
  "coordinateSpace": "item-local",
  "labelMode": "children",
  "items": [
    {"itemId": "potion", "childIds": ["potion-icon", "potion-name"]},
    {"itemId": "shield", "childIds": ["shield-icon", "shield-name"]}
  ]
}
```

Each item must occur exactly once; each direct child must belong to exactly one
item. Children must be native Image or Text with no nested content. Their existing
layout is measured from the row's top-left, inside width=List.layout.width and
height=itemHeight-rowGap. Require finite nonnegative positions, positive sizes,
and full containment. At runtime the row offset is visibleIndex*itemHeight;
source layouts and item arrays never change. Rows and their children are clipped
to the List viewport and row content box. Native Image fit/alpha and Text rendering
are preserved. labelMode=children suppresses the old List label for every row;
explicit Text supplies the visible name. At least one child per item is required.

Filtering hides the entire owned content, drawing, hit contribution and keyboard
visibility. Sorting keeps the same itemId and internal child layout. Selection
background and pointer hit rows use the same visible item order. Child images and
texts do not create separate interactive controls; clicking them selects the row.

Unknown versions/keys, duplicate IDs, missing/foreign children, missing item
coverage, non-Image/Text children and out-of-row geometry fail validation. A List
participating in componentLinkages with nonempty children MUST declare this field.
An unlinked static List without it retains legacy child layout and label drawing.
An empty-children linked List retains existing text-row behavior.

Persist this object in the semantic document before computing package hashes.
It is not an appearance.states field or reference observation. Save/export keeps
ownership and original local layouts, alongside existing linkageState; derived
row order/visibility is never serialized into the dataset. A consumer lacking this
extension must reject the field. Producer capability checks must separately verify
itemContents 1.0, not infer support from List/componentLinkages base capability.

Sole authoring field: `UiDocument.componentLinkages`, in the semantic Bundle
document. Optional; absence leaves all existing behavior unchanged. No scripts,
expressions, name matching or new component types. Version 1.0 is implemented and independently tested with local fixtures.

```json
{"version":"1.0","pipelines":[{
 "listId":"goods",
 "items":[{"itemId":"potion","searchText":"Potion","category":"health","unitPrice":25}],
 "search":{"inputId":"search","match":"contains","caseSensitive":false},
 "category":{"tabsId":"category","map":[{"optionId":"all","category":null}]},
 "sort":{"selectId":"sort","map":[{"optionId":"price","field":"unitPrice","direction":"asc"}]},
 "selectionOnFilter":"clear",
 "quantity":{"decrementId":"minus","incrementId":"plus","textId":"quantity","initial":1,"min":1,"max":99,"step":1,"onSelectionChange":"reset"},
 "total":{"textId":"total","operation":"multiply","fractionDigits":0,"grouping":"comma","prefix":"","suffix":" gold","emptyText":"—"},
 "purchase":{"buttonId":"purchase","emptySelection":"disabled"}
}]}
```

Every List item occurs exactly once in items. Price is a nonnegative safe integer
in caller-declared units; max price × max quantity must be a safe integer.
Quantity bounds, initial and positive step are safe integers, 0 <= min <= initial
<= max, and initial/max align with min by step. Arithmetic is only unitPrice ×
quantity, formatted with explicit fractionDigits 0–6 and grouping none/comma.
All text output is presentation only. Selected-name output uses the existing
valueTextBindings 1.1 selectedId mapping; null uses its required emptyText.

Search is literal contains or startsWith; no regex, trim or locale guessing.
Case-insensitive uses Unicode toLowerCase. Categories are exact strings; a null
mapping means all categories. Every Tabs/Select option must have exactly one
mapping. Sort field is unitPrice or searchText; asc/desc, string comparison uses
code-unit order. Ties preserve original items array order. Null Select means
original data order. Visible List IDs remain the original itemId values.

selectionOnFilter is clear or first: a selected item still visible is retained;
otherwise clear to null or select first visible, including initially null. Empty
results always select null. onSelectionChange is retain or reset (to initial),
including changes to/from null. At empty selection, +/- does nothing; total uses
emptyText; purchase emptySelection is disabled or enabled, intersected with the
Button's original enabled prop. PURCHASE/BACK still only emit action events.

Runtime quantity is stored separately at optional
`UiDocument.linkageState: {version:"1.0",quantities:[{listId:"goods",value:1}]}`.
If present it must cover every pipeline exactly once. Search/category/sort/List
selection retain the existing component runtime props. No derived filtered items,
total text or enabled overrides are written into source props. Bundle and runtime
handoff snapshots preserve these states; original reference observations do not
acquire quantities or derived observations. Missing state starts at initial.

At limits, +/- activation remains a Button activate, but no quantity change is
emitted. A changed quantity emits one change on quantity.textId (derived/control
source); selection invalidation emits one List change. Derived Text updates emit
no additional events. Initial hydration emits no synthetic user-input events.

Up to 32 pipelines / 1000 items per pipeline. Strict exact keys, versions, IDs,
types, exhaustive maps, nonempty bounded category/search text, numeric bounds and
unique participants are validated. No participant may be shared between pipelines
or used in two roles. Total/quantity targets cannot conflict with valueTextBindings
targets. Sources are controls, targets are projections; reverse edges and cycles
cannot be expressed. Invalid declarations fail; old consumers must reject unknown
fields. No implicit compatibility downgrade.


## Producer integration and acceptance

Keep the existing native delivery envelope and handoff 2.0/2.1. Supply
`document.componentLinkages` before computing documentSha256 and appearance binding
fingerprints; optional `document.linkageState` is an authored initial runtime
snapshot, not reference-state evidence. Reuse document.valueTextBindings 1.1 for
selected name. Do not place these fields in appearance.states, custom props or
reference-state. No new component profile is required: Button/Text/List/Input/
Tabs/Select use their existing profiles. The producer capability audit must
separately declare and validate presence of componentLinkages version 1.0; base
component coverage alone is insufficient. The consumer validator is
validateComponentLinkages(document), also invoked by validateDocument and CLI.
This change does not modify the producer's capability registry automatically.

Acceptance must inspect List.visibleItemIds, selectedId, renderedTextBounds,
quantity state and effective Button enabled state. Record actual source activate/
change events separately from derived control-source changes. Inspect search,
category and sort in combination, stable ties, empty-list keyboard input,
quantity limits, and quantity policy across selection changes. Saved quantity
is in linkageState; filtered item arrays and Text fallback strings are not edited.
Official exported runtime_bundle preserves that state while original ZIP members
remain byte-identical. Known state replay and interaction verification remain
separate; reference-state has no newly invented quantity observation fields.

Limitations: integer prices (caller chooses currency/minor units), only multiply,
only one quantity per pipeline, no stock/payment/navigation, no locale-aware
collation or fuzzy/regex search. Component disabled=false remains respected even
when emptySelection=enabled. Quantity and total must fit authored Text bounds.
Initial normalization emits no user events. Imported invalid configurations fail
instead of producing a fallback shop.

### Complete composite-row JSON example
The [complete validated UiDocument](examples/list-item-contents-v1.document.json) includes six items, five native children per row, ownership, local geometry, quantity/filter/sort configuration and existing valueTextBindings. Resource paths refer to independent SVG assets supplied in the accompanying deterministic fixture ZIP; none are remote URLs. The snippet above is the complete itemContents object for a smaller two-item List. Neither example represents observations of Expedition Supplies artwork.


Material registration for owned children uses the canonical declared List.items order: list global origin + item index * itemHeight + child local layout. Ownership is resolved only through childIds/itemId, never inferred from coordinates or names. Search and sorting affect runtime placement only; they do not rewrite source material registration. The six-item fixture also validates a Text appearance evidence layer in the third source row. This does not add an initial-order override or delayed sort.

