# Tabs layout policy 1.0

The authoritative optional extension is
`bindings[].states.tabs.layoutPolicy`:

```json
{"version":"1.0","orientation":"vertical"}
```

`orientation` accepts `horizontal` or `vertical`. The object accepts no other
fields. The official compiler preserves the same object at
`props.appearance.layoutPolicy`. No new part roles or component types are added.

The extension requires existing native `items`, one per semantic tabId. Keep
`headerHeight`, per-item `layout`, `labelLayout`, `hitArea`, and existing tabId
bindings for `tab`, `active-tab`, `icon` and `active-icon`.

- Vertical items use x=0 and increasing y in semantic tabs order. Items share
  headerHeight, remain inside the component and cannot overlap. Gaps are allowed.
- Horizontal items use y=0 and retain existing geometry and keyboard behavior.
- Source base canvases must match the corresponding item dimensions after
  registration. Icons retain their independent local geometry and authenticated
  resource references. Direction does not rotate or stretch source pixels.
- Content children retain their explicit existing layouts. Author the right-side
  content area in those layouts; this field does not infer a rail width, reserve
  content space, move children, or invent unseen tab content.
- Real pointer hit testing uses each item's explicit hitArea; gaps are not tabs.
- Vertical keyboard navigation uses ArrowUp/ArrowDown and Home/End. Left/Right do
  not change the value or emit a change event. Existing focus, enabled, modal and
  page visibility rules still apply.

Absent policy preserves the original horizontal contract and keyboard behavior.
Nonzero y without opt-in remains invalid. Unknown versions/fields/orientations,
missing items, invalid tabIds, wrong order, overlap, geometry, resources or
digests fail explicitly; there is no fallback to buttons or guessed direction.

This extension is supported by normal Bundle validation, official component-handoff
CLI import, Studio save/reopen/export, and v2 reference-preserving roundtrip. It
does not change original reference states or imply human visual acceptance.

Regression evidence: `work/ui-decomposition/tabs-layout-v1-20260914-r001/`.
Fixtures are procedural local rasters, not Settings artwork or visual approval.
