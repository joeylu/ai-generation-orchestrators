# AI Generation Orchestrators

[中文快速入门](README.zh-CN.md)

An Agent-driven game-asset Harness collection. The public catalog is organized
into [artwork](artwork-harnesses/), [audio](audio-harnesses/),
[game UI](game-ui-harnesses/), and [game scene](game-scene-harnesses/) categories.
Every unavailable Harness is explicitly marked planned; documentation is not an
implementation claim.

## Harness catalog

| Category | Current public status |
| --- | --- |
| [Artwork](artwork-harnesses/) | Image background removal and character video sequences implemented; image generation, direct image sequences, and prop video sequences planned. |
| [Audio](audio-harnesses/) | Planned. |
| [Game UI](game-ui-harnesses/) | UI-decomposition research in progress; no published Skill yet. |
| [Game scene](game-scene-harnesses/) | Planned. |

Two independently installable runtimes implement the current public path:
`ai-image-background-removal` prepares still artwork, while
`ai-frame-animation` plans and delivers video-derived transparent frame
animation. Install either one alone, or connect them through the neutral handoff
contract documented below.

```text
reference image + motion request
  -> optional local CLI or MCP background-removal producer
  -> reviewed ai_reference_preparation_handoff_v1
  -> immutable plan
  -> existing raw video OR one confirmed generation attempt
  -> deterministic RGBA processing
  -> PNG frames + spritesheet/atlas + optional GIF + manifest
```

The human describes the animation and confirms compute once when a new video is
needed. The Agent prepares the plan and invokes the tools. The installed program
owns attempt state, media processing, validation, checksums, and packaging.

Already have a character video? Use the existing-video path below. It needs no
ComfyUI, model, provider configuration, or generation attempt. Local processing
does not change the action in that video. Key-based transparency expects a
separable, near-solid background; this is not an arbitrary video-background remover.

## First successful path

### 1. Install an immutable release

