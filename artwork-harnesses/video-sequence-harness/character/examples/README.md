# Examples

`job.example.json` documents the public character-animation job shape. Copy it
into a private work directory and replace the reference path and motion request
before planning. The reference may have a normal background; preparation is
owned by the sibling image-background-removal Harness.

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

For CPU reference preparation examples, see the sibling
[image-background-removal Harness](../../../image-background-removal-harness/examples/).
