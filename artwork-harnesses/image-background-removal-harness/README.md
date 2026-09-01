# Image background removal harness

**Status: implemented by the independent `ai-image-background-removal` CLI.**

This Harness accepts an ordinary still image, preserves meaningful source alpha
or runs explicitly configured local CPU segmentation, removes edge colour
contamination, fits the foreground, and produces reviewable transparent artwork.

Authoritative outputs are `cutout.png`, `foreground.png`, `preparation.json`, and
the transport-neutral `handoff.json`. Review composites and model masks are
diagnostic evidence.
The result always requires visual review; a structurally valid report is not an
automatic human quality approval.

Read [SKILL.md](SKILL.md) for the Agent workflow. Detailed public behavior remains
documented in [`docs/reference-preparation.md`](docs/reference-preparation.md)
and [`docs/reference-correction.md`](docs/reference-correction.md). The package
does not import the character-video runtime and may be installed or hosted on
its own. A future MCP adapter must materialize the same handoff bundle as the
local CLI; consumers never need to import this package.
