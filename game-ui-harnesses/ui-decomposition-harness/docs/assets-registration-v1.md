# Measured internal registration v1

This is an opt-in precise-registration diagnostic/gate, not the general visual
acceptance policy for approximate PNG decomposition. Ordinary visual review checks
coherent relative layout, alignment with separately placed artwork, missing parts
and redesign. A 2px failure alone does not establish visual unusability. Existing
failures remain immutable; this command's threshold and explicit finalize gate
are unchanged. No visual approval is inferred from omitting the option.

`ai-ui-assets registration-check --run-dir RUN --specification measured.json --output FRESH.json`
checks caller-measured internal landmarks after processing, without generation or
pixel changes. Blocked reports exit 2; existing outputs cannot be overwritten.
`finalize --run-dir RUN --output FRESH --draft --registration measured.json`
recomputes this gate before assembly. Failure creates no output directory.
Legacy finalization without this explicit option is unchanged. One spec covers
one node; it does not establish whole-package registration.

Specification exact fields:
- kind: ui_assets_registration_v1
- planDigest, materialsDigest: actual frozen plan and processed-material digests
- referenceSha256: batch source_sha256 (normalized input/reference.png)
- materialSha256: selected processed material SHA-256
- node: placed node id
- basis: nonempty reviewed measurement description
- landmarks: 3–128 unique entries with id, reference:[x,y,w,h], observed:[x,y,w,h]

Reference rectangles use original canvas coordinates. Observed rectangles use
processed material local coordinates; node placement is added exactly once.
Finite nonnegative in-bounds coordinates and positive extents are required.
observed:null is unknown and blocks. Changed hashes or plans block. The normalized
reference may have different bytes from the original, whose identity stays bound
by the plan. No successful receipt is authored by the caller.

Fixed tolerance is 2 pixels per corresponding edge. No caller tolerance override.
The report classifies aligned, unknown-landmarks, uniform-transform-candidate or
internal-layout-drift. Least-squares isotropic scale plus translation is diagnostic;
even a candidate remains blocked at the current placement. No unequal-axis scale,
shear, warp, icon relocation or automatic repair occurs. A candidate requires full
artwork review and the separate existing transformation contract before use.

Caller-selected sample strips are not complete object outlines. Inspect landmark
coverage across the panel, including outer ornaments and intermediate boundaries;
the program cannot infer missing landmarks, recognize arbitrary rows or prove
measurement honesty. A failed isotropic fit does not establish all possible repairs
are impossible; a passed sample does not establish full visual acceptance. Keep
measurement overlays separate from authoritative image inputs and deliveries.
