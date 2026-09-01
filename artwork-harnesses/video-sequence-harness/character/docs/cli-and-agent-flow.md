# CLI and Agent flow

The human-facing path is documented in the root README. This page exposes the
individual deterministic stages for Agents and diagnosis.

## Choose the source first

- **Existing video:** initialize a workspace, copy the reference and raw video
  into it, then follow stages 1, 2, 4, and 5. Skip provider setup, generation
  authorization, and `run` entirely. No generation attempt is needed or invented.
- **New video:** configure the optional local provider, then follow every stage,
  including exactly one explicit generation-compute confirmation.

In both cases the example raw path is `my-animation/work/raw/source.mp4`.
For an existing video, keep the original and place a copy there. The unused
provider template created by `init` does not need to be filled in.

All commands below run from the directory containing `my-animation`, not from
inside it. `--job`, `--plan`, `--raw-video`, `--out-dir`, and `--delivery` are
workspace-relative. `--root`, `--provider-config`, and the `inspect` target are
resolved from the shell's current directory. Use the same Python environment
throughout; `python -m ai_frame_animation` is equivalent to the installed CLI.

## 0. Initialize and self-test without compute

```powershell
ai-frame-animation self-test
ai-frame-animation init `
  --root my-animation `
  --motion "A side-view running loop"
ai-frame-animation tools check --root my-animation
```

`self-test` does not generate media or require FFmpeg. `init` creates a new
private-by-default workspace and refuses to overwrite a non-empty directory.
`tools check` is offline. On a supported platform, an explicitly authorized
`tools install --root my-animation` downloads and verifies the packaged lock;
it is never an implicit side effect of `doctor`, `plan`, or `process`.

## 1. Diagnose without compute

For an existing video, check processing dependencies only:

```powershell
ai-frame-animation doctor --root my-animation --require-ready
```

Only for new generation, also check your provider configuration. This first check
can report `plan_required_for_input_preflight` until stage 2 is complete:

```powershell
ai-frame-animation doctor `
  --root my-animation `
  --provider minimax_h3 `
  --provider-config my-animation/.ai-frame-animation/provider.minimax-h3.json
```

The command checks installed Python packages, `ffmpeg`/`ffprobe`, local provider
configuration, the API workflow, nodes, and input names. It does not connect to a
provider. Host, workflow, and secret values are redacted. With no explicit tool
overrides, both `doctor` and `process` first check
`<root>/.ai-frame-animation/tools/ffmpeg/bin/`, then the system `PATH`.

## 2. Prepare ordinary artwork, then plan without compute

For new generation, accept the original image regardless of its background;
use program-owned preparation, not a demand for a transparent user upload:

```powershell
ai-frame-animation doctor --root my-animation --reference reference.png --preparation-config my-animation/.ai-frame-animation/segmentation.json
ai-frame-animation prepare --root my-animation --reference reference.png --out-dir work/reference/r001 --config my-animation/.ai-frame-animation/segmentation.json
```

`doctor` only checks setup; `prepare` may run local CPU foreground segmentation.
Neither contacts a provider or downloads a model. Omit segmentation config when
the original already has usable alpha. Review `foreground.png` and warnings,
then add `--prepared-reference work/reference/r001/preparation.json` to `plan`:

```powershell
ai-frame-animation plan `
  --root my-animation `
  --job job.json `
  --out work/plan.json
```

If a specific residual background hole needs correction, the optional
[`correct preview` -> explicit preview approval -> `correct apply`](../../../image-background-removal-harness/docs/reference-correction.md)
flow publishes a new preparation. It is not an automatic step, cannot repair
missing foreground, and does not consume or replace the one video-compute
confirmation. The Agent must not approve its own proposed correction or hand-edit
masks/reports. Use only the resulting `preparation.json`, never the unconfirmed
preview, in a new plan. Existing plans are left intact.

The plan fingerprints the reference, selects a safe key colour from bounded
foreground sampling when prepared, fixes continuity/delivery variants, and emits a canonical
`plan_sha256`. Provider config, endpoints, secrets, workflow paths, and model
paths are not part of the plan.

