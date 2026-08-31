# Golden fixture provenance

`matte-cases.json` contains minimal public reconstructions of production failures:

- an enclosed key-colour island inside a wide ribbon loop, which must be removed
  globally rather than retained by edge-connected flood fill;
- frame-to-frame background colour drift, which must be calibrated per frame;
- wide key-colour blends at antialiased edges, which must produce soft alpha and
  then be decontaminated.

Provenance is `synthetic_reproduction`. The private v06 ribbon dancer, v07 loop,
and v08 one-shot samples located during the audit remain candidate evidence only;
they are not redistributable accepted goldens until foreground/background and
continuity labels are explicitly approved.

`tests/test_reference_preparation.py` adds generated white/multicolour artwork,
white foreground detail, soft mask coverage, JPEG orientation, invalid masks,
and a local ONNX runtime double. These verify ordinary-input routing, preserved
proportions/colour, no downloads/GPU, and source/report/foreground binding. They
do not claim to measure the actual segmenter's accuracy on real artwork.

`reference-matte-cases.json` and `reference-material-cases.json` preserve the
historical failure geometry, observed colours and old bad-mask values. The
current reference tests exercise the BiRefNet/foreground-estimator contract:
continuous mask alpha is not re-estimated, near-opaque white cloth is not eroded,
pale hair gaps and same-colour costume details are distinguished by model evidence,
noisy rabbit channels are not refilled, thin structures survive, and hidden RGB
is zero. Analytic foreground/alpha fixtures are independent of actual model output.

The old U²-Net connectivity/colour-recovery and point-guided algorithms are no
longer run. Their implementation-specific tests were replaced, while failure
fixtures and meaningful negative controls remain: a confidently wrong model mask
must not be hidden by deleting all whites or inventing recovered material.
Estimator doubles test the adapter, not PyMatting accuracy. Real acceptance
separately checks the same four source artworks against cached candidate cutouts.

`tests/test_segmentation.py` uses an ONNX runtime double for verified bytes,
CPU-only execution, telemetry/fallback disabled, input normalization, sigmoid,
floor quantization, shape/dtype, nonfinite/constant output, mutation and missing
setup. No actual model is imported or executed in these tests. Preparation tests
cover v4 source/cutout/foreground/report binding and read-only v1/v2/v3 compatibility.

`tests/test_reference_review.py` checks black/white/green/purple/checker rendering,
unchanged source alpha, no overwrites and CLI output for existing transparency.
A purple inspection composite does not prove segmentation quality on purple input;
synthetic coloured-input fixtures are a separate contract check.

`reference-translucency-cases.json` and `tests/test_reference_translucency.py`
provide analytic foreground, background and alpha for translucent cloth, an
isolated soft hair, opaque white material and an enclosed background hole.
Existing RGBA bypasses both segmentation and matting without changing its source
cutout. Estimator doubles verify continuous alpha and correct recompositing onto
black, white and purple; they do not establish real solver accuracy. A negative
control deliberately omits the cloth from the model mask: structural validation
still requires visual review and cannot claim that missing material is recovered.
Actual matting candidates must separately preserve this fixture's isolated soft
hair, which has no opaque foreground seed, at multiple resolutions. Passing the
adapter tests alone does not admit a candidate algorithm as the default.

`reference-fusion-cases.json` constructs an enclosed hole and an identical
auxiliary-mask false negative over an opaque badge. The hole should be reduced;
the badge should not, but remains an explicitly expected failing quality test.
Do not count it as a pass, silently remove it, or change the expected subject
preservation to make the quality gate green. Other controls cover existing
continuous alpha, open background, external fine hair and non-colour-based
handling of foreground. These synthetic masks do not measure model accuracy.
