# AI Generation Orchestrators

A skill-first repository for building AI generation chains.

An orchestrator selects and coordinates focused skills so each stage has a clear input, output, and quality gate.

## Reference pipeline

`intent → compiler-prompt → generation → qa → post-process → qa → optimize → output`

## Repository layout

- `skills/` — reusable, independently versioned agent skills.
- `docs/` — architecture and workflow contracts.
- `game-scene-harnesses/scene-kit-harness/` — the local reference-to-asset
  workflow, deterministic terrain assembly, verified export and Pixi Studio.
- `game-ui-harnesses/ui-reference-harness/` — shared optional Codex CLI
  transport modules used by Scene Kit.

## Scene Kit

Scene Kit includes reference planning, source responsibility review, bounded
source batches, terrain derivation, editable projects, asset-library generation
and environment animation. Image generation uses an explicitly configured local
adapter with exact-plan decisions and at-most-once dispatch.

With Node.js 22.18 or later, start the synthetic editor from the Harness directory.

```powershell
npm ci --ignore-scripts
npm run studio
```

For project editing with asset and animation generation, use the
[local workspace guide](game-scene-harnesses/scene-kit-harness/docs/local-workspace.md)
and its pinned launcher. The full production sequence is documented in the
[Agent workflow](game-scene-harnesses/scene-kit-harness/docs/agent-workflow.md).
Technical verification and human art acceptance are recorded separately.
