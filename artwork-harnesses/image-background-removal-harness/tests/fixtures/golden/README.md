# Background-removal golden fixture provenance

These fixtures are minimal public reconstructions of observed preparation
failures. They contain no private source artwork, model weights, host paths, or
alpha ground truth.

- `reference-alpha-boundary-cases.json` covers meaningful existing alpha,
  edge-touching subjects, internal holes, and bounded publication failures.
- `reference-fusion-cases.json` covers an enclosed hole and a known auxiliary
  false negative over opaque subject material. The latter remains an explicit
  expected failure rather than being relabelled as success.
- `reference-jpeg-input-view-cases.json` covers actual-format detection, EXIF
  orientation, isolated compression speckles, and acknowledged fine-line loss.
- `reference-local-correction-cases.json` covers digest-approved bounded
  corrections, unchanged pixels outside the region, and tamper rejection.
- `reference-material-cases.json` and `reference-matte-cases.json` cover white
  clothing, pale hair, same-colour foreground, thin structures, foreground
  decontamination, and zero hidden RGB.
- `reference-translucency-cases.json` covers analytic continuous alpha and a
  negative case where omitted translucent material cannot be invented.

The matching tests use generated images, analytic masks, ONNX Runtime doubles,
and foreground-estimator doubles. They verify deterministic contracts only; they
do not run a real model or establish real-image segmentation accuracy. Visual
review remains required for every prepared reference.
