# Current delivery chain checkpoint

This checkpoint describes the implemented UI layer workflows and the evidence
needed to distinguish them. It is not a release, a visual acceptance record, or
proof that a new reference will succeed on its first attempt.

## Integrated host workflow

The public entry is `ui_layer.py`; the host implements the actual model/tool
invocations. See [explicit host delivery](HOST-DELIVERY.md) for configuration and
the exact exchange protocol.

1. Supply an offline planning seed and fixed shared planning contracts. An
   independent planning review checks the seed. This mode does not execute M1;
   report `m1ModelExecuted=false` rather than attributing the seed to a model call.
2. Compile frozen `sheets` requests with `context-crops` and v7 prompts. Complex
   requests may use the documented v6 fallback within v7. Every output layer keeps
   its own identity; a sheet reduces image requests, not the layer count.
3. Acquire genuine native images serially through the host exchange. Preserve
   the exact inputs, requests, original outputs and source fingerprints.
4. Freeze an aggregate material-review scope from the actual received images,
   then independently review one request at a time and extract the materials.
5. Freeze actual foreground body-observation inputs and independently observe
   each foreground. Backgrounds do not consume body observations.
6. Perform deterministic registration, package validation and comparison
   production. Ownership, observed body geometry and complete alpha support have
   separate responsibilities; do not hand-adjust manifests or receipts.

Planning review, image acquisition, material review and body observation each
require approval bound to their actual immutable scope. Capacity declarations
do not authorize calls. `host-next` reserves one request; an uncertain or timed
out invocation must not be submitted again. Preserve the terminal state and
record any later experiment as a separately authorized job.

For the explicitly approved `expanded-support-original-viewport-v1` storage
policy, retain complete material storage in the expanded world and present the
original-size viewport. This policy must be frozen with the actual storage
instruction; it does not silently replace historical or default policies.

`FullAutomationExecutionCompleted=true` describes completion of this integrated
workflow. It does not mean M1 ran, that no prior planning/code revision occurred,
that the first experiment succeeded, or that the final image passed human
inspection. Report the executed planning mode and visual acceptance separately.

## Independent revision and diagnostic workflows

| Workflow | Implemented purpose | Evidence boundary |
| --- | --- | --- |
| [Package revision](PACKAGE-REVISION.md) | Replay declared foreground replacements while preserving original layer bytes | A revised candidate is not an unmodified first-attempt result or a promoted old DAG |
| [Material cleanup](MATERIAL-CLEANUP.md) | Freeze one genuine received material as a new source-bound edit | Requires fresh approval; one image call, zero automatic retries; receipt alone does not prove successful cleanup |
| [Received-source diagnostic delivery](RECEIVED-DIAGNOSTIC-DELIVERY.md) | Export genuine received images and source evidence for whole-image inspection | Always `diagnostic-pending-human-review`; retains extraction findings and does not pass the automatic DAG |
| [Baseline comparison](PACKAGE-BASELINE-AUDIT.md) | Bind accepted/candidate archive hashes and report structural differences | Package integrity and structural comparison do not establish visual acceptance |

A diagnostic can include verified singleton cleanup replacements, retaining both
the original and cleanup source evidence. An empty leftover frame, duplicated
child, missing component or shifted object still needs to be recorded in the
final comparison; successful receipt or archive validation cannot erase it.

Keep an accepted delivery available until its replacement receives its own
visual acceptance. Acceptance belongs to the selected package bytes and does
not transfer automatically to a newer revision.

## Reporting the result

For each selected package, identify its source version, planning mode, actual
calls, failed or deferred stages, revisions and final visual acceptance. Label
historical accepted versions and new diagnostic candidates explicitly when
presenting them together. A reference/recomposition contact sheet changes none
of these states.

Offline tests verify deterministic behavior and protocol invariants. They do
not replace real generation evidence or final whole-image visual inspection.
See the [service contract](SERVICE-CONTRACT.md) for the authoritative per-command
rules. This checkpoint adds no new runtime behavior or authorization.
