# Plan contract

`ai_ui_decomposition_plan_v1` describes a coarse decomposition proposal. The
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

## Local resource policy

The public plan is rejected before processing when it would exceed the following
machine-independent raster limits: at most 256 nodes, 16,777,216 total material
pixels, and 33,554,432 total placed-layer pixels. These totals include repeated
node instances, so reuse does not provide an unbounded-memory escape hatch.

A `keyed_component` from `source_crop` may cover at most 4,194,304 source pixels.
Generated keyed results are checked against the same 4,194,304-pixel limit before
they are copied into a run. This protects the NumPy/SciPy matte operation, whose
working set is substantially larger than an RGBA image.

The runtime also estimates the highest local processing, assembly or PSD-export
peak. Its automatic budget is one quarter of currently available physical memory,
capped at 2 GiB; if availability cannot be read, it uses a conservative 512 MiB
fallback. The budget is not a user input and no provider call is made for a plan
that fails it. `doctor` reports the selected budget and fixed limits. Deployment
operators needing a larger job must split the UI into smaller independently
reviewed plans; they must not disable these checks.

Routes:

- `generated_completion`: one opaque, UI-free completion request.
- `generated_isolation`: one component on the fixed magenta key background.
- `source_crop`: deterministic crop for an already acceptable text-free region.
- `reuse_scaled`: reuse one accepted important component with uniform scaling by default;
  it creates no provider request and cannot chain through another reuse asset.

`source_crop` and `reuse_scaled` have `prompt: null`. Generated routes require a
prompt. `source_asset` is present only for `reuse_scaled`.

The plan cannot prove that text is absent or that the chosen layer granularity is
useful. Those properties are checked on the digest-bound contact sheet.

The optional top-level `delivery_policy` is `reviewed` (default) or
`unreviewed_draft`. `finalize --draft` requires the latter in the frozen plan.
It verifies material coverage, sizes, checksums, nonempty alpha and transparent
RGB before assembling a separately labeled `ai_ui_decomposition_draft_delivery_v1`.
Draft receipts have no review digest or human acceptance; the PSD filename ends
in `.draft.psd`. `finalize` without `--draft` still requires an accepted bound
human review, including when the plan allows draft export. A draft policy is not
permission to weaken file validation, infer visual acceptance or change old runs.
See [headless integration](../docs/headless.md) for model-authored proposals.

Generated assets may optionally include `cached_result` (0.1.2+), an exact object
containing `source_batch_digest`, `source_request_digest`, and `raw_sha256` from
the read-only `result-binding` command. Every value is a lowercase SHA-256 digest.
This makes the asset a zero-generation reuse request. See
[the reuse protocol](provider-adapter.md#reuse-a-completed-raw-result-012).
Omitting this field retains the original generation behavior.

## Optional empty-base nine-slice resizing (0.1.1+)

An important component with `keyed_component` or `rgba` output may explicitly add:

```json
"resize": {"mode": "nine_slice", "insets": [48, 48, 48, 48]}
```

Omitting `resize` preserves the existing contain behavior and pixels. It is never
enabled automatically or inherited by a `reuse_scaled` asset. The optional policy
is bound into the immutable plan digest before processing.

Processing first performs the existing matte/contain step at `output_size`, then
crops its alpha bounding box. Insets are positive integer pixels measured inward
from this **fitted foreground**, ordered left, top, right, bottom. They are not
raw-provider-image coordinates. Choose caps for the fitted output, not for a
provider's canvas resolution. Four corners are copied unchanged from that fitted
foreground; edges stretch along one axis and the center along both, using Lanczos.
RGBA is copied without applying alpha a second time. The resulting canvas has the
exact requested size; rounded corners can remain transparent.

Both foreground and target dimensions must exceed opposing inset sums. Invalid
target caps fail plan validation; insufficient actual foreground fails processing
with `RESIZE_SUPPORT_TOO_SMALL`, without fallback or provider retries.

Use only for empty, stretchable bases and plain frames. Do not apply to products,
characters, text, pictograms, or ornate centers: the program cannot recognize or
protect their semantics. Insets require explicit selection and visual review.
Corner preservation is relative to the fitted generated material, not a promise
of recovering the original reference's pixels. Old runtimes reject this new field;
plans without it remain compatible.
