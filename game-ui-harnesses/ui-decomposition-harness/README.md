# UI decomposition harness

**Status: implemented as an opt-in experimental Harness. It is not a default
route and is not an automatic semantic or visual judge.**

This package turns a UI decomposition plan plus locally materialized component
images into a layered PSD. The development headless entry can also obtain a plan
and images through a configured optional provider. It keeps only important editable or reusable
components, removes ordinary raster text by policy, reuses repeated component
families, preserves aspect ratio during reuse by default, and requires a
digest-bound visual review for reviewed delivery. An explicit unreviewed-draft
policy allows automatic draft export without claiming human acceptance. Empty stretchable bases can explicitly
opt into nine-slice resizing with selected corner insets; see the plan contract.

Deterministic processing commands remain offline. Only explicit `auto-run` may
invoke the configured provider; it never retries generation, controls Photoshop,
or modifies another Harness. `auto` currently selects PSD; explicit PSB requests are
rejected because PSB has not been validated.

The published `0.2.0` release includes the headless entry alongside the reviewed
flow. It remains opt-in because its draft output does not imply visual acceptance.
See [headless integration](docs/headless.md) for its contract and verification limits.

Install the immutable published UI release directly from its repository subdirectory:

```text
python -m venv .venv
.venv/bin/python -m pip install "ai-ui-decomposition[psd] @ git+https://github.com/joeylu/ai-generation-orchestrators.git@ui-v0.2.0#subdirectory=game-ui-harnesses/ui-decomposition-harness"
.venv/bin/ai-ui-decomposition doctor
.venv/bin/ai-ui-decomposition self-test
```

On Windows, use `.venv\Scripts\` instead of `.venv/bin/`.

The complete local flow is in the
[quickstart](https://github.com/joeylu/ai-generation-orchestrators/blob/tony/game-ui-harnesses/ui-decomposition-harness/docs/quickstart.md).
Read the
[Skill](https://github.com/joeylu/ai-generation-orchestrators/blob/tony/game-ui-harnesses/ui-decomposition-harness/SKILL.md),
[plan contract](https://github.com/joeylu/ai-generation-orchestrators/blob/tony/game-ui-harnesses/ui-decomposition-harness/references/contract.md),
and [provider file protocol](https://github.com/joeylu/ai-generation-orchestrators/blob/tony/game-ui-harnesses/ui-decomposition-harness/references/provider-adapter.md)
before integrating an Agent or external image provider. Container requirements
are documented without adding an official Docker image.

For a service integrator, the [integration handoff](docs/container-integration.md#integration-handoff-boundary)
separates the processing library and optional provider from the receiving
application's web UI and deployment. No web server or Docker image is included.
