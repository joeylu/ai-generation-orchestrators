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
5. Read [Quality policies](quality-policies.md) before choosing `best_effort`.
6. Read [Reference preparation](../../../image-background-removal-harness/docs/reference-preparation.md)
   for ordinary artwork, optional CPU segmentation and source-versus-mask quality diagnostics.
7. Use [Local reference correction](../../../image-background-removal-harness/docs/reference-correction.md) only for an identified
   residual-background patch: preview first, apply after explicit approval.
8. Read [Reference acceptance](../../../image-background-removal-harness/docs/reference-acceptance.md) for the fixed seen-regression
   matrix, historical failures and the limits of structural validation.

## Maintainers

- [Architecture](architecture.md)
- [Immutable release consumption](release-consumption.md)
- [Security policy](../../../../.github/SECURITY.md)
- [Contributing and golden fixtures](../../../../.github/CONTRIBUTING.md)

Historical image-container routes, worker protocols, internal handoff packages,
and production deployment instructions are deliberately outside this public
documentation set.
