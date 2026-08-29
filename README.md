# AI Frame Animation

An Agent-driven, provider-neutral toolkit that turns a character reference image
and a motion request into validated transparent 2D frame animation.

```text
reference image + motion request
  -> immutable plan
  -> one compute confirmation
  -> one raw-video generation attempt
  -> deterministic RGBA processing
  -> PNG frames + spritesheet/atlas + optional GIF + manifest
```

The human describes the animation and confirms compute once. The Agent prepares
the plan and invokes the tools. The installed program owns attempt state, media
processing, validation, checksums, and packaging.

## First successful path

### 1. Install an immutable release

Requires Python 3.10 or newer. Download the wheel and `SHA256SUMS.txt` from the
[GitHub Releases](https://github.com/joeylu/ai-generation-orchestrators/releases)
page, verify the wheel digest, then install that exact file:

```powershell
Get-FileHash .\ai_frame_animation-<version>-py3-none-any.whl -Algorithm SHA256
python -m pip install .\ai_frame_animation-<version>-py3-none-any.whl
```

For a source checkout under development, use `python -m pip install .`. Editable
installation is intended for contributors, not production consumers.

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

Copy the character image to `my-animation/reference.png`. Export the local
ComfyUI workflow in API format to
`my-animation/.ai-frame-animation/workflow.json`, then replace the two binding
node IDs in `provider.minimax-h3.json`.

Check FFmpeg without network access. On Windows x64, the locked installer can
place a verified build inside this ignored workspace without changing system
`PATH`:

```powershell
ai-frame-animation tools check --root my-animation
ai-frame-animation tools install --root my-animation  # only when the check reports missing tools
ai-frame-animation tools check --root my-animation --require-ready
```

Other platforms can use trusted system packages or explicit executable paths.
See [Installation](docs/installation.md) for the supported-platform table,
verification contract, license, and manual alternatives.

Check the provider configuration statically before any compute request:

```powershell
ai-frame-animation doctor `
  --root my-animation `
  --provider minimax_h3 `
  --provider-config my-animation/.ai-frame-animation/provider.minimax-h3.json `
  --require-ready
```

This validates the local configuration, workflow file, nodes, and input names. It
does not connect to ComfyUI.

### 4. Ask an Agent

Make the canonical Skill directory available through the installation mechanism
supported by your Agent, or open this repository and explicitly point the Agent
to [`skills/artwork/skills-2d-frame-animation-video/SKILL.md`](skills/artwork/skills-2d-frame-animation-video/SKILL.md).

Example request:

> Use the transparent 2D frame-animation Skill. Take `my-animation/reference.png`
> and make a 32-frame side-view running loop at 256 px under strict quality. Show
> me the immutable plan and ask once before any generation compute.

The Agent should manage the job JSON, attempt ID, internal paths, processing, and
validation. The user should see one plan and make one compute decision.

See [Agent setup](docs/agent-setup.md) for the repository-local and installed
Skill flows. The complete manual CLI flow is in
[CLI and Agent flow](docs/cli-and-agent-flow.md).

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

## Development

```powershell
python -m pip install -e .
python -m unittest discover -s tests -p "test_*.py"
python <skill-creator>/scripts/quick_validate.py `
  skills\artwork\skills-2d-frame-animation-video
```

Human documentation starts at [docs/README.md](docs/README.md). Repository-wide
Agent rules live in [AGENTS.md](AGENTS.md). See [CONTRIBUTING.md](CONTRIBUTING.md)
for the golden-fixture policy.
