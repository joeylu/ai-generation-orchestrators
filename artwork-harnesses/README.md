# Artwork harnesses

Agent-facing harnesses for creating and preparing game artwork. Each harness owns
its user workflow, inputs, outputs, examples, and acceptance rules. A planned
harness exposes documentation only; it must not publish a `SKILL.md` or claim to
be callable.

| Harness | Status | Purpose |
| --- | --- | --- |
| [Image generation](image-generation-harness/) | Planned | Create one character or prop reference image. |
| [Image background removal](image-background-removal-harness/) | Implemented | Turn an ordinary still image into reviewed transparent artwork. |
| [Image sequence](image-sequence-harness/) | Planned | Generate an animation directly as a coherent image sequence. |
| [Video sequence](video-sequence-harness/) | Character implemented | Generate or accept a video and deliver transparent frame animation. |

The implemented Harnesses are independently installable:

- `ai-image-background-removal` owns still-image segmentation, review, and
  correction.
- `ai-frame-animation` owns video planning, attempts, deterministic processing,
  validation, and delivery.

They interoperate only through `ai_reference_preparation_handoff_v1`. The video
Harness may instead consume an equivalent handoff materialized by an MCP service;
neither Python package imports the other.
