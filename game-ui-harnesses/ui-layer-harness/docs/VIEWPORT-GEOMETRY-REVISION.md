# Expanded support with the original viewport

`viewport_geometry_revision` is a new optional candidate contract:
`expanded-support-original-viewport-v1`. Existing strict gates and the existing
observed geometry revision remain unchanged. This module performs no model,
generation, network, native image tool or CLI calls.

Selection uses the existing `ui_observed_geometry_revision_v1` schema and sealed
archive observations. Typed verified native edit sources are accepted through
the same replayed edit chain. Scalar scale and translation come only from actual
complete body observations or visible landmarks, using the explicit finite
residual ceiling. Ownership and alpha storage do not select scale. Material
issues remain in candidate provenance. Unusable observations retain the original
layer bytes and placement in original coordinates.

Unlike the existing canvas support contract, full transformed foreground alpha
may extend outside the original reference viewport. Rendering covers the full
theoretical support plus cubic sampling guards before removing only zero-alpha
padding. Alpha 1 participates in storage. There is no clipping, thresholding,
automatic shrink, clamp, axis stretch or invented body boundary. Integer identity
scale and integer translation preserve source alpha exactly; cubic resampling
may quantize faint alpha, as reported. RGB becomes zero where rendered alpha is
zero. Native source files and their receipt SHA remain unchanged.

The world canvas is the union of every complete stored layer region and the
original reference viewport. A single integer shift makes all world coordinates
nonnegative. The original reference is extended with transparent padding into
that world; the exact original PNG is also delivered unchanged. Display uses the
original viewport dimensions and an exact world composite slice. The viewport
clips display only: PNG layer storage keeps complete support outside it. Existing
world pixel and composition limits still apply; exceeding a limit fails rather
than silently changing geometry. Backgrounds use the existing explicit observed
whole-canvas opaque contain/edge-pad candidate rule inside the original viewport.

`draft(selection, fresh_output, viewer)` writes `proposal.json`, `viewport.json`,
`world-preview.png` and `viewport-preview.png`, with
`status: unapproved-policy-proposal`, `approved: false`, exact world bounds and
`proposalDigest`. It creates no ZIP or policy approval. The host must show this
concrete draft and obtain the user's explicit approval of this storage/display
policy. Authorization for image compute does not imply approval of this policy.

Only after that approval call
`freeze(selection, fresh_output, actual_user_policy_instruction)`. The instruction
must be the actual nonempty human policy approval. The deterministic freeze binds
its SHA, the specific proposal digest and viewport, selection, archive and sealed
observation/edit evidence trees. It is a local host evidence declaration, without
cryptographic proof of human authorship. Private paths and user instructions stay
in local frozen records.

`revise(frozen, expected_digest, fresh_output, viewer)` requires that approved new
freeze kind and unchanged evidence. It recomputes the precise proposal digest
before packaging. A draft cannot authorize formal export. All result flags for
human acceptance, strict body registration, whole automatic DAG and original
DAG promotion remain false.

The unchanged deterministic writer produces standard world
`delivery/ui-layers.zip` and verifies world pixel recomposition. Its legacy
allowlist is unchanged. The new independently verified outer delivery is
`delivery/viewport-ui-layers.zip`, with exactly:

- `world-ui-layers.zip`: the complete standard world layer ZIP;
- `viewport.json`: world bounds, shift, original viewport box and reference SHA;
- `viewport-preview.png`: the exact original-size world composite slice;
- `original-reference.png`: byte-identical original reference;
- `viewport-checksums.json`: the new `ui_viewport_layers_wrapper_v1` checksum contract.

`validate_viewport_archive(path)` checks CRC, unique safe fixed member names,
stored ZIP method, all member sizes and SHA, the unchanged inner archive validator,
world recomposition, viewport pixel slice and original-reference extension.
`result.json` binds inner and outer hashes, companion hashes and provenance.
The wrapper is a new artifact kind and is never represented as the old standard
layer ZIP contract. Source review issues, typed source evidence and material
findings are retained. No historical logs or manifests are edited.

Offline public fixtures cover alpha 1 outside the viewport, exact original-size
display slicing, genuine native edit binding, unchanged raw SHA, uniform geometry,
wrapper integrity, unapproved export rejection and frozen evidence changes.
