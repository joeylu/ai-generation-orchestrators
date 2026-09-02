# Provider plugin protocol

A provider plugin implements generation only. It does not own deterministic media
processing, validation, packaging, or the public attempt log.

## Inputs

The core passes a digest-verified plan containing public semantic inputs and a
provider binding. For new MiniMax H3 generation, that binding records a square
canvas plus workflow and semantic-binding SHA-256 values. Secrets, endpoints,
workflow paths, and host paths remain outside the plan.
The core passes a submission token that is unique to the consumed attempt.

## Required operations

- `doctor(config)`: read-only availability/capability report with redacted output.
  It returns top-level `status` as `ready` or `action_required`; provider-specific
  diagnostic fields remain inside that report.
- `plan_binding(config)`: return the host-neutral workflow/binding digests and
  square generation canvas that planning places inside the immutable plan.
- `submit_once(plan, config, submission_token)`: perform at most one provider job
  submission and return an opaque provider request identifier. Before upload it
  must compare the current binding to the plan and inject the bound dimensions
  into both the generation and reference-resize nodes.
- `await_result(request_id, config)`: poll only the previously submitted request
  and return a fingerprinted local raw-video path or a typed terminal failure.

The adapter must never call `submit_once` from polling, recovery, timeout handling,
or error reconciliation.

An adapter may additionally expose `preflight(plan)` for offline, plan-aware input
checks. `doctor --plan` requires this operation and verifies the plan/reference
binding before invoking it. No images are written and no network is contacted.
MiniMax H3 checks the prepared foreground/key compatibility and directly attached
KJ resize padding. It does not certify arbitrary consumer-owned graph transforms.
An unprepared opaque source routes to `prepare`; it is not an unsupported user
image. The provider repeats its internal ready-input check before upload, then
composites foreground alpha onto the key. It never owns segmentation or rewrites
the user's original. Local CPU reference preparation is a separate core stage
before planning; its report and image fingerprints are bound into the plan.

## Result contract

On success return the raw-video path, byte size, SHA-256, and provider-neutral
timing metadata if available. Do not copy private endpoints, credentials, model
paths, workflow paths, node graphs, or host orchestration state into public logs.

MiniMax H3 is an optional plugin that supplies this interface from consumer-owned
configuration. The core contains no bundled private workflow or model binding.

## Predecoded processing handoff

A deterministic adapter that already owns media probing and decoding may write
`ai_frame_animation_decoded_handoff_v1` and pass it to `process
--decoded-handoff`. It must bind the same raw source, one probe JSON artifact,
one exact lossless-PNG directory inventory, every artifact fingerprint, and the
probe/decode tool evidence. It must not include provider requests, attempts,
authorization, endpoints, credentials, host paths, or transport state.

The adapter creates the handoff mechanically. An Agent must never assemble it by
hand. Processing rejects the entire handoff before output creation if any path,
inventory entry, digest, or raw-source binding is invalid.
