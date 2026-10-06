# Protected source backgrounds in fresh host jobs (preview)

Fresh `ai_ui_layers.host_delivery` configs can opt into an explicit background
region plan. This binds permitted edits before planning review and preserves
protected source pixels through material review and final packaging.

Supply `backgroundRegion` (an existing directory created by
`freeze-background-region`), `backgroundRegionDigest` (its exact digest), and
`backgroundPolicy: exact-source-canvas-protected-region-v1`. The source PNG must
match the authentic reference bytes. The visual plan must use `scene-only` and
`remove-business-text`, with exactly one full-canvas background using preserve
adaptation. Missing inputs, incompatible scope and partial/variant acquisition
are rejected. Existing jobs without this option keep their frozen behavior.

## Explicit scope and independent review

The binary edit mask and continuous blend mask are source-sized declarations.
They are not segmentation results; planning boxes do not define exact occlusion.
Permitted envelopes may include known background margins. Protected pixels are
not automatically certified to contain only background. The caller must prepare
source-based visual evidence that includes text, shadows, glow and soft edges.

Planning review receives the original, masks and deterministic tinted preview.
Required `backgroundRegionAudit` binds the region digest and background material
ID, confirms scope coverage, checks for obvious separately owned UI in protected
pixels, and confirms background ownership with evidence. False or missing
confirmation stops the new job. This review does not turn
`maskCoverageProven=false` into a segmentation certificate.

## Genuine proposal and deterministic candidate

The actual image request freezes the background prompt, reference, masks and
preview as ordinary visual attachments. They are supported reference-image
arguments, not an API inpainting mask. Generation remains an explicitly
authorized, serial native image call with no automatic retry.

The genuine returned PNG and receipt remain authoritative raw evidence. The
proposal must be opaque, exactly the source dimensions and have matching color
metadata. No resize, registration or color repair makes an incompatible proposal
acceptable. The program applies the frozen weights using the existing
[background region arithmetic](BACKGROUND-REGIONS.md), retains the raw proposal,
and creates a distinct candidate and report.
The host candidate is encoded as RGBA with alpha 255 everywhere to satisfy the
existing layer package contract; RGB pixels and color metadata remain unchanged.
This is a deterministic candidate encoding, not an edit to native raw bytes. The
standalone region application keeps its existing RGB default.

Material review inspects that candidate against the original, with the native
proposal and region preview as diagnostic attachments. Review must still find
seams, discontinuous textures, residual foreground/text and incorrect ownership.
Protected pixel identity alone is insufficient for visual acceptance.

Verification replays the entire application from source, raw proposal and masks,
compares all candidate/report bytes, and binds the reviewed candidate to
extraction and body delivery. Foreground observations retain their ordinary
per-layer requirements. The background uses identity adaptation on the exact
source canvas; its candidate bytes remain unchanged. Final packaging checks both
byte identity and every protected source pixel again.

The portable package proof records source/raw/candidate, mask and region/report
fingerprints, reviewed candidate lineage and the protected-pixel result. Private
host paths and job/submission fields stay outside it. No old failed job is
resumed, historical receipt reused, or visual success invented.

This integration has offline fixture coverage. A new actual proposal, material
review and final recomposition are still required to establish sample quality.
