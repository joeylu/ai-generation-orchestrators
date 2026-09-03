# Ordinary reference artwork to generation-ready input

The current opaque-image route uses fal BiRefNet V2 as the foreground extractor.
Model weights, ONNX Runtime, and PyMatting are not installed locally.

```text
original still -> existing alpha OR confirmed fal V2 refined foreground request
               -> local alpha/output validation
               -> cutout.png -> proportional fit -> foreground.png + review
               -> preparation.json + provider-neutral handoff.json
```

## Setup

Install the immutable release and configure `FAL_KEY` in the server process
environment. Do not place the key in a repository file, command line, plan,
report, fixture, or log. The runtime dependency is the pinned `fal-client`.

`doctor` checks the local dependency and whether a credential is present. It
does not contact fal, upload an image, quote provider pricing, or run inference.

```powershell
ai-image-background-removal doctor --root my-animation --reference reference.png --require-ready
```

## Plan and one-shot confirmation

Planning reads and fingerprints one still image but performs no network access.
The plan binds the original bytes, decoded dimensions, output directory, fixed
provider profile, and output contract.

```powershell
ai-image-background-removal plan --root my-animation --reference reference.png --out-dir work/reference/r001
```

After the user confirms the exact `plan_sha256`, execute it once:

```powershell
ai-image-background-removal prepare --root my-animation --reference reference.png --out-dir work/reference/r001 --confirm-plan-sha256 <approved-plan-sha256>
```

For difficult translucent material, bind the optional profile into both commands:

```powershell
ai-image-background-removal plan --root my-animation --reference reference.png --out-dir work/reference/r002 --profile matting_2048_refined_foreground_v1
ai-image-background-removal prepare --root my-animation --reference reference.png --out-dir work/reference/r002 --profile matting_2048_refined_foreground_v1 --confirm-plan-sha256 <approved-plan-sha256>
```

Do not silently fall back between profiles. Each profile/output directory needs
its own plan and confirmation.

The diagnostic `matting_2048_source_rgb_mask_v1` profile requests the raw mask
in the same fal call and applies it to the original source RGB without PyMatting.
It can reveal whether provider foreground refinement removed material, but
semi-transparent pixels may retain colours from the old background. Review it
against both black and a contrasting colour; it is not the default profile.

The opt-in `dynamic_2304_refined_foreground_v1` profile uses the provider's
Dynamic model at its 2304 operating resolution for difficult semantic shapes.
It still needs its own plan, confirmation, and visual review and is not an
automatic retry after another profile fails.

The official 2K profiles are also available but never selected automatically:

- `general_light_2k_2048_refined_foreground_v1` uses General Use (Light 2K).
- `general_heavy_2048_refined_foreground_v1` uses the slower, higher-accuracy
  General Use (Heavy) model for a specifically reviewed missed subject or prop.

Neither profile can reconstruct an unknown background/foreground separation
after both colours have already been composited inside translucent material.
Each profile and fresh output directory requires a new digest confirmation.

Opaque input is encoded as an inline data URI and submitted once to the
BiRefNet V2 endpoint with the fixed
`general_light_1024_refined_foreground_v1` profile. The request asks for one
inline PNG foreground and enables provider foreground refinement. It does not
request a second mask artifact.

The authorization digest is single-use. State is stored below the ignored
`.ai-image-background-removal/attempts/` directory. Any exception after the
attempt is reserved becomes `indeterminate`; the CLI never resubmits it.

Meaningful existing transparency bypasses fal, but still publishes the same
reviewable artifact family.

## Experimental offline consensus QA

The default chain remains a single General Light 1024 request. It never creates
Light 2K or Matting candidates automatically.

If all three candidates were independently planned, confirmed, and produced for
the same immutable source, an experimental offline gate is available:

```powershell
ai-image-background-removal qa consensus `
  --root my-animation `
  --primary work/reference/light/handoff.json `
  --light-2k work/reference/light-2k/handoff.json `
  --matting work/reference/matting/handoff.json `
  --out work/reference/qa/consensus-r001.json
```

The command fully validates all three handoffs, source identity, provider
profiles, cutout/foreground fingerprints, and image dimensions. It compares
source-coordinate `cutout.png` files, binarizes alpha at 128, and accepts only
the primary Light 1024 foreground when Light 2K IoU is at
least 0.95 and Matting IoU is at least 0.80. A rejection exits nonzero and never
selects a fallback. The output is a fresh, SHA-256-stamped experimental report.

The gate performs no network, provider, or GPU compute. Alpha consensus cannot
prove semantic correctness: several models may agree on the same wrong mask, or
the minority model may be the only correct result. Use it only as a conservative
automatic rejection mechanism.

## Provider result boundary

Only an inline, single-frame RGBA PNG matching the EXIF-oriented source
dimensions is accepted. Empty foreground, unresolved background, opaque output,
remote output URLs, changed dimensions, malformed base64, and oversized output
are rejected.

Provider URLs, request IDs, credentials and raw transport errors never enter the
public output. The portable segmentation evidence is limited to the generic
backend, fixed profile ID, and `remote` execution class.

## Lightweight deterministic post-processing retained

- preserve the provider's continuous alpha and refined foreground RGB;
- set RGB to zero wherever alpha is zero;
- crop the nonzero foreground and contain-fit it without enlarging;
- render black, white, green, purple, checker, and alpha reviews;
- fingerprint all authoritative artifacts and atomically publish a fresh folder.

The provider preparation report is
`ai_frame_animation_reference_preparation_v8` and records
`method: external_segmentation`. Historical v1-v7 reports remain readable. New
consumers must depend on `ai_reference_preparation_handoff_v1`, not the producer
report version or implementation.

## Quality and compatibility

Changing the mask producer cannot preserve old pixels exactly. The output file
roles, alpha invariants, fitting behavior, review workflow, fingerprints, and
handoff contract remain stable. Historical ONNX acceptance evidence is retained
only as a comparison baseline; it is not evidence that the fal route passed.

CI uses fake fal clients and inline mask fixtures. It must not upload images,
contact fal, require `FAL_KEY`, or incur provider cost.

External schedulers and service adapters must preserve the same confirmation,
durable attempt-state, fresh-output, non-retry, redaction, and artifact
validation boundaries. See the [runtime integration contract](runtime-integration.md).
The ten-case provider comparison and experimental QA evidence are summarized in
the [fal V2 benchmark](fal-v2-benchmark.md).

## Optional correction

`correct` remains a separate, digest-confirmed local repair for one bounded
residual-background region. It is never an automatic continuation of `prepare`
and cannot restore subject material omitted by the provider mask.
