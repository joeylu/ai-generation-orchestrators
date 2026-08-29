# AI Frame Animation

An Agent-driven, provider-neutral toolkit that turns character reference images
and motion requirements into transparent 2D frame animation.

The public contract is intentionally narrow:

```text
reference image + motion request
  -> plan
  -> one compute authorization
  -> one raw-video generation attempt
  -> deterministic RGBA processing
  -> PNG frames + spritesheet/atlas + optional GIF + manifest
```

The Agent understands natural language, prepares a plan, asks once before
compute, and invokes the CLI. The program owns generation-attempt state, media
processing, validation, checksums, and packaging.

## Safety model

- `doctor`, `plan`, `inspect`, and `validate` are read-only with respect to
  provider compute.
- Generation is never retried automatically after a provider request may have
  been accepted.
- Deterministic processing can be repeated from the same raw-video digest.
- A 16/32/64-frame family is derived from one raw video and one decoded timeline.
- `strict` delivery is the default. `best_effort` is explicit and never accepts
  opaque output as transparent success.
- Tests are offline: fixtures and test doubles only.

## Install and discover

```powershell
python -m pip install -e .
ai-frame-animation doctor
ai-frame-animation --help
```

Agent entry point:
[skills/artwork/skills-2d-frame-animation-video/SKILL.md](skills/artwork/skills-2d-frame-animation-video/SKILL.md)

Human documentation starts at [docs/README.md](docs/README.md). Repository-wide
Agent rules live in [AGENTS.md](AGENTS.md).

## CLI contract

- `doctor` — offline, redacted dependency and plugin diagnostics.
- `plan` — compile a structured job into an immutable, digest-bound plan.
- `run` — consume one authorization and perform at most one provider submission.
- `process` — deterministically derive one or more delivery variants from raw video.
- `inspect` — report attempt, raw-source, timeline, and artifact metadata.
- `validate` — enforce `strict` or explicit `best_effort` delivery policy.

The core does not bundle model weights, provider credentials, private workflow
files, host paths, Docker services, web/database components, or worker protocols.
MiniMax H3 support is an optional local plugin configured by the consumer.

## Development

```powershell
python -m unittest discover -s tests -p "test_*.py"
python <skill-creator>/scripts/quick_validate.py `
  skills\artwork\skills-2d-frame-animation-video
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for change and golden-fixture policy.
