# UI decomposition harness

**Status: implemented as an opt-in experimental Harness. It is not a default
route and is not an automatic semantic or visual judge.**

This package turns one reviewed UI decomposition plan plus locally materialized
component images into a layered PSD. It keeps only important editable or reusable
components, removes ordinary raster text by policy, reuses repeated component
families, preserves aspect ratio during reuse by default, and requires a
digest-bound visual review before assembly. Empty stretchable bases can explicitly
opt into nine-slice resizing with selected corner insets; see the plan contract.

The deterministic CLI does not call an image provider, retry generation, control
Photoshop, or modify another Harness. An optional provider adapter may fulfill the
frozen request records. `auto` currently selects PSD; explicit PSB requests are
rejected because PSB has not been validated.

Install the immutable UI release directly from its repository subdirectory:

```text
python -m venv .venv
.venv/bin/python -m pip install "ai-ui-decomposition[psd] @ git+https://github.com/joeylu/ai-generation-orchestrators.git@ui-v0.1.2#subdirectory=game-ui-harnesses/ui-decomposition-harness"
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
