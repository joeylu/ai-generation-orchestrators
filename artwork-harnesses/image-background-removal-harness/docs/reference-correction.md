# Explicit local reference correction

`correct` is optional. Ordinary `prepare` retains the current CPU segmentation
and foreground-colour estimation unchanged. Do not run correction on every image.

This requires a package/checkout that includes `correct`. Older packages without
that command cannot read the corrected v5 reports; keep the original v4
preparation available until all consumers have been upgraded.

Use it for one identified patch of leftover canvas inside an otherwise useful
reference, such as a closed key hole. A background-coloured badge, nose highlight
or eye highlight is not automatically background. A local rectangle limits the
damage but is not semantic truth: **inspect the preview before confirming it**.
This cannot restore omitted hair, clothing or gauze, or certify a clean matte.

## Preview, then confirm the exact result

All coordinates refer to the original EXIF-oriented `cutout.png`, before canvas
fitting, not to a displayed thumbnail or `foreground.png`. Rectangles are half-open
`X0 Y0 X1 Y1`. One preview covers at most 5% of the original canvas. The sample
point must be inside it and identify residual background with visible alpha.

For a hypothetical patch at these coordinates:

```powershell
ai-image-background-removal correct preview --root my-animation --prepared-reference work/reference/r001/preparation.json --region 88 62 112 86 --background-point 100 74 --out-dir work/correction/c001
```

This writes a new directory and returns `correction_requires_confirmation`,
`correction_sha256`, the changed/removed/softened pixel counts, and review paths.
It does not replace a preparation or create a video-generation plan/attempt.
There is no network, GPU, model inference, PyMatting call, or model download.
Only core Pillow/NumPy operations are used.

Review `before-purple-512.png`, `after-purple-512.png`, and the source/before/after
detail panels on purple and black. Whole-character views preserve aspect ratio;
the square detail panels use nearest-neighbour enlargement to expose the changed
pixels. `changes.png` is the exact original-size changed-pixel map, not an input
paint mask. The changed region may contain valid foreground: decline a bad preview.

After the user explicitly approves that exact preview digest:

```powershell
ai-image-background-removal correct apply --root my-animation --preview work/correction/c001/correction.json --confirm-correction-sha256 <approved-correction-sha256> --out-dir work/reference/r002
ai-frame-animation plan --root my-animation --job job.json --prepared-reference work/reference/r002/handoff.json --out work/plan-r002.json
```

`apply` writes `cutout.png`, `foreground.png`, a v5 `preparation.json`, and a
neutral `handoff.json` in the new directory. Reviews remain in the
fingerprint-bound preview directory. Keep the
preview, all parents and the original artwork available; validation follows this
provenance chain. It is bounded to sixteen preparation documents and refuses
cycles/deeper chains. Another explicit correction can use the new preparation.
An unchanged correction may be replayed deterministically to another fresh
directory with its digest; no inference or provider work is repeated.

Confirmation here acknowledges a visual edit, **not video compute**. The CLI
checks that the caller supplies the exact digest; it cannot authenticate whether
a human actually inspected the image. The Agent must show the preview, obtain
explicit user approval, and never confirm on the user's behalf. Later generation
still needs its own fresh immutable-plan confirmation. Existing plans are not
modified and continue to refer to their previous preparation.

## Processing and integrity contract

- The program samples the original RGB at the supplied point. It applies the
  existing colour-key alpha/soft-edge policy **only within the stated rectangle**.
  Defaults are RGB tolerance 16 and softness 16; explicit values must be finite
  and between 0 and 64. Channel-direction spill reduction is also part of the
  reused colour-key policy, so thresholds are not a promise to preserve all
  similar-coloured material within the rectangle.
- Alpha is never increased. All RGBA pixels outside the rectangle in the
  original-coordinate cutout remain byte-identical, including soft hair and
  same-coloured material. Unchanged pixels inside retain their prior RGB too.
  Zero-alpha pixels have zero RGB. No global mask erosion/deletion is added.
- The new cutout receives normal proportional canvas fitting. If its visible
  bounding box changes, the fitted foreground may be repositioned; the
  outside-rectangle identity guarantee concerns the **cutout**, not resampled
  foreground coordinates.
- The preview binds its parent report, source through the parent, parameters,
  candidate cutout, fitted foreground, change map and every review image.
  Validation checks hashes and recomputes the expected local edit and review
  pixels in memory. Edited/rehashed candidate masks or misleading review panels
  cannot silently broaden the correction. Validation creates no media files.
- `apply` verifies confirmation and all inputs before publication, rechecks them
  after copying, and never overwrites a target. Changed inputs, invalid paths,
  links/reparse points, malformed parameters, and failed publication are errors.
- The v5 report explicitly records `method: local_correction`,
  `alpha_policy: confirmed_region_only`, and the preview digest. It preserves the
  original source identity and inherited segmentation evidence; it never claims
  that the adjusted alpha was the untouched model prediction.
- `local_correction_requires_review` remains visible. A valid checksum and an
  explicit confirmation do not certify correct foreground semantics or release
  quality. Strict/best-effort delivery policies are not weakened.

Public tests use synthetic fixtures and model/estimator doubles. The same-colour
fixture protects an opaque insert and white cloth outside the region while
clearing a matching background hole inside it. It is a containment/integrity
test, not universal segmentation accuracy.
