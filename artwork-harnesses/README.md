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

The current `ai-frame-animation` Python distribution is a compatibility
implementation owned by the implemented
[character video-sequence Harness](video-sequence-harness/character/). The
background-removal Harness invokes its preparation subsystem without copying a
second source tree.
