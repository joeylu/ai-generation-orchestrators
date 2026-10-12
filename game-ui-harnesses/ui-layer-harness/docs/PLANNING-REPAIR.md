# Official host planning validation and repair

This contract applies to **new fresh M1 `host-run` jobs in alpha.7**. It does not
upgrade historical runs or dispatch a model. Use only `host-*` for this controller.
Shared exchange directories retain their historical `.dag` storage name; the
legacy DAG controller is never invoked.

## Audit against alpha.6

Baseline: `ui-layers-v0.1.0-alpha.6`, commit
`dab0c2c334d130543b1f82b1794d895b3cfe9ca2`.

| Existing capability | Reuse |
| --- | --- |
| `host_m1` schema/original exchange verification | Preserve and verify actual dispatch, return, identity and original bytes |
| `evaluate.check_relations`, relation catalog/assessment | Keep IDs, ownership, background/depth and containment blocking; visual overlap hints still go to M2 |
| Layout/capacity preflight | Validate and count the actual selected candidate before independent review |
| `host_review.prepare/receive/verify_run` | Separate immutable independent exchange per candidate, retaining typed catalogs, focus images and evidence gates |
| `freeze_amendment` / `merge_materials` | Preserve existing explicit snapshot contracts and inspection. Their `newM2ReviewPerformed=false` cannot substitute for a repair review |
| `refreeze.freeze_reviewed`, compiler, snapshot inspection | Freeze and verify the actual reviewed candidate with full lineage |
| Old planning DAG repairs / `review_repair` | Not used by the host controller |

Offline execution of the exact alpha.6 tag reproduces the reported failure:
warning mode can have no visual blockers while the relation assessment retains
`OBJECT_OUTSIDE_MATERIAL`; the host terminates with `M2_UNRESOLVED` before images.
This is not a real-model reproduction of the alpha.5 production task.

## Program validation and deterministic candidates

Fresh jobs bind `planningPreflightPolicy=host-planning-preflight-v1`.
`planning_preflight` is a deterministic journaled stage after M1 or repair.
Reports distinguish `technicalErrors` from `visualWarnings`; it makes zero
external calls and does not assert visual acceptance.

The storage schema and existing relation validator check finite, in-range,
ordered coordinates, IDs within each typed catalog, ownership references,
unused materials, one full-canvas background and its ownership/depth, and
parent/object containment. Layout validation checks source fingerprints, exact
foreground coverage, duplicate constraints, endpoints/axes, ordered internal
targets and their placement. Invalid JSON, duplicate JSON keys, nonfinite JSON,
wrong identity and altered exchange evidence stop before repair.

The rule `expand-explicit-owner-envelope-v1` unions a parent box with **all its
explicitly owned object boxes**. Every expanded edge must be at most **2 original
pixels and 1% of the parent dimension**; area growth is at most **2%**, and every
object must already intersect at least **95%** of its area with that parent.
It also requires valid schema/references/IDs, containment as the only technical
error, a foreground owner, no unknown/background contour or unresolved unknown,
no newly included foreign object/foreground material, no layout constraint on
that parent, and no new technical defect after derivation.

These bounds concern declared geometry; M2 still inspects the clean reference
and actual candidate. Large changes, ambiguous contours/ownership, invalid
coordinates and constrained parents retain their errors for the optional model
branch or terminal failure. No object is shrunk, reassigned or silently erased.
Errors are never converted to warnings merely to pass.

The model branch also preserves every uniquely identified original object. A
valid original object box must remain contained by its repaired box; shrinking,
dropping or replacing it with an absent locator is a technical blocker before
rereview. Invalid original coordinates have no valid contour authority and must
be corrected against the source. Ownership revisions are listed in the bound
`planning-repair-catalog.json`; the independent reviewer must explicitly confirm
each revision with source and ownership evidence in `planningRepairAudit`.
Unconfirmed changes block even in visual warning mode. This is authorization of
a changed ownership contract, not promotion of ordinary visual warnings.

## Host / Docker consumer configuration and authorization

This documents an external consumer integration. The release adds no Docker
implementation and does not operate or change a Docker service. Install the
immutable release and extend the consumer's stage switch before enabling repair.

Repair is **disabled by default**. Normal planning still uses one M1 and one M2;
safe deterministic union adds zero model calls. To enable the conditional branch,
add these fields to the required [host configuration](HOST-DELIVERY.md):

```json
{
  "planningMode": "fresh-host-m1-independent-review",
  "planningRepairPolicy": "one-repair-independent-rereview-v1",
  "maximumPlanningRepairCalls": 2,
  "planningRepairer": "planner-repair-session",
  "planningRepairReviewer": "independent-review-session",
  "generationMode": "sheets",
  "contextPromptVersion": "v13",
  "maximumConcurrentImageCalls": 3,
  "visualReviewMode": "warning"
}
```

The repair reviewer must be independent of all original candidate authors and
the repairer. The repairer may be the original planner. Model, effort, destination
and timeout use the frozen `planningModel`, `planningEffort`,
`planningDestination` and `maximumModelCallSeconds`.

The M1 scope exposes `conditionalPlanningRepair`, reserving at most two extra
calls. Actual compute approval must cover that complete scope. Use the normal
`host-authorize --digest SCOPE --approval RECORD`; configuration alone is not
authorization. When verified planning errors trigger repair, the program derives
each exact branch authorization from this immutable approval, scope and trigger
digest. Dispatch only the resulting `host-next` reservations. The branch scopes
are already authorized; do not authorize them again.

