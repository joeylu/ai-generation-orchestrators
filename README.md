# AI Generation Orchestrators

A skill-first repository for building AI generation chains.

An orchestrator selects and coordinates focused skills so each stage has a clear input, output, and quality gate.

## Reference pipeline

`intent → compiler-prompt → generation → qa → post-process → qa → optimize → output`

## Repository layout

- `skills/` — reusable, independently versioned agent skills.
- `docs/` — architecture and workflow contracts.

## Status

Bootstrap only. No production skill has been implemented yet.
