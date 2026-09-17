# Connected silhouette extraction 1.5

Producer-only opt-in policy for a single ordered row of independently connected
objects. Reuse the existing extraction policy fields:

```json
{"version":"1.5","mode":"foreground-gap-row","canvas_policy":"content-bounds",
 "target_padding":2,"max_internal_gap_ratio":0,"max_part_aspect_error":0.5,
 "separation_basis":"connected-silhouette"}
```

No proximity merging occurs. Each occupied horizontal interval must contain exactly
one 8-connected foreground region, with exact declared part count, order, row
alignment, aspect and clipping checks. Every cut must have two full-height columns
of verified key pixels. No fragments are deleted. Disconnected glyphs require a
different explicitly declared policy; this version does not infer semantic identity.

This removes unnecessary height-proportional spacing requirements for connected
objects. Touching objects and fragmented objects still fail. Image likeness remains
a separate review; ordinary color/texture differences do not establish extraction
failure.

Legacy policies and frozen requests remain unchanged. Existing raw output uses an
explicit digest-bound extraction revision and revised receive, preserved in sourced
handoff provenance. No new media is needed for deterministic revision. Human visual
acceptance remains false.
