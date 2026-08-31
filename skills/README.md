# Agent skills

The canonical public Agent entry point is:

- [`artwork/skills-2d-frame-animation-video/`](artwork/skills-2d-frame-animation-video/) — process an existing character video, or prepare ordinary reference artwork and plan one new generation with one compute confirmation, then explain the validated transparent delivery. An optional local residual-background correction requires its own preview approval; it is not a mandatory preparation stage.

For repository-local use, explicitly point the Agent to this Skill. For installed
use, import or copy the complete directory through the mechanism supported by the
Agent host; do not assume that an arbitrary `skills/` directory is discovered
automatically. `agents/openai.yaml` provides the UI-facing name and default
invocation prompt. Executable behavior belongs to the installed
`ai-frame-animation` package, not to duplicated provider or handoff scripts.

For release-based installation, use the complete version-matched Skill ZIP when
available; see [Agent setup](../docs/agent-setup.md#installed-skill-use) for the
checksum check and the fixed-tag fallback for older releases.
Source-checkout instructions may describe unreleased commands; check the installed
CLI's help before invoking them and keep the Skill and program version matched.

Provider integrations are optional plugins. They may implement generation, but
must obey the core's single-submission attempt contract and remain free of private
paths, credentials, and host orchestration protocols.
