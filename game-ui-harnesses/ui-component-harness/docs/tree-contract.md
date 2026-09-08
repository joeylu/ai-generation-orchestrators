# UI tree contract v0.2

`src/tree-contract.ts` is the engine-neutral contract for the full local UI
Harness. It contains no DOM, PixiJS, file, network, clock, or random-ID work.
The existing v0.1 Button files remain separate and unchanged.

```ts
import { validateDocument, walkNodes } from './src/tree-contract.ts';
import { compileTree, validateTreeIntent, validateTreePolicy } from './src/tree-compiler.ts';
```

`validateDocument(value)` returns a cloned `UiDocument` only when every field
is understood. A document has `schemaVersion: '0.2'`, a document `id`, positive
finite `{width,height}` canvas, and one root node. Nodes have an identifier,
`type`, parent-relative `{x,y,width,height}` layout, and explicit `props`.
Node, choice, list-item, and tab IDs share one document-wide namespace. The
validator rejects a duplicate or a broken selected/tab-content reference.

The tree has at most 1,000 nodes and a depth of at most 32. Cycles are rejected.
Only these composite types may have a required `children` array: `Container`,
`Button`, `ScrollView`, `List`, `Panel`, `Dialog`, and `Tabs`. Children draw in
array order. A `Tabs` entry's `contentId` must name one direct child.

Every `ControlStyle` is explicit:

```ts
const style = {
  backgroundColor: '#FFFFFF', borderColor: '#1D3557', borderWidth: 1,
  cornerRadius: 6, textColor: '#10243E', fontFamily: 'sans-serif',
  fontSize: 16, fontWeight: 'normal', opacity: 1,
};
```

Colors are `#RGB` or `#RRGGBB`; border widths and corner radii are finite and
non-negative; font size is positive; opacity is from zero through one. There
are no theme or visual defaults.

## Type-specific properties

| Type | Required properties |
| --- | --- |
| `Image` | `source`, `fit: 'stretch'|'contain'|'cover'`, `style`; optional integer `region:{x,y,width,height}`. No region means the whole source. |
| `Text` | `text`, `wrap: 'none'|'word'`, `overflow: 'clip'|'ellipsis'|'error'`, positive pixel `lineHeight`, `style`; optional `fontSource`. |
| `Container` | `style`, `children`. |
| `Button` | `label` (may be empty when child content supplies it), `enabled`, `style`, `children`. |
| `Switch`, `CheckBox` | `label`, `checked`, `enabled`, `style`. |
| `RadioGroup`, `Select` | `selectedId` (an option ID or `null`), non-empty `options:[{id,label}]`, `enabled`, `style`. |
| `Input` | `value`, `placeholder`, `inputType: 'text'|'password'|'email'|'number'`, `readOnly`, positive integer `maxLength`, `enabled`, `style`. The value cannot exceed `maxLength`. |
| `ProgressBar` | non-negative `value`, positive `max`, `value <= max`, `style`. |
| `Slider` | finite `min`, `max`, positive `step`, in-range step-aligned `value`, `enabled`, `style`. |
| `ScrollView` | non-negative `scrollX`, `scrollY` no greater than `max(0, content − viewport)`, positive `contentWidth`, `contentHeight`, `style`, `children`. |
| `List` | `selectedId` (an item ID or `null`), `items:[{id,label}]`, `itemTemplate:'text-row'`, positive `itemHeight`, `enabled`, `style`, `children`. The built-in rows are a fixed text-row template; children are explicit additional structured content. |
| `Panel` | `title`, `style`, `children`. |
| `Dialog` | `open`, `title`, `modal`, `style`, `children`. |
| `Tabs` | `activeId`, non-empty `tabs:[{id,label,contentId}]`, `enabled`, `style`, `children`. |

All listed fields are required unless marked optional. Empty display strings are
allowed only where an intentionally visual child can supply the content; IDs,
labels, resource references, and provenance descriptions cannot be empty.

`source` and `fontSource` use the shared portable resource rule: a portable
relative POSIX reference (for example `assets/icon.png`) or a complete HTTP(S)
URL without credentials. Traversal, drive/absolute paths, backslashes, encoded
escapes, unsupported schemes, and credentialed URLs are rejected.

## Intent and pure compiler

`TreeIntent` has `{intentVersion:'0.2', id, root}`. Its nodes use
`componentType` in place of `type`, retain the same type-specific properties
and child rules, and **must not** include layout. `Unresolved` and `Custom` are
not types and cannot be compiled.

`TreePolicy` independently supplies every node layout plus provenance:

```json
{
  "canvas": { "width": 640, "height": 360 },
  "layout": {
    "root": { "x": 0, "y": 0, "width": 640, "height": 360 },
    "hero": { "x": 24, "y": 20, "width": 160, "height": 90 }
  },
  "layoutSource": {
    "kind": "explicit",
    "description": "Programmatic fixture layout, supplied by its author."
  }
}
```

`layoutSource.kind` is exactly `explicit` or `measured`; the compiler never
substitutes automatic or guessed positions. Policy layout keys must be exactly
the document's node IDs: a missing or unused layout fails compilation.

Only `Image` resources require `ImageFactsMap` entries. Facts are actual
decoded positive integer `{width,height}` keyed by the exact source reference.
The map has neither omitted nor extra sources. When an Image declares `region`,
the compiler verifies its bounds against the corresponding facts.

```ts
const intent = {
  intentVersion: '0.2', id: 'sample',
  root: {
    id: 'root', componentType: 'Container', props: { style }, children: [
      { id: 'hero', componentType: 'Image', props: { source: 'assets/hero.png', fit: 'contain', style } },
    ],
  },
};
const document = compileTree(intent, { 'assets/hero.png': { width: 512, height: 256 } }, policy);
```

The compiler is a pure deterministic function. It validates and clones its
inputs, does no decode itself, does not mutate inputs, and returns a document
that has passed `validateDocument`. `walkNodes(document)` returns the bounded
pre-order draw sequence for a validated document.
