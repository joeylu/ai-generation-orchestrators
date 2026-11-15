# Scene Kit repository contract

This branch maintains the local Scene Kit workflow in
`game-scene-harnesses/scene-kit-harness/` and its shared optional Codex CLI
transport dependencies. Follow that Harness's `AGENTS.md` and `SKILL.md`.

Keep the core provider-neutral. User artwork, credentials, host paths, local
configuration, generation attempts and deliveries belong in ignored local data.
Tests use synthetic fixtures and provider doubles with software WebGL.

Deterministic programs own plans, reservations, processing, manifests, checksums
and packaging. Each generation requires a fresh single-use exact-plan decision
and durable reservation before dispatch. Stop on failed or unknown outcomes.
Preserve original artwork and historical evidence. Human art acceptance is an
independent decision.

The local Studio may edit checked projects, freeze bounded asset and animation
plans and receive checked results through its configured exchanges. Separately
started CLI workers dispatch after the recorded decisions and reservations.
Requests contain typed operations and IDs. Startup configuration owns tool and
filesystem paths. Keep one active operation, with no queue or automatic retry.
Keep the host loopback-only. Do not add public deployment, authentication
services, databases or arbitrary execution endpoints.

Preserve user edits and shared-workspace changes. Stage only the requested scope.
Consumers should bind an immutable Git revision and artifact digest.
