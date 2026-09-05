# Offline processing contracts

These changes are prepared for video 0.8.0. Consumers must wait for a tagged,
digest-verified release before upgrading production installations.

The update adds native Alpha processing, optional v2 dual-source handoffs,
bounded disk-backed processing with opt-in frame checkpoints, stricter GIF
sequence validation, rational observed-time sampling and optional plan-bound
provider capability evidence. Existing v1 handoffs and plugins without capability
descriptions remain supported. Source media and generated private run artifacts
are not included in the release.

## Alpha and visual validation

`delivery.alpha_mode` accepts `auto` (the compatible default) or `native`, and is
bound to the plan digest. `auto` keys opaque frames but preserves visible RGB on
frames already containing Alpha. Both routes clear RGB where Alpha is zero.
`native` rejects opaque decoded frames instead of attempting color-key recovery.
Empty subjects and all existing strict transparency/subject-fit gates still fail.
Native VP9 input uses the explicit Alpha-capable `libvpx-vp9` decoder; other native
codecs use the configured FFmpeg decoder and are subject to the same pixel checks.

GIF remains a derived preview: every PNG pixel with Alpha below 255 maps to the
transparent palette index. Validation compares the quantized PNG visual sequence
with the decoded GIF, permitting only lossless consecutive identical-frame
coalescing. Every visual-run boundary must match cumulative rational-to-centisecond
quantization. Reordered, dropped, substituted frames and offsetting timing errors
are rejected. No production compatibility timing window is enabled.

## Rational source time

An absent frame inventory may use rational FPS; a supplied but incomplete,
non-monotonic or malformed frame inventory is an error. Observed duration uses a
positive final-frame duration, then a plausible stream/container duration, then
the observed interval median. A missing FPS can be derived from the observed
span. Integer frame PTS and duration multiplied by stream `time_base` take
precedence over decimal ffprobe text. When both are present, decimal evidence
must agree within its ffprobe half-microsecond rounding precision. Invalid ticks
or contradictory evidence fail validation. All arithmetic remains rational,
including nonzero timestamp origins.

Atlas profiles remain capacities. Native frames are retained when they fit.
Over-capacity VFR intervals use elapsed-time targets with strictly increasing
native indices; samples never duplicate or interpolate frames. One-shot output
includes the terminal pose; loops use a half-open semantic interval. CFR selection
retains its previous rounding, allowing ffprobe microsecond representation error.

## Memory and optional resume

The processor checks decoded headers before loading pixels. Limits are 16,777,216
pixels per frame, 268,435,456 pixels per sequence and 10,000 source frames. The
internal decode route checks the probe before invoking FFmpeg. Fitted intermediate
frames are also subject to the sequence pixel budget. Raw, prepared and fitted
frames are read on demand from disk; temporary intermediate images never enter
the delivery manifest or ZIP. Analysis/fit still considers the entire semantic
interval so geometry is independent of requested atlas capacities.

With a verified decoded handoff, opt into a workspace-local cache:

```console
ai-frame-animation process --root . --plan plan.json --raw-video raw.mp4 --decoded-handoff decoded-handoff.json --checkpoint-dir .ai-frame-animation/checkpoints --out-dir delivery
```

Only completed pre-fit RGBA frames and their evidence are cached. Bindings include
the original raw digest, complete plan, handoff, probe, decoded fingerprints,
runtime implementation digest, Python/Pillow/NumPy versions and key. Missing or corrupted records are misses;
links and overlap with delivery directories are rejected. Resume recomputes shared
geometry and packaging, reruns independent validation and publishes atomically.
It does not resume or submit any provider request, reuse generation authorization,
or publish partial deliveries. This cache does not avoid the handoff's artifact
verification, nor does it cache the original probe/decode operation.

## Transparent-video producer handoff

`ai_frame_animation_decoded_handoff_v1` remains compatible. The optional v2 document
adds `foreground_source` and `source_probe` to the existing schema:

