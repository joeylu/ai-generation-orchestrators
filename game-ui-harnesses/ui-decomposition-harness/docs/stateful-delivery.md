# Stateful appearance acceptance

The strict stateful route accepts an immutable component handoff, explicit
reference evidence, and the current local UI Component checkout. It imports with
the official `component-handoff` CLI before deriving a state matrix from the
actual consumed bundle. No provider, model, or image generation is used.

```text
ai-ui-stateful --handoff input/ui.component-handoff.draft.zip \
  --evidence input/state-evidence.json \
  --component-root ../ui-component-harness --output new-state-acceptance
```

Prepare the component checkout with its documented dependency installation and
`npm run build`. Browser acceptance uses that checkout's Playwright and built
PixiJS distribution, served temporarily on loopback. On Windows the default
browser is installed Chrome; `UI_HARNESS_BROWSER` selects a Playwright channel.
It never connects to a production service. `--qa-only` is a diagnostic mode and
does **not** release a copy of the ZIP or establish browser acceptance.

Successful browser execution writes a byte-identical copy of the draft ZIP,
`consumed.json`, `state-matrix.json`, `browser.json`, numbered screenshots and
`acceptance.json` into a **new** directory. Failure leaves diagnostic receipts
but no accepted ZIP. No existing output directory is reused. Matrix and browser
receipts are sidecars bound by SHA-256; the old four-member archive contract is
unchanged. Distribute the receipt directory with the ZIP. A bare legacy export
does not establish stateful acceptance.

## Evidence contract: `ui_state_evidence_v1`

Required fields are `kind`, `handoffSha256`, `reference` (`path`, `sha256`) and
`components`, keyed by component ID. Reference paths are relative to the evidence
document and cannot escape its directory. Each component supplies exactly:

* `states`: every expected state name maps to `{basis, region, note}`. `basis`
  is `observed` or `user-confirmed`; `region` is `[x,y,width,height]` in reference
  pixels. Notes must identify the observed or confirmed state semantics. Never
  claim an unseen state was observed, or infer state colors from luminance.
* `relations`: every part slot maps to `{mode, note}`. `mode` is `distinct` or
  `shared`. Notes explain the reference basis, including deliberate same-state
  reuse. The relevant state evidence is recorded alongside every matrix state.

Slots and supported public roles:

| Component | Enumerated states | Slots / roles |
|---|---|---|
| Tabs | every tab ID | `background/<id>`: tab, active-tab; `icon/<id>`: icon, active-icon |
| Button | default, hover, pressed | background |
| CheckBox | off, on | box, mark (mark visible only on) |
| RadioGroup | every option ID | option/id, indicator/id |
| Select | every selected option, menu reopened | background, indicator, popup |
| Switch | off, on | track, thumb (shared texture, distinct positions) |
| List | every item selected | background, row/id (row, selected-row) |

All Tabs require a per-tab explicit `icon` and `active-icon` binding and both
local layouts. Both PNGs have identical dimensions, alpha bytes and
`target-item-local` geometry. Different states need different file **and decoded
pixel** hashes. Shared visuals need explicit evidence; merely duplicating files
cannot satisfy a distinct relation. Backgrounds must not contain the icons.
Text remains runtime-drawn; Tabs activeTextColor and Select fieldTextColor are
checked independently from menu/base textColor.

The matrix records component ID, type, state, visibility, role, layer, resource
path, file/pixel/alpha hashes, source canvas, absolute geometry, Tabs local
geometry and reference evidence. Relations describe visual resources, not
whether a shared mark is currently visible or a shared thumb has moved.

## Failure codes and limits

| Code | Meaning |
|---|---|
| STATE_MISSING | state, binding, or per-tab icon absent |
| STATE_RELATION_MISSING | incomplete explicit relationship declaration |
| STATE_REFERENCE_EVIDENCE_MISSING | absent/invalid evidence or reference digest |
| STATE_DISTINCT_DUPLICATE | distinct visuals reuse bytes or decoded pixels |
| STATE_SHARED_MISMATCH | shared declaration contradicts decoded pixels |
| STATE_GEOMETRY_MISMATCH | canvas, alpha contour or local geometry differs |
| STATE_ALPHA_INVALID | non-RGBA, empty, or fully opaque state part |
| STATE_BACKGROUND_BAKED_CONFLICT | known icon template also found in a Tab background |
| STATE_ROLE_UNSUPPORTED | role absent from the current public adapter |
| STATE_CAPABILITY_MISSING | unsupported component/state adapter; no fallback |
| STATE_NOT_VISIBLE | a required state cannot be reached in the visible fixture |
| STATE_RESOURCE_MISMATCH | resources or bound package changed |
| STATE_COMPONENT_IMPORT_FAILED | official CLI rejected the archive |
| STATE_BROWSER_FAILED | browser receipt contains the specific runtime/pixel failure |

Version 1 requires native-size geometry and all enumerated items visible. Input,
Slider, ScrollView and Dialog fail explicitly until their full acceptance
adapters exist; their old delivery support is unchanged. Additional pressed,
disabled, error or focus *image roles* cannot be invented. If a reference requires
them, this profile cannot establish complete acceptance. It does not silently
substitute procedural controls. Button uses the public shared background with
the runtime's observable press transform, not a fictional pressed-image role.

Known-template background detection scans integer positions at the delivered
scale. It detects copies of the provided icon, not arbitrary repainted or
rescaled semantic equivalents. Opaque-core browser comparison uses RGB tolerance
12 and a maximum 5% outlier fraction, masks text and genuinely covering layers,
and requires actual visible pixels. Text tests check the expected color in each
label area, not OCR/font identity. Alpha-contour equality is deterministic;
arbitrary edge compositing fidelity still needs human review.

Tabs icon alpha validation additionally rejects near-solid rectangular plates:
at least 2% of the alpha bounding box must remain transparent. A transparent
one-pixel outer border is insufficient. Intentionally solid rectangular icons
require a future explicit shape-evidence capability and are not silently waived.

Every receipt keeps `human_visual_acceptance: false`. Technical success,
successful screenshots and hash validation never promote a draft to final
human visual acceptance.

## Local regression

```text
node tests/stateful-fixtures.mjs ../ui-component-harness NEW_FIXTURE_DIRECTORY
python -m unittest discover -s tests -p test_stateful.py -v
```

Set `STATEFUL_BROWSER_TESTS=1` after the component build to run real browser
acceptance for all seven types. Tests generate local deterministic PNG fixtures:
`Tabs-identical` reproduces r006 and must fail after official import; `Tabs`
reproduces r007's dark/light icons across ACTIVE, COMPLETED and ARCHIVE. They
neither read nor overwrite the historical Quest Journal packages. Other tests
exercise missing evidence/roles/states, explicit sharing, geometry, alpha and
baked template detection. Dependency setup is not performed by tests.

For persistent fresh evidence, run `python tests/run_stateful_regression.py
--component-root ../ui-component-harness --output NEW_DIRECTORY` with the package
installed (or `PYTHONPATH=src`). It records all seven browser cases and the
expected duplicate-state rejection in `regression.json`.
