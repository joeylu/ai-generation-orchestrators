# Tabs background ownership v1

Additive optional field in UiDocument 0.2: `Tabs.props.drawBackground?: boolean`.
This reuses the existing semantic drawBackground name. It is not an appearance
binding state field, versioned state image extension or new style opacity field.

- Missing or true keeps the legacy rectangular Tabs background and border.
- False skips only that rectangle. Transparent tab image corners and gaps reveal
  the parent. Tab bases, icons, text, active states, child content, hit regions,
  mouse/keyboard interactions and events remain unchanged.
- Only booleans are valid. Null, strings and numbers are rejected.
- The flag survives appearance application, Bundle save/reopen, handoff export
  and official import as part of the authenticated component document.

Choose false explicitly when a parent Panel owns the exposed background. Do not
infer this from PNG alpha alone, erase raster borders, recolor corners or set the
whole Tabs opacity to zero. Legacy documents do not silently change appearance.
Removing the plate is not human visual acceptance.