Requires Python 3.10 or newer. Download the wheel and `SHA256SUMS.txt` from the
[GitHub Releases](https://github.com/joeylu/ai-generation-orchestrators/releases)
page, verify the wheel digest, then install that exact file:

```powershell
Get-FileHash .\ai_frame_animation-<version>-py3-none-any.whl -Algorithm SHA256
python -m pip install .\ai_frame_animation-<version>-py3-none-any.whl
```

For a source checkout under development, install the package you need from its
Harness directory. Editable installation is intended for contributors, not
production consumers:

```powershell
python -m pip install -e ./artwork-harnesses/video-sequence-harness/character
python -m pip install -e ./artwork-harnesses/image-background-removal-harness
```

### 2. Verify the Python installation without compute

```powershell
ai-frame-animation self-test
```

`self-test` validates packaged schemas, digests, and loop sampling without
creating media, contacting ComfyUI, or using a GPU.

### 3. Create a private-by-default workspace

```powershell
ai-frame-animation init `
  --root my-animation `
  --motion "A clean side-view running loop with a stable camera"
```

The command refuses to overwrite a non-empty directory and creates:

```text
my-animation/
  job.json
  .gitignore
  .ai-frame-animation/
    .gitignore
    provider.minimax-h3.json
```

Copy the character image to `my-animation/reference.png`. Provider setup is only
needed for new generation, not for processing an existing video.

Check FFmpeg without network access. On Windows x64, the locked installer can
place a verified build inside this ignored workspace without changing system
`PATH`:

```powershell
ai-frame-animation tools check --root my-animation
ai-frame-animation tools install --root my-animation  # only when the check reports missing tools
ai-frame-animation tools check --root my-animation --require-ready
```

Other platforms can use trusted system packages or explicit executable paths.
See [Installation](artwork-harnesses/video-sequence-harness/character/docs/installation.md) for the supported-platform table,
verification contract, license, and manual alternatives.

### 4. Choose your input and ask an Agent

Make the complete Skill available to your Agent as described in
[Agent setup](artwork-harnesses/video-sequence-harness/character/docs/agent-setup.md), or open this repository and point the Agent to
[`artwork-harnesses/video-sequence-harness/character/SKILL.md`](artwork-harnesses/video-sequence-harness/character/SKILL.md).
Installing the Python wheel alone does not register the Skill with an Agent.

For background removal without animation, use the separate
[`image-background-removal` Skill](artwork-harnesses/image-background-removal-harness/SKILL.md).

#### A. Process an existing video

Keep a copy of the video at `my-animation/work/raw/source.mp4` and leave the
generated provider template unused. Check only local processing dependencies:

```powershell
ai-frame-animation doctor --root my-animation --require-ready
```

Example request:

> Use the transparent 2D frame-animation Skill with my-animation/reference.png
> and my-animation/work/raw/source.mp4. Only post-process this existing video
> into 32 frames at 256 px, loop, strict quality. Do not configure or contact a
> generation provider. Return the validated artifacts and any warnings.

The Agent uses `plan -> process -> inspect -> validate`, without `run` or a
generation-compute confirmation. Processing uses local CPU, memory, and disk.
See the [manual CLI flow](artwork-harnesses/video-sequence-harness/character/docs/cli-and-agent-flow.md) for the same route.

#### B. Generate a new video locally

This optional path requires your own working local ComfyUI MiniMax H3 setup;
the project does not install models or start ComfyUI. Export your workflow in API
format to `my-animation/.ai-frame-animation/workflow.json`, then replace the two
binding node IDs in `provider.minimax-h3.json` and adjust input names if needed.

Use ordinary artwork: white backgrounds, screenshots and complex backgrounds do
not require a user-supplied transparent PNG. Background removal is an optional,
independent producer: use the local `ai-image-background-removal` CLI shown below,
or an MCP service that materializes the same reviewed handoff bundle. Existing
alpha needs no model; the local opaque-artwork route uses explicitly configured
CPU segmentation. Setup is separate from source quality, and no model is
downloaded automatically. See
[reference preparation](artwork-harnesses/image-background-removal-harness/docs/reference-preparation.md) for setup and limitations.

Compile the job, then check that exact input statically before any compute request:

```powershell
ai-image-background-removal prepare --root my-animation --reference reference.png --out-dir work/reference/r001 --config my-animation/.ai-frame-animation/segmentation.json
# Inspect work/reference/r001/foreground.png before confirming video compute.
ai-frame-animation plan --root my-animation --job job.json --prepared-reference work/reference/r001/handoff.json --out work/plan.json
ai-frame-animation doctor `
  --root my-animation `
  --provider minimax_h3 `
  --provider-config my-animation/.ai-frame-animation/provider.minimax-h3.json `
  --plan work/plan.json `
  --require-ready
```

This validates local configuration, bindings, and the digest-bound reference's
prepared-input compatibility. Omitting `--plan` leaves input preflight incomplete.
It does not connect to ComfyUI or create media; arbitrary graph transforms and
the eventual animation's visual quality still require review.

Example generation request:

> Use the transparent 2D frame-animation Skill. Take `my-animation/reference.png`
> and make a 32-frame side-view running loop at 256 px under strict quality. Show
> me the immutable plan and ask once before any generation compute.

The Agent should manage the job JSON, attempt ID, internal paths, processing, and
validation. The user should see one plan and make one compute decision.

#### Optional: review a local preparation defect

If an otherwise useful foreground has an identified patch of leftover background,
ask the Agent to preview a local correction and wait for your approval. This is
not a required step for every reference and cannot restore missing hair or gauze.
The Agent manages coordinates and digests; the program performs the edit.

On the background-removal CLI, `correct preview` shows the proposed change; only
after you approve that exact preview may `correct apply` create a new preparation
and handoff. Plan from that new `handoff.json`. This visual-edit approval is
separate from the one video compute confirmation. The video CLI intentionally
has no `prepare` or `correct` commands.
See [local correction](artwork-harnesses/image-background-removal-harness/docs/reference-correction.md) for commands and limits, and
[reference acceptance](artwork-harnesses/image-background-removal-harness/docs/reference-acceptance.md) for the fixed seen-regression
set and known failures. Structural checks alone do not certify a clean matte.

See [Agent setup](artwork-harnesses/video-sequence-harness/character/docs/agent-setup.md) for the repository-local and installed
Skill flows. The complete manual CLI flow is in
[CLI and Agent flow](artwork-harnesses/video-sequence-harness/character/docs/cli-and-agent-flow.md).

## Safety model

- `init`, `self-test`, `doctor`, `plan`, `inspect`, and `validate` never submit a
  provider job.
- Generation is never retried automatically after a provider request may have
  been accepted.
- Deterministic processing can be repeated from the same raw-video digest.
- A 16/32/64-frame family is derived from one raw video and one decoded timeline.
- A deterministic runtime adapter can supply a digest-bound `decoded-handoff` so
  an existing verified probe/decode is reused without invoking FFmpeg again.
- `strict` delivery is the default. Explicit `best_effort` never accepts opaque
  output as transparent success.
- Tests use fixtures and test doubles only.

## CLI contract

- `init` — create a private-by-default starter workspace without overwriting.
- `self-test` — verify the installation offline without creating media.
- `tools check` — verify FFmpeg/ffprobe and local provenance without network.
- `tools install` — explicitly install a hash-locked local build on supported platforms.
- `doctor` — report redacted, actionable dependency and plugin diagnostics.
- `plan` — compile a structured job into an immutable, digest-bound plan.
- `run` — consume one authorization and perform at most one provider submission.
- `process` — derive one delivery family from a raw video or verified predecoded handoff.
- `inspect` — report attempt, raw-source, timeline, and artifact metadata.
- `validate` — enforce `strict` or explicit `best_effort` delivery policy.

The core does not bundle model weights, credentials, private workflows, host
paths, Docker services, web/database components, or worker protocols. MiniMax H3
support is an optional local ComfyUI plugin configured by the consumer.

The separate `ai-image-background-removal` CLI exposes `doctor`, `prepare`,
`correct preview/apply`, `inspect`, and `validate`. Its local output and a future
MCP adapter use the same `ai_reference_preparation_handoff_v1`; the video runtime
does not import the background-removal package or require its producer name.

## Development

```powershell
python -m pip install -e ./artwork-harnesses/video-sequence-harness/character
python -m pip install -e ./artwork-harnesses/image-background-removal-harness
python -m unittest discover -s artwork-harnesses/image-background-removal-harness/tests -p "test_*.py"
python -m unittest discover -s artwork-harnesses/video-sequence-harness/character/tests -p "test_*.py"
python -m unittest discover -s .github/repository-tests -p "test_*.py"
python <skill-creator>/scripts/quick_validate.py `
  artwork-harnesses\video-sequence-harness\character
python <skill-creator>/scripts/quick_validate.py `
  artwork-harnesses\image-background-removal-harness
```

Human documentation starts at the character Harness
[documentation index](artwork-harnesses/video-sequence-harness/character/docs/README.md). Repository-wide
Agent rules live in [AGENTS.md](AGENTS.md). See [CONTRIBUTING.md](.github/CONTRIBUTING.md)
for the golden-fixture policy.
