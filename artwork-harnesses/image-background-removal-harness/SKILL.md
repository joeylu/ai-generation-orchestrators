---
name: image-background-removal
description: Prepare an ordinary character or prop still image as reviewed transparent artwork using deterministic local CPU tools.
---
# Image Background Removal

Use this Skill when a user wants an ordinary still image converted into a
transparent cutout or an animation-ready transparent foreground. This Skill does
not generate images, videos, or sequence frames.

## Agent workflow

1. Preserve the original inside a private workspace. Run `ai-frame-animation
   doctor --root <workspace> --reference <image> --preparation-config <config>`.
   Omit the config for meaningful existing alpha. `doctor` performs no inference.
2. If setup is ready, call `ai-frame-animation prepare --root <workspace>
   --reference <image> --out-dir <fresh-directory> --config <config>`. This is a
   local CPU operation; it never downloads models or calls a provider.
3. Inspect `cutout.png`, `foreground.png`, warnings, and the black, white, green,
   purple, checker, and alpha review images. Describe defects honestly. Program
   success is not human visual approval.
4. Return `cutout.png` when original coordinates must be preserved. Return
   `foreground.png` when the caller needs the fitted animation reference.
5. For one identified residual-background patch only, use `correct preview`, show
   its digest-bound evidence, and stop for explicit approval before `correct
   apply`. Correction cannot restore omitted subject material.

## Boundaries

- Do not require an LLM to segment pixels or edit the program report.
- Do not use GPU, network services, runtime model downloads, or automatic model
  fallback.
- Do not overwrite an existing preparation or original image.
- Do not describe an Agent visual check as user approval or alpha ground truth.
