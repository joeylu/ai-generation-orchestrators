# Agent skills

The canonical public Agent entry point is:

- [`artwork/skills-2d-frame-animation-video/`](artwork/skills-2d-frame-animation-video/) — plan one character animation request, obtain one compute confirmation, invoke the deterministic CLI, and explain the validated delivery.

Discover `SKILL.md` files recursively. `agents/openai.yaml` provides the UI-facing
name and default invocation prompt; executable behavior belongs to the installed
`ai-frame-animation` package, not to duplicated provider or handoff scripts.

Provider integrations are optional plugins. They may implement generation, but
must obey the core's single-submission attempt contract and remain free of private
paths, credentials, and host orchestration protocols.
