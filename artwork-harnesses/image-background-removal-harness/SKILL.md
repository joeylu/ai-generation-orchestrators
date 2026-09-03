---
name: image-background-removal
description: Prepare an ordinary character or prop still image as reviewed transparent artwork using fal BiRefNet V2 masks and deterministic local post-processing.
---
# Image Background Removal

Use this Skill when a user wants a still image converted into a transparent
cutout or animation-ready foreground. This Skill does not generate new artwork,
video, or sequence frames.

## Agent workflow

1. Preserve the original in a private workspace. Run `ai-image-background-removal
   doctor --root <workspace> --reference <image>`. `doctor` does no network or
   provider compute and never prints credentials.
2. Run `ai-image-background-removal plan --root <workspace> --reference <image>
   --out-dir <fresh-directory>`. Show the immutable `plan_sha256` and obtain one
   explicit compute confirmation for that exact digest.
3. Run `ai-image-background-removal prepare --root <workspace> --reference <image>
   --out-dir <same-fresh-directory> --confirm-plan-sha256 <approved-digest>`.
   Never reuse the digest or automatically resubmit an uncertain attempt.
   For specifically identified translucent material, add
   `--profile matting_2048_refined_foreground_v1` to both `plan` and `prepare`.
   For a specifically reviewed missed subject or prop, the slower official
   `general_heavy_2048_refined_foreground_v1` profile may be tried with a fresh
   plan and confirmation; never select it as an automatic retry.
4. Inspect `cutout.png`, `foreground.png`, warnings, and every review image.
   Program success is not human visual approval.
5. Return `cutout.png` when original coordinates matter and `foreground.png` for
   direct use. For another Harness, return the whole bundle and `handoff.json`,
   never a remote URL.
6. For one identified residual-background patch only, use `correct preview`, show
   its digest-bound evidence, and stop for approval before `correct apply`.

## Experimental deterministic QA

Keep `general_light_1024_refined_foreground_v1` as the default preparation
profile. When three separately planned, confirmed, and completed preparations
for the same source already exist, the opt-in command below may reject divergent
results without network or provider compute:

```text
ai-image-background-removal qa consensus --root <workspace> \
  --primary <light-1024-handoff.json> \
  --light-2k <light-2k-handoff.json> \
  --matting <matting-handoff.json> \
  --out <fresh-consensus-report.json>
```

This experimental policy compares source-coordinate `cutout.png` alpha and
accepts only the primary Light 1024 foreground when the Light 2K binary-alpha
IoU is at least 0.95 and the Matting IoU is at least
0.80. Any divergence rejects the result with a nonzero exit status. It never
selects another profile, never submits a missing candidate, and does not certify
semantic correctness. Do not enable it implicitly in the default chain.

## Boundaries

- fal BiRefNet V2 is the current opaque-image foreground source. Do not run or download
  local ONNX models and do not silently switch providers or profiles.
- Keep `FAL_KEY`, upload URLs, result URLs, request identifiers, and transport
  errors out of public plans, reports, handoffs, and logs.
- Preserve continuous alpha and source transparency; zero RGB wherever alpha is
  zero. Never erase all white pixels.
- Do not overwrite the original or an existing preparation directory.
- Treat an indeterminate provider attempt as terminal and ask for a new decision.
- Keep `ai_reference_preparation_handoff_v1` provider-neutral for consumers.
- Treat an experimental consensus pass as a conservative mask-agreement signal,
  not a replacement for semantic image understanding.
