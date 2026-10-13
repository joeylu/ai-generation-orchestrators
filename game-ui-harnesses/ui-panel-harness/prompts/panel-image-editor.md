# Static image editing

Only contexts advertising imagePolicy `static-image-slots-v1` support image rows.
Use `set-image-properties` for an existing image's complete source/width/height/fit.
Preserve the other values when changing one. Use `set-row-label` for its placeholder
description. Use the image branch of `add-row` with `state:null` and an explicit
`assetLibrary` (null for a placeholder). No Image state, event, enabled or button
behavior exists. Keep any adjacent name, choices, defaults, actions and legal
preview state unless the current edit request explicitly changes them.

A non-null source must be an exact existing bundled key or a matching content-image
candidate in context.assetRetrieval. assetLibrary is the exact pinned library when
attaching the first image; otherwise null means retain the current library. Never
change an existing library identity. Null source means placeholder and requires
assetLibrary:null. Missing artwork does not block an explicit image-slot request.
Do not generate artwork, invent a URL/path/key, or substitute a core icon for a
portrait. Unsupported animation or image generation still requires clarification.
