---
name: ui-decomposition
description: Split a UI reference into a reviewed set of important reusable components and assemble a layered PSD with deterministic local tools.
---
# UI Decomposition

Use this Skill when a user wants one UI reference image turned into editable
important components and a layered PSD. This is an opt-in experimental route. It
does not apply to character animation, ordinary background removal, or a request
for pixel-perfect manual Photoshop reconstruction.

## Workflow

For an explicitly authorized unattended draft, use `auto-run` and the configured
optional provider as described in [docs/headless.md](docs/headless.md). It consumes
one vision call and a bounded number of image calls, then exports an unreviewed
draft. Do not substitute this for a requested reviewed delivery. Never invent an
accepted `review.json`; retain the original reviewed workflow below.

1. Run `doctor` and `self-test`, then use `init` to copy an oriented reference and
   create a digest-bound starter plan. Create an `ai_ui_decomposition_plan_v1`
   from that starter. Read
   [references/contract.md](references/contract.md) when authoring or reviewing a
   plan. Prefer a small useful layer set: background and major panel surfaces,
   reusable card or button bases, distinct product or icon content, and controls
   that need independent editing. Merge tiny ornaments, shadows, and texture into
   their owning surface.
2. Apply the fixed text policy: remove ordinary raster text and pseudo-text while
   preserving deliberate pictograms and graphic symbols. Do not request fonts or
   reconstruct copy as image layers.
3. When continuing from completed raw results, use `result-binding` and the
   `cached_result` plan field described in [references/provider-adapter.md](references/provider-adapter.md).
   Freeze a new plan and use `reuse-result`; never edit old attempts or import old
   pixels as a new generation. Cache reuse does not carry visual acceptance.
   Run `ai-ui-decomposition check`, then `freeze`. Freeze creates provider-neutral
   single-use request records; it does not call a provider. Before each external
   image call, use `adapter-export` to create one portable request bundle. Read
   [references/provider-adapter.md](references/provider-adapter.md) when wiring a
   local process, mounted container, MCP bridge, or service. Seal and import its
   one returned image. If the call may have been accepted but its outcome is
   unknown, run `indeterminate` and stop; never resubmit automatically.
4. Run `process`. Inspect `materials/contact-sheet.png` and the individual RGBA
   files. The keyed matte removes magenta globally, including enclosed holes.
   Reused components are scaled uniformly and centered by default. Explicit
   nine-slice resizing is available for stretchable empty bases; choose fitted
   foreground insets in the plan rather than stretching pictograms or products.
5. Run `review-template`. Show the contact sheet to the user. Only after the user
   accepts that exact sheet, change `decision` to `accept` and fill
   `reviewed_asset_ids` with every planned asset. Do not approve the review on the
   user's behalf or change any digest field.
6. Run `finalize` into a fresh output directory, then `export`. Report the PSD
   file-roundtrip result separately from application validation.

For copyable commands, read [docs/quickstart.md](docs/quickstart.md). For a
user-managed container, read
[docs/container-integration.md](docs/container-integration.md).

## Boundaries

- Semantic component importance and visual acceptance remain review decisions;
  program success does not establish either one.
- Keep this Harness isolated. Do not alter another Harness, its environment, or
  its runtime configuration to make this route work.
- Only explicitly authorized `auto-run` invokes a configured optional provider.
  Other commands remain offline; none retries generation, downloads models or
  starts Photoshop. `job-status` is read-only and never resumes a job.
- `auto` selects PSD. Explicit PSB is rejected until a PSB writer and independent
  roundtrip test exist.
- Keep every attempt, review, and delivery immutable. Create a new run when a
  component or prompt must change.
