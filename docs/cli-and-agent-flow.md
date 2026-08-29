# CLI and Agent flow

## 1. Diagnose without compute

```powershell
ai-frame-animation doctor --root .
```

The command checks installed Python packages and whether `ffmpeg`/`ffprobe` are
discoverable. It does not connect to a provider. Optional provider diagnostics
validate local configuration statically and redact host/workflow/secret values.

## 2. Plan without compute

```powershell
ai-frame-animation plan `
  --root . `
  --job examples/my-job.json `
  --out work/my-job/plan.json
```

The plan fingerprints the reference, selects a safe key colour from bounded
reference sampling, fixes continuity/delivery variants, and emits a canonical
`plan_sha256`. Provider config, endpoints, secrets, workflow paths, and model paths
are not part of the plan.

## 3. Ask once, then run once

After the user explicitly confirms the displayed plan digest:

```powershell
ai-frame-animation run `
  --root . `
  --plan work/my-job/plan.json `
  --confirm-plan-sha256 <confirmed-digest> `
  --attempt-id <new-attempt-id> `
  --provider-config <private-config-path> `
  --raw-out work/my-job/raw/source.mp4
```

`run` atomically creates a digest-bound attempt and permits at most one provider
submission. Reusing the attempt ID fails. A timeout or uncertain response after
submission becomes terminal `GENERATION_INDETERMINATE`; polling may continue for
the same provider request, but submission is never repeated automatically.

## 4. Process deterministically

```powershell
ai-frame-animation process `
  --root . `
  --plan work/my-job/plan.json `
  --raw-video work/my-job/raw/source.mp4 `
  --out-dir work/my-job/revisions/r001
```

The command fingerprints and probes the raw video, decodes once, and derives all
requested 16/32/64 variants from the shared decoded timeline. A new output
directory creates a new deterministic revision without replaying generation.

`--decoded-dir` plus `--probe-json` is reserved for regression fixtures and is
accepted only when `AI_FRAME_ANIMATION_OFFLINE_TESTS=1`; it performs no ffmpeg
call. Normal runs always probe and decode the supplied raw video themselves.

## 5. Inspect and validate

```powershell
ai-frame-animation inspect work/my-job/revisions/r001
ai-frame-animation validate `
  --root . `
  --delivery work/my-job/revisions/r001 `
  --policy strict
```

Validation re-fingerprints the raw source, verifies manifest hash chains and
artifact checksums, compares every atlas cell with its PNG frame, checks GIF
binary transparency/duration, and enforces the rational source timeline.

The default is `strict`. An explicit `best_effort` run may omit an optional GIF
or failed independent variant, but it cannot waive raw identity, attempt
integrity, alpha correctness, checksum correctness, or path safety.
The validation policy is an expected policy, not an override: it must match the
policy digest-bound into the delivery manifest.
