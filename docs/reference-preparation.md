# Ordinary reference artwork to generation-ready input

Users supply ordinary character artwork, not a hand-prepared transparent PNG.
White/coloured backgrounds and complex scenes enter the same `prepare` route.
The program preserves the original and does not redraw missing character parts.

```text
original -> existing alpha OR BiRefNet General CPU -> foreground-colour estimation
         -> cutout.png -> proportional canvas fit -> foreground.png + review
         -> plan -> one video-compute confirmation -> run -> process -> validate
```

## Explicit local setup

Already-transparent artwork needs only the core package. Opaque artwork uses
the optional `segmentation` extra: ONNX Runtime CPU and PyMatting 1.1.15.
Install it from the exact verified release wheel only after setup authorization:

```powershell
python -m pip install ".\ai_frame_animation-<version>-py3-none-any.whl[segmentation]"
```

The core does not depend on rembg, its CLI, Web packages or GPU extras.
Core Python support remains >=3.10; optional availability depends on compatible
ONNX Runtime/Numba/SciPy wheels for the selected Python and platform.
The dependency extra contains no weights and never downloads a model on import.

Provision the **BiRefNet General 1024 ONNX** graph separately from a trusted
source, check its license, and verify its SHA-256 against a trusted provisioning
record. The accepted full graph is roughly 973 MB; allow additional CPU RAM for
loading/inference. Do not invent a digest or treat a hash computed after an
untrusted download as proof of trust. Installation is separate from preparation.

Copy `examples/segmentation.config.example.json` to the workspace's ignored
`.ai-frame-animation/segmentation.json`, then fill the model path and digest.
Model paths are relative to the config file unless absolute. Paths never enter
public preparation evidence, plans or diagnostic output.

The original single-model profile is `onnx_birefnet`: RGB resized with Lanczos to
1024×1024, image-max/ImageNet normalization, float32 NCHW input, first float32
logit output, sigmoid, min/max normalization, uint8 floor and Lanczos restoration
to source size. Verified bytes are loaded directly with CPU-only execution and
fallback disabled. This is not an arbitrary-ONNX-model switch.

