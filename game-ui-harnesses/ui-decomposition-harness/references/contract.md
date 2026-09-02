# Plan contract

`ai_ui_decomposition_plan_v1` describes a reviewed coarse decomposition. The
source path is POSIX-style and relative to the plan file. Frozen public records
retain only the copied reference and relative run paths.

```json
{
  "kind": "ai_ui_decomposition_plan_v1",
  "id": "inventory-ui-r001",
  "canvas": [1024, 1536],
  "source": {"path": "inputs/reference.png", "sha256": "...", "size": [1024, 1536]},
  "text_policy": "remove_ordinary_text_preserve_graphic_symbols",
  "granularity": "important_components_only",
  "assets": [
    {
      "id": "scene",
      "role": "background",
      "route": "generated_completion",
      "source_region": [0, 0, 1024, 1536],
      "output_size": [1024, 1536],
      "output_mode": "opaque_canvas",
      "prompt": "Reconstruct the scenic background without UI",
      "source_asset": null
    },
    {
      "id": "card_base",
      "role": "important_component",
      "route": "generated_isolation",
      "source_region": [100, 300, 380, 660],
      "output_size": [280, 360],
      "output_mode": "keyed_component",
      "prompt": "Isolate the empty card base without text or product",
      "source_asset": null
    },
    {
      "id": "card_base_small",
      "role": "important_component",
      "route": "reuse_scaled",
      "source_region": [420, 300, 630, 570],
      "output_size": [210, 270],
      "output_mode": "rgba",
      "prompt": null,
      "source_asset": "card_base"
    }
  ],
  "nodes": [
    {"id": "background", "asset": "scene", "xy": [0, 0]},
    {"id": "card_01", "asset": "card_base", "xy": [100, 300]},
    {"id": "card_02", "asset": "card_base_small", "xy": [420, 300]}
  ],
  "groups": [
    {"id": "background_group", "children": ["background"]},
    {"id": "cards_group", "children": ["card_01", "card_02"]}
  ],
  "document": {"name": "inventory-ui", "format": "auto"}
}
```

Groups and children are ordered back to front. Every asset must be used, every
node must appear in exactly one group, and exactly one background node must cover
the canvas at `[0, 0]`.

Routes:

- `generated_completion`: one opaque, UI-free completion request.
- `generated_isolation`: one component on the fixed magenta key background.
- `source_crop`: deterministic crop for an already acceptable text-free region.
- `reuse_scaled`: reuse one accepted important component with uniform scaling;
  it creates no provider request and cannot chain through another reuse asset.

`source_crop` and `reuse_scaled` have `prompt: null`. Generated routes require a
prompt. `source_asset` is present only for `reuse_scaled`.

The plan cannot prove that text is absent or that the chosen layer granularity is
useful. Those properties are checked on the digest-bound contact sheet.
