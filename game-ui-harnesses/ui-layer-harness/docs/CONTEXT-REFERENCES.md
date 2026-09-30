# Frozen context references (opt-in experiment)

`--generation-reference context-crops` compiles foreground generation requests
from deterministic expanded crops. `full` remains the default; historical
snapshots without this field keep their full-reference behavior. This is an
input and prompt experiment, not evidence of visual acceptance or fidelity.

```text
python game-ui-harnesses/ui-layer-harness/ui_layer.py run --image REFERENCE.png --output NEW_RUN --target ui-layers --viewer BUILT_VIEWER --max-calls 16 --generation-mode sheets --generation-reference context-crops
```

The option is frozen in the delivery/planning config, M3 snapshot, request rows,
image job and reserved `next` request. An existing reviewed planning run can be
compiled to a fresh separate snapshot with `freeze-reviewed --planning-run RUN
--output NEW_SNAPSHOT --max-calls 16 --generation-reference context-crops`.
It retains its source generation mode unless `--regroup-generation-mode` is
explicit. Omitting the reference option on `freeze-reviewed` retains the source
reference mode. Neither operation generates images or adds a grouping model call.

## Geometry and fingerprints

For each foreground material, begin with its unchanged integer half-open
`sourceRegion`. Each side adds `min(64, max(8, ceil(0.10 * min(width,height))))`
pixels, then clamps to the original canvas. Background requests still attach the
unchanged full reference. No crop is resized, segmented, edited or padded.

`generation-references.json` (`ui_generation_references_v1`) records the
`material-context-expand-v1` policy, original source SHA-256 and dimensions, and
ordered entries with material ID, artifact path, source SHA-256, crop SHA-256,
`cropRegion`, `referenceSize`, integer local `targetBox`, normalized local
`targetBoxNorm`, and requested context margin. A request's `references` adds the
1-based attachment `referenceIndex` and zero-based `cellIndex`. Both are in
`materialIds` order; a singleton has index 1 and cell 0.

For a 50 by 50 target at original pixels `[700,250,750,300]`, the context crop is
`[692,242,758,308]`; its local target is `[8,8,58,58]`. All object and foreign-unit
reference boxes in the prompt are converted from original normalized coordinates
to this attachment's local normalized coordinates. A foreign unit may extend
beyond the crop; its transformed coordinates are not silently clamped.

`preflight` checks the immutable files and reconstructs the execution plan,
group policy, prompt, crop geometry and PNG encoding from the original reference.
It recomputes the source/crop SHA-256 values and rejects rehashed metadata,
reordered references, changed pixels, changed prompts or substituted policies.
It also compares every original material `reference-crop.png` against the original
target region, including sheet members. Those original crops remain the visual
review evidence.

The context rim never changes `sourceRegion`, `output_size`, placement,
registration or the final layer dimensions. It is localization evidence, not an
ownership mask or automatic bounding-box repair. If it reveals that the reviewed
box omitted artwork, a separately reviewed revised plan and fresh snapshot are
required. Do not silently enlarge delivery or infer missing artwork.

## Independent materials and concise prompts

The explicit `compatible-size-and-kind-context-grid-v1` policy uses the existing
kind, aspect and size checks with a maximum of four foreground members. One
member stays a single request. Backgrounds, panels, logos, unknowns and incompatible
materials retain the existing conservative singleton behavior. Historical
`compatible-size-and-kind-grid-v1` and `v2` keep their previous six-member limit.
A sheet request remains one raw source with independently extracted materials;
request grouping never merges ownership or final PNG identities.

The deterministic prompt contains one local normalized `targetBox`, original
`artworkPixelSize`, ordered identities, exact `preserveText`, every owned object's
appearance, and existing local anchors. A material summary is omitted only when
its text exactly duplicates a retained object description. Unlike historical
`object_content`, this mode retains distinct appearances for boxed non-decoration
objects. Position labels cannot override the compiled coordinates. Foreign
exclusions keep their identity and local region without repeating all their
unrelated object descriptions.

The prompt preserves rigid proportions and offsets, common sheet scaling,
observed state, owned single-character pictograms, exact permitted text,
complete foreign-unit exclusion, continuous panel surfaces when relevant, real
continuous alpha and translucent surfaces, and transparent margins on every side.
It forbids filling removed text space with enlarged or recentered artwork. The
internal compiler version marker is not sent in the image prompt.

Offline character counts illustrate the tradeoff; these are not token counts or
provider measurements. On `visual-plan-scoped.json` at 1000 by 1000, current full
request arguments versus context arguments are:

| Request | Full characters | Context characters | Change |
| --- | ---: | ---: | ---: |
| Background | 658 | 631 | -4.1% |
| Panel | 3027 | 2296 | -24.1% |
| Button | 2499 | 1802 | -27.9% |
| Two-coin sheet | 2600 | 2266 | -12.8% |

The background's 27-character difference is only removal of the historical
compiler marker; its background instruction is unchanged. A separate four-card
fixture with long distinct boxed card/icon/illustration descriptions yields
4904 full characters versus 8178 context characters (+66.8%). The latter retains
appearance information the old compiler omitted. Context prompts are not
universally shorter; necessary appearance information is never dropped to meet
a length target.

## Authorization, exact transport and quality gates

A context snapshot requires a new job digest and fresh bound compute approval.
Old full-reference authorizations or receipts cannot authorize its different
requests. `prepare` follows the frozen reference mode and refuses prompt or
reference overrides on a context snapshot. An isolated comparison that changes
those parameters must start from a new reviewed snapshot, except the explicit
deterministic [source-layout board experiment](SHEET-LAYOUT-REFERENCE.md). That
mode derives a separately authorized one-sheet job and keeps the parent snapshot
unchanged; it does not accept arbitrary prompt or reference substitution.

`next` reserves exactly one request and returns the ordered frozen crop paths.
The generation session attaches those exact images, reads the hash-pinned prompt
and attachment count through the existing data-only transport, and runs the fixed
relay once. The model may not rewrite the prompt. Collection checks the exact
arguments and context-reference metadata against the frozen row. Indeterminate,
failed or rejected attempts remain terminal; no automatic resubmission is added.

Receive, native sheet alpha validation, extraction, original-bbox close-up review,
material review, registration, checksums and packaging remain required. A crop,
raw image or extracted sheet does not prove successful delivery. The final
`ui_layer_composition_v1` contract and human visual acceptance state are unchanged.
Offline tests use deterministic images and model doubles; no real generation,
private service or GPU call is included in this validation.
