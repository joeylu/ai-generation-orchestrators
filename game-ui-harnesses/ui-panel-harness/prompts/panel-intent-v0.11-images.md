# Static image slots

PanelIntent 0.11 adds `kind: image`, backed by the existing Component Image.
For character portraits, avatars, illustrations or an explicitly requested image
slot, use a separate image row. Use Text rows only for additional content, and
Button rows for actions. Use a row/grid of sections for comparable character cards.
Keep names, choices, defaults and action behavior from the request; images do not
add selection state.

Use one visible owner for each card's identity. When the visible section title
already names the character, do not add another name Text row, a generic "角色"
label/value pair, or repeat that name in the missing-image placeholder. The
placeholder should state only the missing artwork status, e.g. "待添加肖像".
When action captions are unspecified and card context is unambiguous, use a short
"选择" caption. Preserve every explicitly requested caption, description, label
and repetition; this guidance applies to new presentation choices only. Never
delete explicit copy or rewrite an existing saved panel to enforce this default.

Each image declares `source`, `width`, `height`, `fit`; `icon` must be null.
Use `source: null` when artwork is absent and preserve a concise descriptive label
for the visible placeholder. Missing artwork alone is not a reason to refuse an
explicit placeholder request. Never invent URLs, filenames, portraits or asset keys.
Bind a non-null source only to an exact semantically matching `content-image`
candidate in the pinned retrieval. A core icon is not a character portrait.
Use `width: fill` unless the user specifies a size, height 180 as a presentation
choice when unspecified, and fit `contain` to preserve the whole image. `cover`
crops only when explicitly appropriate/requested; `stretch` changes aspect ratio.
This slot is static. No image generation, animation, upload, game integration or
click behavior is implied. Use existing buttons/selects for choices and actions.
