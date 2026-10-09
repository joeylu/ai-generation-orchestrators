# Decomposition Harness retirement

The maintained UI routes are `ui-layer-harness` (reference image to PNG layer
package) and `ui-component-harness` (explicit component semantics, interactive
rendering and portable bundles). The former decomposition directory and its
`ai-ui-decomposition`, `ai-ui-assets` and `ai-ui-stateful` producer entry points
are retired. PSD export and the old producer state machine are not part of Layer.

## Preserved behavior

Layer owns `planning-harness/`: one set of planning prompts, schemas and examples.
Its private `src/ai_ui_layers/_core/` contains only these reviewed dependencies:

| Source behavior | Current owner |
| --- | --- |
| Plan validation, resource limits, source hashes and safe image/path/JSON reads | Layer `_core/contract.py`, `resources.py`, `common.py` |
| Global key removal including enclosed holes, spill cleanup, continuous alpha, contain fitting and transparent RGB normalization | Layer `_core/media.py` |
| Existing immutable prompt fallback | Layer `_core/prompts.py` |
| Planning and layer composition contracts | Layer `planning-harness/` |
| Old ZIP and reference-state consumption | Component existing importers and `docs/legacy-contracts/` |
| Button label browser assertions | Component `tests/helpers/` |

The port uses the reviewed committed baseline. Uncommitted experiments and old
producer extensions are not adopted into the public runtime by this migration.
No old generation runner, authorization/attempt log, model adapter or delivery
manifest is copied into the new core. Wire-format `kind` values remain unchanged
where needed to read historical artifacts; they do not require the old package.

## Frozen runs and distribution

Historical jobs retain their original runtime paths, fingerprints and contracts.
Use their immutable original checkout when inspecting or processing them. The new
runtime does not rewrite those fingerprints, reopen failed jobs or upgrade their
acceptance status. New jobs bind the new Layer paths and code inventory, including
the private core. Moving a contract is not a new model or visual acceptance run.

Layer remains a source preview with `ui_layer.py` as its public entry. It does not
claim an independent wheel or installed Skill. Existing historical tags remain
available in Git; the retired `ui-v*` producer publishing route is removed from
current CI/release metadata. Artwork releases and the Component Node distribution
keep their own contracts. Install immutable source revisions and keep the source
directory layout described in [README](../README.md).

## Verification boundary

The offline suite checks planning, compilation, alpha processing, source/path
safety, request integrity, registration and packaging with local fixtures and
test doubles. Repository checks reject runtime references to the retired package.
No model, image generation, private service or GPU request is part of retirement
verification. Existing visual acceptance evidence keeps its original version.

### Known baseline test failures

Retirement verification covers 1,016 distinct Layer cases across logged runs:
1,006 pass and ten fail. Each failing case also fails on the original committed
baseline `2f547344`; these are not newly introduced retirement failures:

- `freeze_amendment` and `merge_materials` do not produce the `compile-report.json`
  required by the existing frozen-snapshot inspector.
- The CLI relay collection fixture lacks the `snapshotDigest` now required by
  argument verification; its subcases fail before reaching their intended checks.
- The frozen v1 material-review fixture changes a nested schema without updating
  the bound evidence used by its own verifier.
- Two planning-review fixtures still edit the obsolete `observedArtwork` response
  field, one asserts a removed prompt sentence, and one assumes the old nested
  schema layout rather than the current typed-review transport.

These failures prevent a claim that the full Layer suite is green. Retirement
checks and existing sample visual acceptance do not repair or override them.
The interrupted initial discovery is retained; its historical fixture setup and
one runtime-fingerprint failure caused by an in-flight edit were corrected and
explicitly rechecked. Passing coverage above uses the final successful rechecks,
not a claim that the initial invocation passed. Component compatibility checks
pass 63/63 cases, its moved label browser assertion passes 1/1, and repository
checks pass 27 cases with one platform-dependent symlink skip.