- `raw_source` always identifies the original video, never its replacement.
- `foreground_source` identifies the already-materialized transparent video.
- `source_probe` provides one original-video probe artifact and tool evidence.
- Existing `probe` and `decode` describe the foreground video and its single decode.

The v2 producer must supply width/height and complete rational frame timestamps
for both probes. Dimensions and frame count must match exactly. Relative timestamps
and observed duration must either match exactly or satisfy the tick mapping below.
Decoded foreground
PNGs must be RGBA and match the declared geometry. A v2 handoff requires a `native`
Alpha plan. The delivery signs both source identities and probe fingerprints;
independent validation rechecks them. Retain original/foreground videos and both
probe artifacts in the workspace for validation.

For container quantization, both probes must carry integer `pts` or
`best_effort_timestamp`, a positive `time_base`, and integer final-frame `duration`
or `pkt_duration`. The foreground tick must be at most 1 ms and no more than half
the shortest source-frame interval. After subtracting each stream's timestamp
origin, every foreground PTS must equal the original PTS rounded to the nearest
foreground tick (ties upward). The final packet duration must equal the original
final duration truncated or rounded to that tick. This is an exact mapping, not
a tolerance window: an extra tick, a missing frame or a changed terminal hold is
rejected. Timing changes below the destination clock resolution cannot be
distinguished by timestamp evidence. Decimal-only probes retain exact matching.

Delivery sampling, duration and FPS use the original probe's rational timeline;
the foreground probe remains decode evidence. Independent package validation
recomputes both the mapping and the original timeline. Offline real-pair checks
cover 107- and 124-frame 24fps sources mapped to millisecond clocks; synthetic
delivery tests cover both loop and one-shot output. These checks do not replace
end-to-end acceptance of a production adapter's mechanically generated handoff.

### Consumer upgrade acceptance

A consumer using a private processing fork cannot upgrade by substituting the
public executable alone. Verify the complete adapter boundary before switching:

1. Probe commands must request integer frame timestamps/durations and stream
   `time_base`; the neutral projection must retain them and width/height. Keep
   original and foreground probe artifacts separately, without transport fields.
2. The deterministic producer must emit v2 for dual-source Alpha processing,
   binding `raw_source` to the original and `foreground_source` to the transparent
   input. Decode the foreground once. Do not relabel a v1 foreground-only handoff.
3. Compile a fresh public plan with `alpha_mode=native`. Private mode names,
   command flags, status values and output layouts are not public API aliases.
   Update the consumer's invocation and packaging translation against the public
   CLI; retain generation authorization and private bindings outside the core.
4. Install an immutable tagged public release by digest. Invalidate cached plans,
   handoffs and processed deliveries when producer/schema/package bindings change.
   A dependency lock update must not preserve a second copied processing tree.
5. With existing local media, run the producer, public `process` and independent
   `validate`. Check both original/foreground fingerprints, the original rational
   timeline, each requested atlas and required GIF/ZIP, and corrupted-artifact
   rejection. Validate the consumer's final exported package as well as the core
   delivery. A probe-only check is not an end-to-end acceptance result.

Only the deterministic external producer authors this handoff. The core consumes
local verified artifacts and does not call or authorize a background-removal
service. External compute needs its own explicit authorization; it is not covered
by offline process retries. Provider URLs, transport state and credentials are
forbidden in the public handoff.

## Optional provider capabilities

A plugin may expose an offline `capabilities()` method following
`provider-capabilities.schema.json`. `plan --provider-config` captures that
description inside the immutable plan; `run` compares the current description
before submission. Identity, adapter version, accepted input roles/formats and
retry/cancellation declarations cannot drift silently. Existing plugins without
this method remain compatible.

The built-in adapter advertises only its implemented single PNG reference input,
local cancellation, no durable resume and no idempotent resubmission. Other
capability fields can describe first/last roles, but the public generation CLI
still accepts only a single prepared reference. Capability declarations alone
never enable another input mode, automatic retries or a provider fallback.
