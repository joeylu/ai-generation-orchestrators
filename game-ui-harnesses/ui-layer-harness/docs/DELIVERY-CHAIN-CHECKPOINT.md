# Current delivery chain checkpoint

This checkpoint describes the implemented UI layer workflows and the evidence
needed to distinguish them. It is not a release, a visual acceptance record, or
proof that a new reference will succeed on its first attempt.

## Integrated host workflow

The public entry is `ui_layer.py`; the host implements the actual model/tool
invocations. See [explicit host delivery](HOST-DELIVERY.md) for configuration and
the exact exchange protocol.

1. For a complete original-reference workflow, select
   `planningMode=fresh-host-m1-independent-review`. The host invokes a fresh M1
   from the original image, frozen prompt and schema, returns its genuine answer,
   and invokes independent M2 on that answer. No old plan, coordinates or
   generated materials enter M1. The separate offline-seed mode remains available
   and reports `m1ModelExecuted=false`; independent review of a seed is not M1.
2. Compile frozen requests with `context-crops` and v8 ownership-first prompts.
   `sheets` is the default; explicit `generationMode=single` generates one complete
   PNG per material. Every foreign object gets a direct DELETE action before KEEP;
   foreign appearance prose is not a drawing instruction. Complex requests and
   sheets use these actions without a v6 fallback. Every output layer keeps
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

Fresh M1, planning review, image acquisition, material review and body observation each
require approval bound to their actual immutable scope. Capacity declarations
do not authorize calls. `host-next` reserves one request; an uncertain or timed
out invocation must not be submitted again. Preserve the terminal state and
record any later experiment as a separately authorized job.

For the explicitly approved `expanded-support-original-viewport-v1` storage
policy, retain complete material storage in the expanded world and present the
original-size viewport. This policy must be frozen with the actual storage
instruction; it does not silently replace historical or default policies.

## Completion and acceptance

| Field or evidence | Meaning |
| --- | --- |
| `m1ModelExecuted=true` | A genuine fresh M1 answer and its source evidence were received |
| `FullAutomationExecutionCompleted=true` | The selected integrated workflow reached complete, including every required foreground observation and deterministic packaging |
| `FullReferenceToDeliveryExecutionCompleted=true` | The complete workflow used fresh M1 and retained its verified original-reference evidence |
| `strictVisualReviewPassed=false` in warning mode | Execution completion is not strict visual approval |
| `finalCompositeVisualAcceptancePending=true` in warning mode | The final image still awaits separate human visual acceptance |

Alpha-placement proxies, partial body observations, source-bound repairs and
diagnostic exports cannot satisfy the complete fresh-M1 route. Report actual
calls per stage, not capacity ceilings, and retain original model answers,
registration evidence, warnings, comparison images and package checksums.

Completion does not establish that no earlier failed experiments or code changes
occurred. When collecting packages from different fixed runtime versions, identify
each version; that collection is not a same-version five-sample regression or a
first-attempt success rate. Human acceptance belongs to the selected package bytes.

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
