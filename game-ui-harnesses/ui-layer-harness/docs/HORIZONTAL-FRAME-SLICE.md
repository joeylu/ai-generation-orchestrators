# Explicit horizontal frame-slice adaptation

`horizontal-frame-slice` is an opt-in deterministic size adaptation for wide
card or panel frames with protected end ornaments and a stretchable plain
middle. M1 may propose it only with the user's permission; M2 must check the
visual eligibility before M3 freezes the plan. The default remains `preserve`.
It is not a way to repair missing or distorted decorations, wrong material
ownership, text ghosts, or a clipped source.

The frozen material must be foreground, own exactly one `card` or `panel`
frame object (plus optional bounded decorations wholly within an end band),
retain no lettering, and have target width/height at least 3. Its
center may contain parchment, straight borders or similarly stretchable
texture. Integrated icons, portraits, buttons, center ornaments or other
fixed geometry make it ineligible. The program checks the structural and
numeric conditions; M2 and the post-generation visual review check the
semantic ones. An uncertain case stays `preserve`.

The adapter verifies the raw PNG fingerprint, EXIF orientation, native alpha
and complete contour, clears only alpha 0/1 noise, and keeps fainter alpha
pixels during resampling. It measures the visible contour at alpha >= 8 so
near-invisible fringe does not distort geometry, then scales uniformly to
target height. End bands each one third of target height wide
are left at uniform scale; only the middle band is resized horizontally to
target width. A middle scale outside 0.8–1.25 or an excessive stitch jump
stops processing. The output retains transparent margin and records raw,
prepared and derived hashes, source box, scales, slice width and seam
measurements. It never draws UI content or changes a provider receipt.

For a single generated material, the frozen DAG adapts after `raw_complete`.
For a grouped sheet, it first verifies and splits the received sheet, derives
eligible cells, and presents a new fingerprinted sheet of the derived cells
to the existing read-only identity/visual review. Other cells remain unchanged.
That review must pass before any extracted material enters registration. Its
response and the original raw sheet remain separate evidence; a previous
failed review is never rewritten or promoted. Technical processing remains
`pending_visual_review`, and the user decides whether to accept the full UI.

The public CLI, DAG node names, state meanings and `ui_layer_composition_v1`
are unchanged. Shared planning-schema consumers must add the optional enum
value before receiving a new plan with this policy. Existing frozen jobs stay
immutable and cannot resume under a changed runtime fingerprint. Consumers
that read only the final composition package need no schema migration;
Docker/Web hosts that parse planning snapshots must update that parser and
surface adaptation evidence. This repository does not implement Docker/Web
changes or publish a tag for this experimental addition.
