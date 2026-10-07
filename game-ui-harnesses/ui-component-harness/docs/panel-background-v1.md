# Container, Panel and Dialog background policy v1

Available in SDK `0.2.0-rc.3`. This additive policy keeps UI document version
`0.2` and existing bundle versions unchanged.

`Container`, `Panel` and `Dialog` accept optional boolean `props.drawBackground`:

| Value | Fallback rendering |
| --- | --- |
| Omitted or `true` | Existing procedural fill and border. |
| `false` | Skip only the fallback `drawBox` fill and border. |

Strings, numbers, `null`, arrays and objects are rejected. Explicit `false` is
preserved through document validation, compilation and bundle export/reopen.
The flag does not suppress native raster `appearance`. It also does not suppress
titles, children, opacity, layout, hit areas or accessibility. Dialog `open`,
`modal`, backdrop and declared Button close effects retain their existing rules.
Other component types keep their own background policies.

For a semantic container whose background is supplied by a separate Image child,
explicitly disable the procedural background on that container. The Image keeps
its own source pixels and alpha. This avoids a second fill showing through a
transparent raster corner. Do not hide the container or set its opacity to zero:
that would also hide its children.

```json
{
  "componentId": "dialog",
  "pointer": "/props/drawBackground",
  "basis": "explicit-policy",
  "note": "The supplied Image child owns this dialog's background."
}
```

When a layer plan explicitly includes `drawBackground` on any of these three
types, either `true` or `false` requires the finding above for that component.
Missing findings and findings marked `observed` or `inferred` are rejected.
Omitting the property adds no new evidence requirement to historical plans.

Consumers must adopt the matching new SDK artifacts and contract before emitting
this field. Frozen plans and existing deliveries are not retroactively changed.
A structural revision is a new source-bound plan/bundle; retain the original
source archive, semantic facts and previous delivery. A successful technical
render or contract check does not constitute human visual acceptance.
