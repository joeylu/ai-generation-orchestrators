# Provider plugin protocol

A provider plugin implements generation only. It does not own deterministic media
processing, validation, packaging, or the public attempt log.

## Inputs

The core passes a digest-verified plan containing public semantic inputs and a
plugin configuration reference. Secrets and host paths remain outside the plan.
The core passes a submission token that is unique to the consumed attempt.

## Required operations

- `doctor(config)`: read-only availability/capability report with redacted output.
  It returns top-level `status` as `ready` or `action_required`; provider-specific
  diagnostic fields remain inside that report.
- `submit_once(plan, config, submission_token)`: perform at most one provider job
  submission and return an opaque provider request identifier.
- `await_result(request_id, config)`: poll only the previously submitted request
  and return a fingerprinted local raw-video path or a typed terminal failure.

The adapter must never call `submit_once` from polling, recovery, timeout handling,
or error reconciliation.

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
