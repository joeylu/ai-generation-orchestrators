# Image background removal harness

**Status: implemented by the current `ai-frame-animation` compatibility CLI.**

This Harness accepts an ordinary still image, preserves meaningful source alpha
or runs explicitly configured local CPU segmentation, removes edge colour
contamination, fits the foreground, and produces reviewable transparent artwork.

Authoritative outputs are `cutout.png`, `foreground.png`, and
`preparation.json`. Review composites and model masks are diagnostic evidence.
The result always requires visual review; a structurally valid report is not an
automatic human quality approval.

Read [SKILL.md](SKILL.md) for the Agent workflow. Detailed public behavior remains
documented in [`docs/reference-preparation.md`](docs/reference-preparation.md)
and [`docs/reference-correction.md`](docs/reference-correction.md) while the
compatibility CLI source remains single-owned by the
[character video-sequence Harness](../video-sequence-harness/character/src/ai_frame_animation/).
