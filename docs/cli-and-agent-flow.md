# CLI and Agent flow

The human-facing path is documented in the root README. This page exposes the
individual deterministic stages for Agents and diagnosis.

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

```powershell
ai-frame-animation doctor `
  --root my-animation `
  --provider minimax_h3 `
  --provider-config my-animation/.ai-frame-animation/provider.minimax-h3.json `
  --require-ready
```

The command checks installed Python packages, `ffmpeg`/`ffprobe`, local provider
configuration, the API workflow, nodes, and input names. It does not connect to a
provider. Host, workflow, and secret values are redacted. With no explicit tool
overrides, both `doctor` and `process` first check
`<root>/.ai-frame-animation/tools/ffmpeg/bin/`, then the system `PATH`.

## 2. Plan without compute

```powershell
ai-frame-animation plan `
  --root my-animation `
  --job job.json `
  --out work/plan.json
```

The plan fingerprints the reference, selects a safe key colour from bounded
reference sampling, fixes continuity/delivery variants, and emits a canonical
`plan_sha256`. Provider config, endpoints, secrets, workflow paths, and model
paths are not part of the plan.

## 3. Ask once, then run once

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

`--decoded-dir` plus `--probe-json` is reserved for regression fixtures and is
accepted only when `AI_FRAME_ANIMATION_OFFLINE_TESTS=1`. Normal runs always probe
and decode the supplied raw video themselves.

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