For **new generation only**, now check that exact plan and reference without
compute, before asking for confirmation:

```powershell
ai-frame-animation doctor `
  --root my-animation `
  --provider minimax_h3 `
  --provider-config my-animation/.ai-frame-animation/provider.minimax-h3.json `
  --plan work/plan.json `
  --require-ready
```

During `run`, the program composites the prepared foreground onto the plan's key,
preserving white details and soft alpha. `reference_preparation_required` means
the preparation step was skipped, not that ordinary source images are forbidden.
Original, foreground and preparation-report fingerprints are rechecked before
authorization is consumed. The original job continues to name the original image.
See [reference preparation](../../../image-background-removal-harness/docs/reference-preparation.md) for CPU model setup and the
distinction between missing setup, an unusable source and an unreliable mask.
Known direct KJ resize nodes must preserve aspect ratio and use the same key for
padding. Static preflight does not certify every possible workflow transform.

## 3. Ask once, then run once

This stage is only for new generation. An existing video goes directly to stage 4.

After the user explicitly confirms the displayed plan digest, the Agent creates
a unique attempt ID and invokes:

```powershell
ai-frame-animation run `
  --root my-animation `
  --plan work/plan.json `
  --confirm-plan-sha256 <confirmed-digest> `
  --attempt-id <new-attempt-id> `
  --provider-config my-animation/.ai-frame-animation/provider.minimax-h3.json `
  --raw-out work/raw/source.mp4
```

`run` atomically creates a digest-bound attempt and permits at most one provider
submission. Reusing the attempt ID fails. A timeout or uncertain response after
submission becomes terminal `GENERATION_INDETERMINATE`; polling may continue for
the same provider request, but submission is never repeated automatically.

## 4. Process deterministically

```powershell
ai-frame-animation process `
  --root my-animation `
  --plan work/plan.json `
  --raw-video work/raw/source.mp4 `
  --out-dir work/revisions/r001
```

The command fingerprints and probes the raw video, decodes once, and derives all
requested 16/32/64 variants from the shared decoded timeline. A new output
directory creates a deterministic revision without replaying generation.
Source aspect ratio is preserved with transparent padding. Retained canvas bands
and empty frames are blocked before alignment; unresolved clipping fails strict
validation. A delivery is published only after the selected policy passes.

When a deterministic runtime adapter has already probed and losslessly decoded
the same raw source, it may invoke:

```powershell
ai-frame-animation process `
  --root my-animation `
  --plan work/plan.json `
  --raw-video work/raw/source.mp4 `
  --decoded-handoff work/source/decoded-handoff.json `
  --out-dir work/revisions/r001
```

The handoff binds the raw source, probe JSON, exact decoded directory inventory,
every PNG byte count and SHA-256, and the probe/decode tool evidence. The core
rejects symlinks, missing or extra frames, modified artifacts, path escapes, and
non-contiguous frame indices before processing. This path performs no FFmpeg or
ffprobe lookup or invocation.

`--decoded-dir` plus `--probe-json` is reserved for regression fixtures and is
accepted only when `AI_FRAME_ANIMATION_OFFLINE_TESTS=1`. Normal runs always probe
and decode the supplied raw video themselves unless a verified handoff is given.
An Agent must never hand-edit a handoff or use the fixture-only flags as a runtime
adapter contract.

## 5. Inspect and validate

```powershell
ai-frame-animation inspect my-animation/work/revisions/r001
ai-frame-animation validate `
  --root my-animation `
  --delivery work/revisions/r001 `
  --policy strict
```

Validation re-fingerprints the raw source, verifies manifest hash chains and
artifact checksums, compares every atlas cell with its PNG frame, checks GIF
binary transparency/duration, and enforces the rational source timeline.

The default is `strict`. Explicit `best_effort` may omit an optional GIF or a
failed independent variant, but cannot waive raw identity, attempt integrity,
alpha correctness, checksum correctness, or path safety. The requested policy
must match the policy digest-bound into the delivery manifest.
