# UI Layer protocol maintenance audit

Audit date: 2026-10-12. Scope: the source following alpha.5 and its CI fixes.
This maintenance changes documentation and test discovery only. The CLI entry,
runtime source, planning schemas/prompts/examples and requirements keep identical
bytes; there is no new model/image call or sample-quality claim.

The subsequent [alpha.6 release follow-up](release-0.1.0a6.md) changes the CLI
version identifier and canonicalizes four temporary fixture roots after Windows
8.3 path mismatches were reported by CI. It retains the implementation and
planning-resource bytes audited here. The counts below describe the audit phase;
additional short-path verification is recorded separately with the release.

## Maintained execution boundary

| Surface | Role | Maintenance decision |
| --- | --- | --- |
| `ui_layer.py host-run` / `host-*`, `host_delivery.py` | Current persistent host controller: fresh M1, independent M2, sheets, deterministic placement/package, one final composite review for fast warning jobs | Keep as the new integration entry; [host loop](HOST-INTEGRATION.md) owns current defaults |
| `planning_dag.py`, `experimental_executor.py`, `_core/` | Shared planning validation, immutable image exchange, media and packaging primitives | Keep; names inherited from earlier development do not make them retired dependencies |
| `delivery_dag.py` and `run/resume/status` | Compatible public controller with separate Codex planning/body authorization | Keep for explicit consumers; never mix it with `host-*` in a run directory |
| Per-request material review, exhaustive body observation, strict extraction | Explicit profiles and historical frozen runs | Keep; none is an extra model stage in the new final-composite profile |
| Context v1-v12, older grouping/seam policies, board v1-v4 and original wire `kind` values | Byte-bound prompt reconstruction, receipt validation and historical replay | Keep; removing or relabeling them breaks integrity checks |
| Candidate/revision, received-source, cleanup and archive exchanges | Optional explicit operations on previously received material; separate source/acceptance contracts | Keep outside the default host flow; they do not authorize retries or upgrade failed jobs |
| Retired decomposition producer | Already removed; only reviewed private core behavior and consumer compatibility remain | Do not restore its runner, PSD producer or old package dependency |

A static relative-import inventory finds 115 implementation modules (excluding
package initializers), 88 reachable from the host controller and 100 from the
root CLI dispatch targets. These are import sets, not executed model stages.
The remaining 15 include public Python/module entry points and host adapters:
archive background/component exchanges and revision, candidate package revision,
CLI collection/generation and frozen arguments, rolling image dispatch,
vertical-section fitting, freeze amendment, material merge, post-generation
review, M2 recovery, review repair and source-slot audit. For example,
`host_image_dispatch.run_images` is invoked by the host rather than imported by
the controller; it must not be deleted as apparently unreachable code.
Absence from the root import graph alone is not evidence of a dead API.

One narrower retirement candidate is `review_repair.py`: it exposes an old
same-session repaired-plan reviewer, but has no internal caller, test or current
documentation reference. It is not part of host M1/M2 or final composite review.
It can be considered for removal when optional tools are versioned separately;
retaining it here does not add calls to the successful host chain.

`host_review.runtime_files()` fingerprints the complete Python implementation
inventory, including optional tools. Removing or moving one changes the bound
runtime for existing jobs. A future split of optional tooling needs a separately
versioned fingerprint contract and immutable old releases; this audit does not
weaken that check or migrate existing runs.

## Cleanup applied

- The README quick start now uses `host-run`/`host-status`; compatible DAG and
  separate body authorization are explicitly scoped. New automation stays sheets.
- Current context defaults are consistently v13. Historical v8/v9 descriptions
  remain labelled as historical rather than presented as current defaults.
- Combined sheet boards are documented as the automatic input, with board v5
  and reviewed-texture v6 distinct from context versions and explicit variants.
- The sheet contract separates current fast host behavior from strict DAG
  extraction/review. Historical release notes and original failure counts remain
  evidence rather than live integration instructions.
- Eleven test modules now import reused fixture modules instead of exposing
  imported `TestCase` classes to discovery. Discovery drops from 1,333 executions
  to 1,207, with the exact same 1,207 unique test IDs and inherited local tests.
  All 126 removed executions were duplicates; no test assertion or skip changed.

## Validation boundary

The cleanup compares the exact unique test-ID set and the SHA-256 inventory of
the CLI, requirements, implementation and planning resources before/after.
Targeted offline regressions exercise the changed fixture consumers and current
fresh-reference, rolling-image, combined-board and final-composite paths.
All 194 selected UI cases pass, as do 28 repository boundary/release cases
(one platform-dependent skip). The eleven changed test bodies are AST-equivalent
after resolving the fixture import aliases. Full discovery confirms coverage
identity; this maintenance does not claim a new full 1,207-case execution.
No generated media, old task directory, authorization, receipt, attempt log,
delivery manifest or immutable release is edited by this maintenance.
