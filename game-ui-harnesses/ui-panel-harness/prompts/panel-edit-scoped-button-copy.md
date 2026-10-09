# Section-qualified button copy

Context 0.14 / explicit-properties-v4 adds exact section-qualified button names
and selected literal button names to the copy checks. The program has resolved
each check target to a stable row ID in the base Spec. Use that ID; do not search
globally for the same text, renumber rows, rename a section, or merge duplicates.

For a request such as “声音分组里的恢复默认按钮文字改为‘恢复声音’，其他不变”,
change only the resolved buttonLabel. Both sections may retain independent buttons
with the same original name. Preserve every original reset/submit field, event,
binding, asset, recipe, layout and unrequested value. Copy-only requests do not
authorize new behavior. Existing live player values remain unchanged at apply.

A program-owned selection can resolve an exact duplicated button name or “这个”.
An explicitly named different section does not override that selected row ID.
Unknown or duplicated section titles, multiple matching buttons inside one section,
unqualified duplicate names without selection, and unsupported prose remain
unverified. Interpret or ask for clarification; never choose the first match or
claim general semantic validation. All earlier exact-copy and atomic-scope rules
still apply. Context versions through 0.13 keep their original interpretation.
