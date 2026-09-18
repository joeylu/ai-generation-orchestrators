# End-to-end phase timing 1.0

Start at reference input, before inspection or planning. Finish only after the
last isolated package and requested acceptance/report are produced. This local
append-only sidecar neither generates media nor changes delivery/authorization
receipts. Never reconstruct historical start times from file modification times.

Use `python -m ai_ui_decomposition.timeline begin --timeline DIR --reference PNG`.
At **each** phase boundary run `phase --timeline DIR --name PHASE --category CATEGORY`
through the same module. Categories: input, planning, authorization_wait,
generation, processing, visual_review, code_repair, environment_repair, tests,
packaging, acceptance, reporting, unclassified. Names are portable identifiers.
Record authorization waiting before asking the user; transition on their reply.
Bracket each external generation call, including provider waiting, separately.
Record setup, planning, code edits, agent waiting and environment troubleshooting;
do not label all elapsed time as generation. Use `--previous-status failed`,
`blocked` or `interrupted` at the next boundary when applicable.

Existing main CLI accepts `--timeline DIR --timing-category CATEGORY` **before**
the command. It brackets the real command automatically and leaves subsequent
time as `unclassified`. Explicitly transition to the next actual activity to avoid
missing attribution. Python orchestrators can use `timeline.measured(...)` around
each operation. The timer does not guess operation semantics or observe work
outside these boundaries. Commands that return blocked results still completed
execution; their authoritative outcome remains in their original receipt.

Use `finish --timeline DIR --package ZIP --outcome draft|blocked` at handoff.
`--outcome failed` may omit a package. Then `report --timeline DIR` emits stable
JSON with UTC starts/ends, elapsed per phase, category totals, whole wall-clock
elapsed, original/package hashes, outcome and attribution completeness. Keep the
JSON beside the package and present every phase as a table in the user report.
`report --timeline DIR --format markdown` prints the complete phase and category
tables without changing the journal.
Show total, authorization waiting, generation, processing, code/environment work,
tests, packaging and acceptance separately, including zero/not-run stages.

Every interval belongs to exactly one sequential phase. For parallel work, record
the parent wall-clock span once and show child durations separately as overlapping
detail; **never add child durations to total**. Existing acceptance execution stages
are detail inside the acceptance phase, not additional total time. Retain failed
attempts and repeat phase names rather than overwriting earlier phases.

The journal binds consecutive records by digest and rejects competing writers.
Use one coordinator per timeline. Interrupted work remains open until an explicit
transition; mark the interrupted interval accordingly. Monotonic elapsed is checked
against UTC; clock reset/adjustment invalidates elapsed rather than inventing a
duration. This is local measurement, not cryptographic proof against malicious
rewriting. No private paths, prompts or environment are copied into records.

For historical runs, cite recorded elapsed/UTC evidence and mark missing boundaries
as unknown. File timestamps are only filesystem observations. An incomplete legacy
run must never be represented as a fully measured end-to-end timeline.
