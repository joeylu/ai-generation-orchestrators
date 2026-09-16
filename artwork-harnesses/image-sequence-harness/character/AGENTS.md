# Character image sequence contract

- Work is restricted to this independent Harness. Do not modify sibling runtimes,
  repository-wide catalogs, global settings or other projects as part of its work.
- The only source layout is a square 4x4 board containing exactly 16 row-major
  poses for one character and one action. Generation layout and delivery size
  are separate. Never invent, duplicate or interpolate missing frames.
- Use cloud MCP for background removal. No local segmentation, chroma key,
  defringe, component recovery or silent grid-strategy switching is permitted.
- Agent understands intent and inspects original/reference and candidate images.
  Programs own plans, approvals, attempts, receipts, frame processing and delivery.
- The original reference may be opaque. Cloud-prepare it before generation unless
  it is an already-cut PNG/WebP with verified exterior transparency. Canonicalize
  existing cutouts to RGBA PNG with prepare-reference, without segmentation. Visually
  review either route, publish ai_reference_preparation_handoff_v1, then replan
  with original and foreground fingerprints. Do not import the video runtime.
- Whole-board cloud removal must preserve dimensions, every character instance,
  enclosed background holes and continuous alpha. Check geometry before spending
  on removal. Visually verify holes, materials and identity after removal.
- Reference-matte, generate and matte are separately authorized, single-use operations bound to
  the plan, exact inputs and private adapter configuration digest. Never create
  an authorization without explicit user compute approval. Task timeouts are
  indeterminate; inspect the recorded task receipt, never automatically resubmit.
- Semantic review is an explicit inspection of digest-bound artifacts. Never
  approve unseen frames. This is separate from compute approval.
- Deterministic processing is repeatable from immutable raw and matte evidence.
  Alpha is preserved; only RGB at alpha zero is zeroed. GIF is only a preview.
  Per-frame translation is forbidden unless the immutable plan explicitly selects
  `bottom_y` or `bottom_center`. Both modes must retain the unaligned frames, record
  every source anchor and `dx/dy`, fail rather than clip, and expose before/after
  review media. `bottom_y` must never introduce horizontal translation.
- A 16-entry pose blueprint and 16-entry positive timing weights may be bound into
  the immutable plan. Timing changes duration allocation only; it must never repair,
  reorder, duplicate or interpolate source poses.
- Tests use generated geometric fixtures or test doubles only, never real models,
  image generation, cloud services or GPU. Fixtures are not successful art examples.
- A configured adapter is not a verified production service. Keep model identity
  and MCP configuration private; do not claim any particular model is integrated
  or validated before a real, separately approved acceptance run.
