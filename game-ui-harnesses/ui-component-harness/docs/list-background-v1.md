# List background policy 1.0

The sole producer field is appearance-binding 0.2 bindings[].states.list.backgroundPolicy:
`{ "version": "1.0", "mode": "parent" }` or `{ "version": "1.0", "mode": "own" }`.
Absent means legacy own-background behavior. Missing artwork never selects parent mode.

Parent requires exactly row and selected-row parts; background is forbidden. Own requires all three. All existing itemId, digest, resource, selected/unselected sample, rowGap and exact row geometry checks remain required. Unknown versions, modes and extra fields fail. Older consumers reject the new field rather than strip it.

Registration is authoritative: source origin = (global List origin - registration offset) / registration scale; sourceCanvas = List dimensions / registration scale. Row PNG dimensions and declared scene rectangles must exactly match the registered painted row (itemHeight minus rowGap). Source canvas dimensions must be positive integers, as for other raster appearances. No extra reference coordinate format exists.

Applied Bundle location: List.props.appearance.backgroundPolicy, identical object. Parent omits backgroundImage; own requires it. Runtime parent mode paints neither an independent background sprite nor procedural background/border, regardless of drawBackground. Parent means underlying scene pixels show through, not copying or binding the parent texture. Existing normal and selected row composition, clipping, selection animation, label and itemContents behavior remain unchanged; transparent row pixels and rowGap reveal the underlying scene.

Example binding component (within the existing authenticated binding envelope):

```json
{
  "componentId": "goods",
  "componentType": "List",
  "parts": [
    {"role":"row","layerId":"goods-normal","itemId":"rations"},
    {"role":"selected-row","layerId":"goods-selected","itemId":"tonic"}
  ],
  "states": {"list": {
    "backgroundPolicy":{"version":"1.0","mode":"parent"},
    "labelLayout":{"coordinateSpace":"target-item-local","x":12,"y":8,"width":376,"height":34},
    "hitArea":{"coordinateSpace":"target-item-local","x":0,"y":0,"width":400,"height":46}
  }}
}
```

Example assumes List width400, itemHeight50, rowGap4, selectedId tonic; each row PNG400x46 at the source row rectangle under scale1. The semantic component IDs and itemIds must actually exist. Complete authenticated fixture packages are produced by tests/helpers/list-background-fixture.ts; this fragment is not a fabricated delivery receipt.

Schema: list-background-v1.schema.json. Configuration persists in authenticated binding attachments and compiled Bundle appearances through Studio save/reopen, ZIP export and official CLI import. Original reference state/mapping is unchanged. No implicit business filtering or source image modification. human_visual_acceptance remains false.

Complete authenticated binding example: [list-background-v1.binding.json](examples/list-background-v1.binding.json), paired with the generated final-parent fixture ZIP recorded in work/ui-component-harness/list-background-20260917-r001/验收报告.md. Producer must recompute existing document/delivery/scene/archive digests for its own package.