The profile was checked against [rembg 2.0.81 BiRefNet General](https://github.com/danielgatis/rembg/blob/v2.0.81/rembg/sessions/birefnet_general.py)
and its [normalization](https://github.com/danielgatis/rembg/blob/v2.0.81/rembg/sessions/base.py).
[PyMatting](https://github.com/pymatting/pymatting) supplies foreground-colour
estimation only. No alpha-matting solver, mask erosion, colour-threshold recovery
or point-guided background cleanup follows the model automatically.
For a specifically identified residual hole, the separate opt-in
[local correction workflow](reference-correction.md) previews one bounded region
and requires its digest confirmation before producing a new preparation.

## Invocation

```powershell
ai-frame-animation doctor --root my-animation --reference reference.png --preparation-config my-animation/.ai-frame-animation/segmentation.json
ai-frame-animation prepare --root my-animation --reference reference.png --out-dir work/reference/r001 --config my-animation/.ai-frame-animation/segmentation.json
# Inspect cutout.png, foreground.png, review/ and warnings before video compute.
ai-frame-animation plan --root my-animation --job job.json --prepared-reference work/reference/r001/preparation.json --out work/plan.json
```

`doctor` checks files and optional packages statically; it does not import the
estimator, construct a model session, contact a provider or create media.
Ready means configured, not that unseen segmentation will be visually correct.
Missing model/ONNX/PyMatting is a setup issue, not bad source quality.

`prepare` is an explicit CPU operation that writes a new revision. It never
downloads, calls a service, uses GPU, creates a video attempt or spends a video
authorization. There is no automatic model switch or alpha-matting fallback on
failure. The Agent reviews output before requesting the one video confirmation.

## Artifacts and integrity

- `cutout.png`: separated RGBA at the original EXIF-oriented size and coordinates,
  before crop or fitting. Use this for exact comparison with model acceptance.
- `foreground.png`: proportional contain fit on the original-sized canvas,
  with 8% margin on each side; no stretching or synthetic missing parts.
  This is the generation reference. Existing alpha bypasses the model and
  colour estimation, but still receives the same canvas fit.
- `review/`: full-resolution black, white, green, purple (`#8A40D0`), checker
  and alpha views. Diagnostic composites are not generation inputs.
- `preparation.json`: v4 for unchanged single-model/existing-alpha routes,
  v6 for unchanged dual-model input, or v7 for the JPEG primary-input view below,
  binding original, cutout and fitted foreground fingerprints; model digest,
  runtime versions, method, alpha policy, changed-RGB count, fit and warnings.
  It contains no private model path.
- Original artwork: unchanged; the job continues to name it.

For model preparation, matting evidence is `foreground_ml_v1` with
`alpha_policy: preserve_mask`. For existing alpha it is `existing_alpha` with
`preserve_source`. Zero-alpha RGB is zeroed. Supplied source transparency is
not increased if a partially transparent image still needs segmentation.

Plans bind the report digest. Loading preparation and checking the plan verifies
its source, cutout and foreground artifacts. Changing one requires a new
preparation/plan and fresh video confirmation. Existing output directories are
never overwritten.

## Migrating the old reference processor

U²-Net inference, colour/component recovery and `--background-point` processing
are retired. A current U²-Net config returns
`reference_segmentation_backend_retired`; update the backend **and the actual
model/digest**. Do not merely relabel the old graph as BiRefNet. Old CLI point
arguments are rejected instead of silently ignored.

Existing v1/v2/v3 preparation reports are read-only compatible: their hashes,
old evidence fields and artifacts are checked without executing the old
algorithm, reinterpreting evidence as the new backend, or rewriting the report.
Single-model without the JPEG view or existing-alpha `prepare` writes v4.
JPEG primary-input preprocessing writes v7. The separate `correct apply` writes v5,
preserving the original source and binding its parent and confirmed preview;
it does not revive the retired `prepare --background-point` option.
No automatic fallback to U²-Net remains.

Historical problem fixtures remain: their geometry/colours protect white
material, hair gaps, noisy channels, thin structures and analytic soft edges.
Old algorithm-specific connectivity/recovery tests are replaced by new
mask-preservation/estimator/compatibility contracts, not used to require the old
heuristic to keep running.

## Quality limits

### Automatic JPEG primary-input view

For an image actually decoded as **JPEG**, with fully opaque source alpha,
`prepare` gives BiRefNet a separate RGB copy processed by Pillow `MedianFilter(3)`
at the original EXIF-oriented size. This happens before the existing 1024 model
normalization. The image filename is not the format check. There is no new CLI
flag, per-character model choice, extra inference, or automatic retry.

The original bytes/pixels are preserved. IS-Net, when configured, receives the
original image; foreground-colour estimation also uses the original RGB and the
selected mask. The JPEG view is not the generation reference. PNG, WebP, unknown
formats and supplied continuous alpha do not take this preprocessing path.
Existing meaningful transparency still bypasses segmentation entirely.

This is a quality tradeoff, not a universal improvement: a seen JPEG white-boot
omission improved, while a few fine whiskers in another seen image became faint
or disappeared. Prioritizing a complete shoe can be reasonable for that use case,
but it does not approve unrelated equipment loss, certify every JPEG, or establish
an unseen pass rate. The report and static `doctor` expose
`jpeg_primary_view_may_reduce_fine_detail`; inspect the result before video compute.
The synthetic one-pixel-line fixture records information loss, not a quality pass.

The v7 report adds `primary-input.png`, a fixed profile/digest, the Pillow version,
and a fingerprinted `input_view` artifact. A single-model v7 result also saves its
`primary-mask.png`; dual-model v7 retains all three masks and fusion evidence.
The reader verifies the saved view against the decoded, EXIF-oriented source by
repeating only the deterministic filter, then checks mask/alpha/fit relationships.
It never starts a model, re-estimates RGB, needs model files, or modifies outputs.
Fingerprints prove consistency, not that a model's semantic judgement is correct.

Older reports remain read-only compatible and are not relabeled as v7. Older
installed versions that lack the v7 reader cannot consume these new reports;
upgrade consumers before passing them new results. The optional correction flow
accepts v7 parents but still requires a separate exact-preview confirmation.
Neither `strict` nor `best_effort` silently approves visual omissions.

Four real character originals were compared using one model and one colour
estimator setting. This supports the selected route, not universal segmentation
accuracy or frame-by-frame video stability. Public regression tests use synthetic
fixtures and runtime/estimator doubles, not real models or private artwork.

Segmentation confidence is not calibrated physical alpha. Preserve its continuous
coverage here; do not force all near-opaque values (such as 254) to 255 or run
a generic alpha solver that can erode white garments. Foreground-colour
estimation reduces background contamination but cannot correct a confidently
misclassified gap. Do not delete all white pixels to conceal that failure.

An empty foreground, unresolved full canvas, malformed/constant model output,
digest mismatch or solver failure blocks publication. Edge contact, low
resolution and broad uncertain alpha remain warnings. `warnings: []` and
structural success do not establish semantic correctness. Review hair gaps,
white cloth, thin edges and the whole figure on several backgrounds; request a
subject/source clarification if necessary. Non-square, complex-scene and
translucent-material quality need their own real-sample acceptance.

### Translucent materials are not an automatic quality guarantee

Additional local still-image stress checks exposed two separate limitations:
fine hair can retain a bright fringe, and broad translucent gauze can be omitted
by the segmentation mask. These checks have no ground-truth alpha and do not
replace public synthetic regressions or video acceptance.

Foreground-colour estimation cannot restore material assigned zero alpha.
Expanding an unknown region can recover its silhouette while also retaining the
old background pattern, both through the cloth and outside it. That is a failed
separation, not a transparent success. A generic edge-only alpha solver can also
erase an isolated translucent strand with no opaque foreground seed. Neither
experiment is enabled in the default pipeline.

A future material-matting route needs an inclusive foreground/background/unknown
map, a separately validated continuous-alpha estimator, foreground-colour
decontamination and inspection on several backgrounds. A coarse region is a
hint, not a true alpha label. Known foreground/background synthetic fixtures must
test cloth transmission, isolated soft hair, white material and enclosed holes;
real samples must additionally reject residual old-background texture. This is
a candidate route, not a currently supported `prepare` option. New models or
dependencies need explicit setup authorization; `prepare` never downloads them.
Existing transparent artwork retains its supplied alpha without either estimator.

### Supplied alpha touching the image boundary

Source routing accepts an existing cutout when at least 1% of its canvas has
alpha <= 8 connected to an outer edge, even if the visible subject touches one
or several edges. The original clear-border route remains accepted. The check
only selects preservation of supplied alpha: it does not clear, flood-fill,
erode, or re-estimate image pixels. Small isolated transparent points, enclosed
holes without meaningful exterior transparency, and a uniformly translucent
canvas do not by themselves bypass segmentation setup.

Edge contact still produces `source_subject_touches_edge`; fitting adds the
normal transparent margin without inventing cropped character parts. Semantic
review remains required: supplied alpha is not proof that all background was
correctly removed. Fitted-output validation keeps its stricter clear-border
check, separate from source routing.

### Bounded local output publication

After the images and report are complete, `prepare` may retry only the final
rename of its own staging directory on Windows errors 5, 32 or 33. There are at
most four rename attempts, with waits of 0.05, 0.15 and 0.30 seconds. Staging
identity, artifact fingerprints and target absence are checked again; a changed
staging tree or an existing target stops publication. No segmentation, matting,
artifact rewrite, provider submission or permission change is retried here.

Persistent errors return `reference_preparation_publish_busy`; other rename I/O
errors return `reference_preparation_publish_failed` without retry. Cleanup is
limited to the unchanged owned staging directory. If cleanup cannot be completed,
the primary code gains `:staging_cleanup_failed`; a remaining `.preparing` folder
is not a successful preparation and must not be used as a generation reference.

These are process-boundary protections, not a fix for JPEG-sensitive semantic
segmentation, translucent-gauze omission or fine-hair colour fringe. In particular,
a JPEG white-garment sample can pass structural checks while losing part of an
opaque shoe. Inspect actual cutouts; re-encoding it as PNG is not evidence of a
matting repair. This bounded handling also does not diagnose the external cause
of a Windows sharing/access-denied error.

## Relationship to video post-processing

The prepared foreground is composited onto the plan's selected key for video
input. Existing video processing calibrates each frame's observed flat key,
removes it globally (including enclosed holes), decontaminates edges and derives
PNG/atlas/GIF deliveries. **That video processor is unchanged.** It does not use
a fixed-coordinate reference mask for moving holes.

If a generated gap becomes white instead of the key, keying cannot distinguish
it from white armour. Do not erase all whites or automatically regenerate.
Reprocessing the same raw video does not guarantee fixing a non-key semantic
error; that needs separate visual review and verified processing, or a newly
authorized generation. GIF remains a binary preview derived from processed PNG,
not a way to certify the reference model's alpha.

Correct reference gauze does not establish that generation will preserve its
transparency during motion. Review the resulting PNG frames separately. Under
the project's conservative GIF policy every non-opaque PNG pixel is transparent
in the GIF, so translucent cloth can disappear from that preview. Use PNG alpha,
not GIF appearance, to evaluate translucent-material quality.

## Optional two-model local profile

For the enclosed-hole fusion route, provision both trusted **BiRefNet General
1024** and **IS-Net Anime 1024 ONNX** weights during setup, then use
`examples/segmentation-fusion.config.example.json`. Fill both publisher-verified
digests and local paths; the example contains no weights or automatic downloads.
Do not relabel another model as either profile. Keep this configuration in the
ignored workspace, just like the original single-model configuration.

Users still call the same `doctor`, `prepare` and `plan` commands above. Model
selection is not a per-picture Agent decision: the configured program executes
BiRefNet once, releases that session, then executes IS-Net once on CPU, combines
their masks using a fixed rule and estimates foreground RGB once. Both model
files and dependencies are checked before either session is constructed. Any
failure stops preparation; there is no implicit single-model fallback or retry.
Existing meaningful transparency bypasses both models and colour estimation.
For other partially transparent inputs, fusion itself is bypassed and the
source alpha is still multiplied into the primary mask, never promoted.

IS-Net uses Lanczos 1024, image-max normalization, ImageNet mean with unit
standard deviation, float32 NCHW, first mask output without sigmoid, min/max
normalization, uint8 floor and source-size Lanczos restoration. BiRefNet keeps
its own normalization and sigmoid profile. Each CPU session loads exactly the
digest-verified bytes, with runtime fallback disabled.

The fusion rule only considers enclosed holes in the auxiliary mask surrounded
by high primary confidence. It does not delete by RGB colour, globally erode the
external outline, grow masks, invent missing detail or invoke `correct`.
**A solid badge or cloth panel misclassified as a hole by the auxiliary model
can still be removed.** This known synthetic counterexample is recorded as an
expected failing quality test, not a passing segmentation result. User preview
review is still required. Keep the original single-model config available;
existing installations are not silently migrated to fusion.

Fusion without a JPEG input view writes `ai_frame_animation_reference_preparation_v6`, adding
`primary-mask.png`, `auxiliary-mask.png`, `fused-mask.png`, two model identities,
the fixed fusion profile/digest and component decisions. Matting records
`preserve_source_times_fused_mask`: it estimates RGB but does not revise that
alpha. The loader verifies source/masks/cutout/fit relationships without model
inference or re-running the RGB estimator. Report reading requires SciPy for
the fusion geometry (included in the segmentation extra), but does not require
the original configuration or model files. Fingerprints detect changed bytes;
they are integrity checks, not cryptographic provenance signatures.

The optional `correct` workflow also accepts v6/v7 parents. It remains a separately
previewed, digest-confirmed operation; normal `prepare` never applies it.
Older v1–v5 reports remain readable. The test-only extra installs SciPy, not
ONNX Runtime or model weights; CI uses synthetic arrays and runtime doubles.
