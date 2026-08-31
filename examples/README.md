# Examples

`job.example.json` documents the public job shape. Copy it into a private work
directory and replace the reference path and motion request before planning.
The reference may have a normal background. `segmentation.config.example.json`
documents optional BiRefNet CPU preparation plus foreground-colour estimation,
not video generation configuration. It is not compatible with a U²-Net graph.
Keep its real model path private and follow [reference preparation](../docs/reference-preparation.md).

`minimax-h3.config.example.json` documents the optional local ComfyUI adapter.
Keep the real provider configuration outside source control. Export the ComfyUI
workflow in API format, then bind:

- `reference_image` to the image-loader node and its image input;
- `positive_prompt` to the prompt node and its text input.

The easier path is to let the CLI create the same private-by-default structure:

```powershell
ai-frame-animation init `
  --root my-animation `
  --motion "A side-view running loop with a stable camera"
```

`init` creates no image, video, or provider request. It refuses to overwrite a
non-empty directory. Before configuring the provider, verify deterministic media
tools with:

```powershell
ai-frame-animation tools check --root my-animation
```

If the check reports missing tools, follow [Installation](../docs/installation.md).

For CPU reference preparation, `segmentation.config.example.json` retains the
single BiRefNet profile. `segmentation-fusion.config.example.json` configures a
serial BiRefNet + IS-Net enclosed-hole profile once during local setup. Both
use the same `prepare --config` entry; neither downloads weights or needs a
per-image model choice. See [reference preparation](../docs/reference-preparation.md)
for source verification, limitations and the required visual review.
