# Architecture

## Design principle

The orchestrator owns sequencing, state handoff, retry policy, and final acceptance. Each stage skill owns one focused transformation or validation task.

## Baseline chain

1. `intent` — normalize the user goal and constraints.
2. `compiler-prompt` — compile the normalized intent into generation-ready prompts.
3. `generation` — call the required generator or produce the primary artifact.
4. `qa` — validate the artifact against the accepted contract.
5. `post-process` — repair, format, or enrich the artifact.
6. `qa` — revalidate the post-processed artifact.
7. `optimize` — improve quality, cost, or execution efficiency when justified.
8. `output` — package the accepted artifact and its metadata for delivery.

## Skill contracts

Every stage skill must declare its trigger, required inputs, output schema, failure conditions, and verification method. The orchestrator must not infer missing contracts.
