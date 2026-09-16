---
name: character-image-sequence
description: Generate and deliver one character action as a fixed 4x4, 16-frame image sequence using cloud image generation and cloud MCP background removal, or process existing source boards with verified cloud matte evidence.
---

# Character image sequence

Use this independent Harness for image-derived character animation. Read
[the CLI workflow](../../docs/cli.md) before the first run. Source requirements and
exact wire semantics are in [contracts](../../docs/contracts.md).

Translate the user's action into four ordered motion phases, explicit duration,
loop or one-shot intent, canonical processing-board size and delivery frame size. Preserve
character identity and intended airborne motion. Use one reference image and one
action; layout is always 4x4 with 16 row-major poses. Inspect the reference before
planning; opaque reference art is valid and must first use cloud `reference-matte`.
An already-cut PNG/WebP can reuse its foreground after exterior-alpha checks and
visual review. An alpha channel alone is insufficient.
Use `prepare-reference` to normalize an existing cutout to RGBA PNG without a
cloud call; it cannot remove the background from an opaque input.

The first `plan` is a preparation draft. Review the prepared reference using
`review --stage reference`, then call `plan` again. The program writes the neutral
`ai_reference_preparation_handoff_v1` and binds original, foreground and review
fingerprints into the new formal plan. Only that formal plan can generate a board.
The emitted handoff path may be placed in a later request as
`reference_preparation_handoff` to reuse the same reviewed foreground for another
motion without repeating reference matte compute or reference review.
Do not manually author the preparation report or handoff, and do not submit the
opaque original to generation after preparing a foreground.

Use the deterministic CLI for plans, authorizations, cloud calls, reviews, source
receipts, slicing and delivery. Never write or fix runtime evidence by hand.
`plan` produces a digest-bound request without compute. Inspect the compiled plan
before asking for compute approval. Only run `authorize --confirm` after explicit
user approval for that exact operation. Reference removal, generation and board removal have separate
single-use authorizations; review approval is not compute authorization.

Cloud configuration lives only in the task's ignored private directory. Keys are
provided through an environment variable. Do not copy actual endpoints, secrets
or user-home paths into the Harness source. The image service selects its model
server-side; never claim the client selected or verified a particular model.

Run `probe` when a live, non-business tool/schema preflight is useful. After
`submit`, accept an immediate terminal result or, when queued/running, wait the
returned delay and use only `poll` on that attempt.
Queries can be repeated; business submissions cannot be automatically replayed.
An indeterminate attempt needs a new user decision. A known queued/running task
must not be replaced with a new generation. Do not call administrative/key APIs.

Inspect the raw board and all 16 cells before approving raw review. Cloud generation
may return any square pixel size. Cloud matte must preserve that actual full board
size and every character instance. `process` normalizes the whole square board once
to the canonical plan size before fixed slicing. After `process`, inspect the light,
dark and checker review sheets, individual PNGs, enclosed holes, soft materials and
the animation preview.
If the request explicitly selects `alignment_mode: bottom_y` or `bottom_center`, the
deterministic processor retains every unaligned frame, records the detected anchors
and integer translations, and fails instead of clipping. `bottom_y` changes only Y;
`bottom_center` changes both X and Y. For an already-transparent reviewed raw
board, `preview-align` may create a private before/after preview before matte compute;
never present that preview as a validated delivery.
Recommend `bottom_y` with transparent safety padding for standing idle, planted
casting and stationary attacks. Recommend `bottom_center` only when the horizontal
contact point must also be fixed. Keep `none` for jump, fall, knockback, hovering and any motion whose vertical
travel is intentional. For walk or run, show the preview first: alignment may improve
foot stability but can also remove intentional body bob. Never infer approval of the
aligned candidate from approval of the raw board.
Record all actual review criteria through `review`; do not approve unseen output
or treat passing alpha metrics as semantic success.

For locomotion or other mechanically sensitive actions, prefer an explicit
16-entry `pose_blueprint` over broad phase prose. Use optional 16-entry positive
integer `timing_weights` to shape holds and transitions while preserving the total
duration. Never use timing to hide a broken pose order or missing frame.

Do not repair missing poses, local matte defects or cross-cell contamination with
ad hoc image edits. Report the blocking gate. There is no local segmentation,
defringe, frame duplication/interpolation or alternate layout strategy.

Deliver only after candidate review and successful package validation. Explain
any warning about upscaling or repeated poses. Link the validated PNG/atlas package
and preview; distinguish real cloud acceptance from offline test-double coverage.
