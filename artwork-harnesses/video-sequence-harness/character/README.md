# Character video sequence

**Status: implemented.** Read [SKILL.md](SKILL.md) for the canonical Agent entry
point. It accepts an existing character video or one explicitly authorized new
video-generation attempt and produces validated transparent frame delivery.

The installable compatibility implementation lives under
[`src/ai_frame_animation`](src/ai_frame_animation/). Its Python import name and
CLI remain `ai_frame_animation` and `ai-frame-animation`.

This package does not implement still-image background removal. It accepts a
meaningful transparent reference directly, or consumes a reviewed
`ai_reference_preparation_handoff_v1` produced by an optional local CLI or MCP
service. Legacy `preparation.json` input remains temporarily readable.

An optional provider-neutral Agent Intent layer is available through `intent
build`, `intent validate`, and `compile`. It binds untrusted semantic decisions
to verified reference evidence before the existing `plan` stage. Direct
`job.json -> plan` integrations remain supported. See
[Agent intent and deterministic compiler](docs/intent-and-compiler.md).
