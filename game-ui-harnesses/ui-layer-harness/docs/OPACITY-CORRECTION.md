# Explicit whole-layer opacity correction

Use when the user chooses to fade an existing independent layer, including its
border, glow and owned decoration. This is deterministic postprocessing, not
image generation, segmentation, background removal or recovery of true alpha
from a screenshot. Do not infer the factor from a material name or apply it to
every panel automatically. Correct an independent layer, not the assembled scene.

```text
python game-ui-harnesses/ui-layer-harness/ui_layer.py adjust-opacity --source LAYER.png --source-sha256 SHA256 --opacity 0.5 --reason "User selected 50% whole-layer opacity" --output NEW_DIRECTORY
```

The factor is finite and greater than zero, at most one. It multiplies existing
alpha; 0.5 does not set every pixel to alpha 128. Rounding is half up. RGB stays
unchanged wherever output alpha is nonzero; fully transparent pixels have zero
RGB. There is no crop, resize, positional change, selective edge treatment or
new artwork. An all-empty result is rejected. The source must be an oriented
PNG with an alpha channel and match the supplied SHA-256.

Outputs are `raw.png` (original bytes), `corrected.png`, and `result.json` with
input/output hashes, factor, reason, dimensions and timing. Output must be new;
the command never overwrites an earlier result or calls a model. Status is
`corrected_pending_visual_review`. The source digest binds the immediate input,
not its provider provenance: retain upstream receipt/extraction/placement
evidence when this input is derived from generated media.

Compare the corrected layer over its intended background. Fade affects fine
lines and decorations too; it cannot fix ownership, missing artwork, text
spacing or progress values. Keep those findings and the original failed review.
The command does not resume or promote a failed DAG, accept a composite, or
automatically insert a correction into accepted-material replay. That replay
currently has no opacity-operation support: future delivery adoption must bind
and reproduce this correction rather than treating corrected pixels as raw.

CLI addition is optional. Existing actions/status and `ui_layer_composition_v1`
are unchanged. Corrected PNG pixels carry the effect, so no new runtime opacity
field is needed by Pixi or Docker/Web consumers. Hosts choosing this operation
must retain its evidence and use a fresh directory. No Docker/Web development
or release is included.
