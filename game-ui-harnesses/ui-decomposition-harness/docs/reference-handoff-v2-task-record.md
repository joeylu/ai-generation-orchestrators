# Reference delivery contract upgrade — 2026-09-12

Implemented the versioned self-contained component handoff v2, with exact original
bytes, normalized derivatives, mapping, typed state evidence and per-node scope.
Normal visual CLI exports require reference inputs. Explicit legacy export and
existing API callers remain compatible, with missing-evidence readiness labels.
`reference-handoff` upgrades an existing unreviewed draft into a fresh output;
it does not edit old manifests, receipts, assets or generate artwork.

Producer/consumer checks reject missing original, mismatched hashes, unsafe paths,
wrong image/canvas dimensions, incomplete/out-of-bounds transforms, invalid node
or option references, missing state coverage, inferred values masquerading as
observations and malformed unknowns. Optional derived images have independent
hashes and source transforms. Init/headless input preparation preserves exact
original bytes and separately records normalized PNG/EXIF provenance.

Final executed validation:

- 194 decomposition tests passed, including enabled local browser state fixtures.
- 372 component tests passed, no skipped tests.
- Dedicated PixiJS reference replay browser test passed: observed toggle, selection,
  open popup, repeated replay, explicit close and changed screenshot.
- Component build and git diff whitespace check passed.
- Python producer → official consumer CLI → isolated-folder regression passed.
- Quest Journal existing contracts/decomposition and original input bytes matched
  after repackaging; all 38 imported runtime resources and screenshot hashes checked.

Artifacts are in repository work directory
`work/ui-decomposition/quest-journal-reference-v2-20260912-r001/`.
ZIP SHA-256: `ff17baf3366e681a40e9f6939f96b72513232cc6c10ba93f365fd62707dcb56a`.
Original SHA-256: `1740bf0983c636097e572dff65d4645d6d74c605714e044b0de3763d80aa2287`.
Prior normalized image has different file bytes but identical decoded RGBA pixels;
it is independently included as `reference/derived-1.png` with identity mapping.

Quest Journal observes ACTIVE, story checked/side unchecked, Crystal Grove selected,
ALL REGIONS selected with popup open, and progress 3/5. Numeric scroll offsets are
not observable and remain unknown. The new screenshot replays known state but
retains that blocker: reference evidence complete, visualComparisonReady false,
human_visual_acceptance false. No full visual pass is claimed or fabricated.

All new output directories are distinct. Branch remains tony, no commits or
rollback of unrelated dirty work. No image generation, private service, deployment
or Docker integration was used.
