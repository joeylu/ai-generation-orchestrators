# Documentation

This project exposes one workflow: character reference plus motion request to a
validated transparent 2D sequence-frame delivery.

## Users and Agents

1. Install the package and run `ai-frame-animation doctor`.
2. Read the [Agent skill](../skills/artwork/skills-2d-frame-animation-video/SKILL.md).
3. Create a plan without compute using `ai-frame-animation plan`.
4. Confirm one generation attempt.
5. Run deterministic processing and `strict` validation.

## Maintainers

- [Architecture](architecture.md)
- [CLI and Agent flow](cli-and-agent-flow.md)
- [Quality policies](quality-policies.md)
- [Release consumption](release-consumption.md)
- [Security policy](../SECURITY.md)
- [Contributing and golden fixtures](../CONTRIBUTING.md)

Historical image-container routes, worker protocols, internal handoff packages,
and production deployment instructions are deliberately outside this public
documentation set.
