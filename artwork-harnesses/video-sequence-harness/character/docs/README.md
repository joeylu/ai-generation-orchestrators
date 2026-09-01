# Documentation

This project exposes one workflow: character reference plus motion request to a
validated transparent 2D sequence-frame delivery.

## Start here

中文用户可先看[中文快速入门](../../../../README.zh-CN.md)，选择已有视频后处理或本地生成。

1. Follow the root [Quick Start](../../../../README.md#first-successful-path).
2. Read [Installation](installation.md) for the wheel, FFmpeg, Skill, and provider
   layers.
3. Read [Agent setup](agent-setup.md) for repository-local and installed Skill
   usage.
4. Use the [CLI and Agent flow](cli-and-agent-flow.md) when diagnosing individual
   stages.
5. Read [Agent intent and deterministic compiler](intent-and-compiler.md) when an
   Agent or external LLM should produce structured motion semantics.
6. Read [Quality policies](quality-policies.md) before choosing `best_effort`.
7. Read the [neutral preparation handoff](../references/reference-preparation-handoff.md)
   before connecting a local CLI or MCP producer.
8. In a repository checkout, the separate [background-removal Harness](../../../image-background-removal-harness/)
   documents its CPU segmentation, correction, and visual acceptance workflow.

## Maintainers

- [Architecture](architecture.md)
- [Agent intent and deterministic compiler](intent-and-compiler.md)
- [Immutable release consumption](release-consumption.md)
- [Security policy](../../../../.github/SECURITY.md)
- [Contributing and golden fixtures](../../../../.github/CONTRIBUTING.md)

Historical image-container routes, worker protocols, internal handoff packages,
and production deployment instructions are deliberately outside this public
documentation set.
