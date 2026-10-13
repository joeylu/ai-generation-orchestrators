# Full component generation, native PanelIntent 0.12

This version adds four independently typed content rows to the eight existing rows.
The exact current native schema is authoritative. Use the original component type
when explicitly requested; never substitute a Switch for CheckBox, Select for
RadioGroup, static text for List, or an ordinary confirmation panel for Dialog.

- `checkbox`: a CheckBox, with boolean initial state and enabled flag.
- `radio`: visible RadioGroup options, each with label and exactly one initial:true;
  1–8 options. This is not a dropdown.
- `list`: a selectable, scrollable text-row List with 1–64 explicit options and
  exactly one selected option. `itemHeight` is 32–96; `visibleItems` is 1–12.
  When unspecified, 40 and 4 are presentation choices. Preserve user item labels
  exactly. No invented inventory, purchases, remote source, or automatic fetching.
- `dialog`: an independent Dialog plus an opening button and a closing button.
  label names the opening button; title/text/closeLabel are actual displayed copy;
  initial is its authored open state; modal determines background input blocking.
  dialogWidth/dialogHeight are fixed logical dimensions fitting the canvas. 400×240
  is a presentation choice only when content fits. Boolean state and lifecycle
  events are preserved in the bundle. This bounded message Dialog does not expose
  arbitrary nested forms; ask for clarification for required unsupported content.

For all four, use exact recipe keys, enabled, sourceRef:"request" and icon from the
schema. Copy explicit values, including false. Missing necessary business content,
defaults or behavior requires unresolved questions. Do not make the interface look
successful by dropping a required component. Container/Panel, vertical ScrollView
and non-nested 2–8 page Tabs remain deterministic layout constructs.
