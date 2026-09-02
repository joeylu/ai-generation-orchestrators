# Delivery quality policies

## Reference preparation is not an upload-format restriction

Ordinary artwork may be opaque or have a complex background. `prepare` separates
foreground locally before planning. Source unreadability/insufficient detail,
missing segmentation setup and an unreliable output mask are different issues.
Neither policy requires a transparent source PNG or deletes all white pixels.
An empty/unseparated prepared foreground is blocked; edge contact, low resolution
and uncertain soft coverage are reported for review. A passed structural check
does not establish semantic segmentation quality or identify the intended person
in a multi-subject image. See [reference preparation](../../../image-background-removal-harness/docs/reference-preparation.md).

Optional [local correction](../../../image-background-removal-harness/docs/reference-correction.md) requires preview approval
and produces a new preparation; neither that approval nor a valid report makes
the entire matte acceptable. It does not weaken either delivery policy or repair
omitted material. The [reference acceptance matrix](../../../image-background-removal-harness/docs/reference-acceptance.md)
separates synthetic contract tests, observed real-image limitations, and the
explicitly corrected revision from its unchanged default baseline.

## Strict (default)

Every requested atlas-profile variant and required artifact must exist and pass:

- raw-source identity and checksum binding;
- rational timeline and continuity validation;
- requested dimensions, natural frame inventory, capacity, transparent unused
  cells, and row-major atlas layout;
- meaningful PNG transparency, zero hidden RGB, and matte/spill limits;
- manifest, artifact checksum, and package-structure validation.

Saturated-key cleanup remains conservative for an unverified key. When the
immutable plan records that the selected key family is safe for the reference,
the processor may neutralize same-family RGB contamination embedded by video
chroma subsampling, including cyan/yellow partner hues. This does not lower or
erase subject alpha; enclosed-background removal remains a separate matte step.

A provider may preserve the declared key's channel family while changing its
brightness across frames or across the canvas. A spatially complex border is
eligible for per-frame key-family recovery only when every selected opaque frame
keeps at least 95% of its four-pixel border in the declared dominant-channel
family. The report records the minimum ratio and the explicit
`per_frame_key_family_drift` route. Falling below that threshold remains
`background_unkeyable`; strict and best-effort do not turn an arbitrary scene
into a keyed background. Small foreground effects touching the border may be
preserved within the remaining allowance. This rule is covered by both a
positive luminance-drift fixture and a genuinely mixed-border negative fixture.

After keying at source resolution, all source frames in the semantic interval
share one contact-anchor alignment and subject-union fit. Empty background
padding is cropped before resizing, so a wide video canvas cannot silently
reduce a tall character to a tiny sprite. The square output reserves 8% per-side
margin (rounded up) plus transparent resampling support. Bounds retain every
nonzero-alpha pixel, including soft or disconnected details; this step does not
remove edge noise or invent detail when enlargement is needed.

4x4/8x4/8x8 variants share one deterministic semantic interval and fitted source
frames: scale and placement do not depend on which profiles were requested. An
interval that fits is not padded with duplicate frames; unused atlas cells remain
transparent. An over-capacity interval is uniformly downsampled. Loop selection
uses a half-open boundary; one-shot selection includes the terminal pose. No
individual pose is resized independently. A shared empty/unseparated source frame
blocks the common envelope under both policies, even if a sparse variant would
not select that frame.
Independent export/GIF failures still use the selected quality policy.

Variant `processing.subject_fit` records source dimensions/count, aligned union,
crop, shared resize, offset and margin. Alignment report v2 translations are in
**source pixels before the shared fit**, explicitly recorded as
`source_pixels_before_shared_fit`; v1 reports used output-canvas pixels. New
deliveries must agree on fit evidence across variants, and validation checks the
actual PNG margins. Historical v1 deliveries without fit evidence remain readable;
their earlier structural pass does not certify the new subject-occupancy behavior.
Unresolved `translated_subject_may_clip` evidence is fatal under strict policy.
Validation runs on the staging directory before publication of a delivery/ZIP.

Empty alpha and broad near-opaque bands spanning opposite canvas edges are
rejected under both policies. The latter conservatively detects retained canvas
panels or a subject extending across the frame; it never erases white pixels to
make a result pass. These checks are not arbitrary-background segmentation and
cannot certify character fidelity, all matte defects, or a natural loop.

Missing alpha, opaque fallback, a mismatched raw source, or a generation-attempt
integrity failure is always fatal.
For predecoded input, a handoff digest mismatch, path escape, symlink, missing or
extra frame, or artifact fingerprint mismatch is also fatal under both policies.

## Best effort (explicit)

Best effort may deliver independently valid variants when another requested
variant fails, and may omit an optional GIF preview. It still enforces every hard
strict invariant for artifacts it delivers. The manifest records omissions and
warnings; it must never rename failure as success.

Background/empty-frame checks still apply before padding or alignment can hide
the original problem. Strict clipping failures cannot be silently downgraded;
best effort must already be selected in the plan.

## Artifact authority

PNG frames are authoritative for continuous alpha. Atlas PNGs preserve that alpha.
GIF preview uses binary transparency for compatibility and cannot be used to judge
soft alpha quality.

GIF timing is quantized to 10-ms units using cumulative rational frame
boundaries, so fractional FPS does not accumulate a speed error. Validation
compares the total to the original delivery timeline with a 10-ms tolerance;
identical frames may be coalesced with their duration retained. Timing that would
require zero-length or out-of-range GIF delays is rejected, not silently clamped.
An optional unrepresentable GIF may be omitted only under explicit best effort.
PNG timestamps and playback FPS remain rational and are never quantized to GIF.

Enclosed key-colour holes are removed per frame, but a non-key white island
cannot be semantically distinguished from white costume detail by keying alone.
Passing the package/alpha checks does not replace visual review of such defects.
