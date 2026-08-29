# Agent skills

The canonical public Agent entry point is:

- [`artwork/skills-2d-frame-animation-video/`](artwork/skills-2d-frame-animation-video/) — plan one character animation request, obtain one compute confirmation, invoke the deterministic CLI, and explain the validated delivery.

For repository-local use, explicitly point the Agent to this Skill. For installed
use, import or copy the complete directory through the mechanism supported by the
Agent host; do not assume that an arbitrary `skills/` directory is discovered
automatically. `agents/openai.yaml` provides the UI-facing name and default
invocation prompt. Executable behavior belongs to the installed
`ai-frame-animation` package, not to duplicated provider or handoff scripts.

Provider integrations are optional plugins. They may implement generation, but
must obey the core's single-submission attempt contract and remain free of private
paths, credentials, and host orchestration protocols.