| Stage | Consumer action | Maximum reservations |
| --- | --- | --- |
| `planning_generate` | Original fresh M1 | 1 |
| `planning_preflight` | Deterministic transition; no dispatch | 0 |
| `planning_review` | Existing independent M2 exchange | 1 |
| `planning_repair` | Full-plan repair using original reference, parent, errors and schema | 1 |
| `planning_rereview` | Existing independent M2 wire format for the repaired candidate | 1 |
| `images` | Existing image authorization and rolling dispatch | Frozen image budget |
| `composite_review` | Existing final independent review | 1 |

If M1 preflight blocks, initial M2 is not dispatched: at most **3** planning
calls. If verified M2 identifies blocking planning errors: at most **4**.
Repair and independent rereview consume the explicit two extra slots. They are
separate from image/material/composite/body budgets. Failed repairs or rereviews
never start another repair. Capacity overflow remains terminal; no budget is
silently increased and no material is dropped to fit it.

`host-status` exposes maximum calls, `planningModelCallsUsed`,
`planningRepairCallsUsed`, `planningRereviewCallsUsed`, active candidate path/hash,
derivation hash, preflight errors and terminal reason. Counts represent consumed
local reservations, not cryptographic provider telemetry. Timeout consumes its
slot. `host-timings` separates `planning_preflight`, `planning_repair` and
independent `planning_review`, including reservation wait.

## Repair response and independent rereview

Use the repair reservation's exact `requestPath` / `requestDirectory`, prompt,
parent, original reference, schema, preflight and optional prior review. All
inputs are digest-bound. Return original full-plan JSON from outside the run
through `host-receive`, with actual distinct dispatch/return evidence:

```json
{
  "kind": "ui_host_planning_repair_attestation_v1",
  "requestSha256": "<exact request bytes SHA-256>",
  "responseSha256": "<original response bytes SHA-256>",
  "parentCandidateSha256": "<request parentCandidateSha256>",
  "repairerId": "<frozen repairer identity>",
  "model": "<planningModel>",
  "effort": "<planningEffort>",
  "hostAssertedModelResponse": true,
  "notProviderReceipt": true,
  "notCryptographicallyPlatformVerified": true,
  "dispatchEvidenceSha256": "<actual dispatch evidence SHA-256>",
  "returnEvidenceSha256": "<actual return evidence SHA-256>"
}
```

`planning_rereview` uses the existing `ui_host_review_attestation_v1`, the
**candidateAuthors from that exact request**, and the frozen repair reviewer.
The exact schema additionally requires `planningRepairAudit.catalogDigest` and
`ownershipChanges`, keyed by every changed object ID with `status`
(`confirmed`, `uncertain`, `rejected`), `sourceEvidence`, and `ownershipEvidence`.
Both evidence strings must be nonblank, and only `confirmed` permits freezing.
Never reuse the first M2 answer or assemble an agent-authored answer. Each
individual `host_review` exchange still has `maximumRepairs=0`: the outer host
controller owns the repair budget and creates a separate exchange.

## Evidence, upgrade and interruption recovery

`planning-m1` preserves original M1. `planning-candidates/initial` and `repaired`
are independent immutable bundles binding origin, rule limits, source/candidate
SHA-256, before/after reports, exact changed JSON pointers, refusal reasons and
authors. Model changes bind before/after value digests separately from the safe
union changes. The repaired bundle contains actual repair/preauthorization
evidence and any original blocked M2 exchange. `planning` and `planning-rereview`
have separate candidate copies, previews, typed catalogs and received records.
`planning-repaired-capacity.json` preserves the original capacity report.

Only a program-valid, independently reviewed candidate is frozen. Snapshot
evidence includes `evidence/prepared/m1/derivation`; inspection recomputes the
union/change report, validates original exchanges and previous blockers, and
checks all hashes. Layout, previews, crop boards and later images reference that
actual candidate. A historical failed result is never promoted.

Upgrade alpha.6 by checking the new release `SHA256SUMS`, unpacking into a new
version directory and selecting it only for **new jobs**. Keep alpha.6 installed
with each old run's complete directory. Old amendment/merge and ordinary frozen
snapshots retain their inspection contracts. There is no in-place run migration.
Alpha.7 also includes the preceding offline benchmark/timing work, documented in
[benchmark and timing](BENCHMARK-AND-TIMING.md).

Serialize run mutations. After restart, `host-status` / `host-resume` inspect a
pending reservation without redispatch. A fully received checkpoint can advance
deterministically once. An interrupted receive/advance transaction retains the
existing `INTERRUPTED_TRANSACTION_NO_RESUBMIT` terminal policy and its partial
artifacts. For timeout/unknown outcome or failure after possible acceptance, use
`host-fail`, preserve late results and never automatically resend. A new attempt
requires a new run and decision bound to its own scope.

Default sheets, v13 edit-only prompts, board v6 reviewed-texture bindings,
native `transparent_background`, rolling image limits and one final composite
review remain. Repair stages never prepare or reserve images. Visual findings
remain warnings in warning mode, technical errors block, and human acceptance
stays pending. No default per-material/body model calls are added.
