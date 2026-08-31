# Delivery quality policies

## Reference preparation is not an upload-format restriction

Ordinary artwork may be opaque or have a complex background. `prepare` separates
foreground locally before planning. Source unreadability/insufficient detail,
missing segmentation setup and an unreliable output mask are different issues.
Neither policy requires a transparent source PNG or deletes all white pixels.
An empty/unseparated prepared foreground is blocked; edge contact, low resolution
and uncertain soft coverage are reported for review. A passed structural check
does not establish semantic segmentation quality or identify the intended person
in a multi-subject image. See [reference preparation](reference-preparation.md).

Optional [local correction](reference-correction.md) requires preview approval
and produces a new preparation; neither that approval nor a valid report makes
the entire matte acceptable. It does not weaken either delivery policy or repair
omitted material. The [reference acceptance matrix](reference-acceptance.md)
separates synthetic contract tests, observed real-image limitations, and the
explicitly corrected revision from its unchanged default baseline.

## Strict (default)

Every requested frame-count variant and required artifact must exist and pass:

- raw-source identity and checksum binding;
- rational timeline and continuity validation;
- requested dimensions, frame count, and row-major atlas layout;
- meaningful PNG transparency, zero hidden RGB, and matte/spill limits;
- manifest, artifact checksum, and package-structure validation.

Missing alpha, opaque fallback, a mismatched raw source, or a generation-attempt
integrity failure is always fatal.
For predecoded input, a handoff digest mismatch, path escape, symlink, missing or
extra frame, or artifact fingerprint mismatch is also fatal under both policies.

## Best effort (explicit)

Best effort may deliver independently valid variants when another requested
variant fails, and may omit an optional GIF preview. It still enforces every hard
strict invariant for artifacts it delivers. The manifest records omissions and
warnings; it must never rename failure as success.

## Artifact authority

PNG frames are authoritative for continuous alpha. Atlas PNGs preserve that alpha.
GIF preview uses binary transparency for compatibility and cannot be used to judge
soft alpha quality.
