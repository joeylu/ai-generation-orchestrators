# UI decomposition harness

**Status: implemented as an opt-in experimental Harness. It is not a default
route and is not an automatic semantic or visual judge.**

This package turns one reviewed UI decomposition plan plus locally materialized
component images into a layered PSD. It keeps only important editable or reusable
components, removes ordinary raster text by policy, reuses repeated component
families, preserves aspect ratio during reuse, and requires a digest-bound visual
review before assembly.

The deterministic CLI does not call an image provider, retry generation, control
Photoshop, or modify another Harness. An optional provider adapter may fulfill the
frozen request records. `auto` currently selects PSD; explicit PSB requests are
rejected because PSB has not been validated.

Read [SKILL.md](SKILL.md) for the Agent workflow and
[references/contract.md](references/contract.md) for the plan contract. The
bounded evidence and remaining limits are recorded in
[references/acceptance.md](references/acceptance.md).
