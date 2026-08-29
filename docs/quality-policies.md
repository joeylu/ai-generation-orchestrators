# Delivery quality policies

## Strict (default)

Every requested frame-count variant and required artifact must exist and pass:

- raw-source identity and checksum binding;
- rational timeline and continuity validation;
- requested dimensions, frame count, and row-major atlas layout;
- meaningful PNG transparency, zero hidden RGB, and matte/spill limits;
- manifest, artifact checksum, and package-structure validation.

Missing alpha, opaque fallback, a mismatched raw source, or a generation-attempt
integrity failure is always fatal.

## Best effort (explicit)

Best effort may deliver independently valid variants when another requested
variant fails, and may omit an optional GIF preview. It still enforces every hard
strict invariant for artifacts it delivers. The manifest records omissions and
warnings; it must never rename failure as success.

## Artifact authority

PNG frames are authoritative for continuous alpha. Atlas PNGs preserve that alpha.
GIF preview uses binary transparency for compatibility and cannot be used to judge
soft alpha quality.
