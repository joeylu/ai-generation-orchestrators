# Skills

This directory will contain portable agent skills using the `skills/<skill-name>/SKILL.md` convention.

Planned baseline skills:

- `orchestrator`
- `intent`
- `compiler-prompt`
- `generation`
- `qa`
- `post-process`
- `optimize`
- `output`

Each skill will remain independently testable. The orchestrator may coordinate a chain, but must not duplicate a stage skill's responsibility.
