# Visual delivery acceptance

Technical import, matching hashes, and valid interaction do not establish visual
acceptance. Keep these checks separate and retain an unreviewed draft until the
user reviews the exact runtime result. Never construct batch or material receipts
in a sample packager: use the frozen run and `finalize`.

## Before generation

- Record each observed component's type, original bounds, value and reference state.
- Prefer `source_crop` for an intact reusable surface only when it does not retain
  unwanted background or baked text. Cropping alone does not recover alpha.
- Generate only the isolation/completion that is needed. Preserve the source and
  exact target size. Declare generated or derived states instead of calling them
  extracted reference pixels.
- Record applicable states per component as supplied, runtime feedback, missing,
  or not applicable. Do not require every possible state for every component.
- Record font identity, available font bytes and license evidence, or the explicit
  substitute and tolerance. Do not claim screenshot font identification is exact.
- Use matching focus, hover, press, selection, checkbox and slider values for the
  reference and runtime comparison. Retain the original if authoring a normalized
  reference; never silently erase a caret from the visual baseline.

## Two different previews

`preview.png` is the exact ordered alpha composition of the scene PNG layers.
`inspect`, PNG export and component handoff now recompose it and reject
`PREVIEW_COMPOSITE_MISMATCH`, even if all supplied hashes were recomputed.
Do not substitute a browser screenshot for this preview. A board containing all
state parts is not an initial runtime scene; compare its intended runtime state
separately after applying bindings.

The runtime screenshot must be captured from the consumed Bundle at the declared
state. Record its Bundle digest, canvas size, renderer environment and exercised
states in browser evidence. Asset checks alone cannot prove a clean background,
correct font rendering or absence of duplicated old state pixels.

## Offline regional comparison

Run after rendering, before handing a candidate to a recipient:

```text
ai-ui-decomposition region-qa --reference reference.png --rendered runtime.png --policy policy.json --output region-qa.json
```

Example policy shape (replace hashes and bounds with measured values):

```json
{
  "kind": "ai_ui_region_qa_policy_v1",
  "reference_sha256": "<reference SHA-256>",
  "rendered_sha256": "<runtime screenshot SHA-256>",
  "reference_state": {"focus": null, "hover": null, "pressed": null, "values": {}},
  "rendered_state": {"focus": null, "hover": null, "pressed": null, "values": {}},
  "regions": [
    {"id": "button", "bounds": [10, 20, 100, 40], "channel_tolerance": 12, "max_bad_fraction": 0.05}
  ]
}
```

These numbers illustrate the format, not calibrated production thresholds.
Set thresholds before evaluating the candidate using reviewed fixtures. Include
every interactive control and relevant static seams. Small defects should not be
diluted by a large background region. Compare full runtime text only with a
declared font/state policy. The command compares RGBA, uses bounded row buffers,
records per-region errors and the policy digest, and exits with a failure on any
rejected region. Different declared states or changed image bytes fail before
comparison. State declarations are caller evidence, not browser verification.

The component delivery workflow now calls `delivery-check` as its final stage;
that command invokes regional comparison after evidence checks. `auto-run` alone
does not launch a component browser. Keep the report alongside the candidate;
the existing archive has a closed member inventory. A future versioned QA contract
must bind runtime evidence without changing the meaning of `preview.png` or
automatically granting human acceptance.

## Current limits

Handoff export checks actual bound interactive PNGs even for a semantic target
without appearance fields. It rejects opaque/empty part assets and wrong component
types. The component consumer remains responsible for full role/state geometry
validation when applying the bindings; exercise that entry before delivery.
Transparency presence alone does not prove clean edges or clean interior holes.
Custom font metrics, browser-backed state evidence and calibrated region coverage
are not yet automatic. Missing evidence must remain explicit rather than being
reported as a visual pass.
## Existing local artwork

Use `imported_material` for supplied PNGs without a verifiable frozen provider
run. Bind their bytes before freeze; never use a fake `received` or reuse receipt.
This route is exact-size and preserves transparent margins and soft Alpha.
It establishes an auditable local import, not historical generation provenance.

The current scene contract composites every placed layer. A library containing
mutually exclusive state parts therefore has an inventory preview, not an initial
runtime screenshot. Keep a separately named default-art diagnostic plan with only
the selected parts. Do not substitute a browser screenshot into either delivery's
preview. Text and live states still require a separate component runtime check.

## Unified component delivery check

Run `ai-ui-decomposition delivery-check --config check.json --output fresh-check-dir`
after candidate import and browser capture. The CLI exits 2 for missing or failed
evidence and writes `delivery-check.json`; it never upgrades a package to ready.
The existing ZIP inventory remains unchanged. Its SHA-256 and all input hashes
are bound in the sidecar result, so changing the candidate invalidates that result.

The config has kind `ai_ui_delivery_check_v1`. Each of `handoff`, `bundle` (the
consumed Bundle), `binding`, `reference`, `rendered`, `browser_evidence`, and
`region_policy` is `{ "path": "relative/file", "sha256": "64 lowercase hex" }`.
Paths are relative to the config. Browser evidence must name `handoff_sha256`,
`bundle_sha256`, `screenshot_sha256`, `renderer`, and `state`. State contains
`focus`, `hover`, `pressed`, `values`, and `caret_phase` and must match the region
policy. These are caller-supplied observations, not cryptographic proof of a
browser session. Never manufacture missing observations to satisfy the checker.

`states` maps component IDs to applicable state declarations. Each declaration
has `status` (`supplied`, `runtime_feedback`, or `not_applicable`) and nonempty
`evidence` describing its basis. Missing declarations are reported separately.
`fonts` maps text-bearing interactive IDs to `family`, `size`, `weight`,
`line_height`, `letter_spacing`, `baseline`, and `license_or_substitution`.
These declarations expose missing evidence; the checker does not identify fonts
or generate missing artwork. State evidence descriptions are not pixel validation.

Every interactive ID needs a region under the same ID. Thresholds remain explicit
and must be selected before evaluation; no automatic threshold relaxation occurs.
The output `default-state.json` derives CheckBox mark and RadioGroup indicator
selection, Slider clip/position, and Switch thumb position from initial values.
Image/Input/Button parts remain selected. Other types currently return
`DEFAULT_STATE_UNSUPPORTED` rather than guessing. This is a selection manifest,
not a renderer or an automatic edit of the scene archive. The component runtime
continues to own text, interaction and actual screenshots.
