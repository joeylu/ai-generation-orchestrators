# Host integration entry point

New service integrations use `ui_layer.py host-run`, followed by the `host-*`
exchange protocol. `host_delivery.py` owns the persistent stage state machine;
it reuses planning review, deterministic freezing, image exchange, extraction,
registration and packaging primitives. The legacy `run/resume/status` route
still uses `delivery_dag.py`; it is not the controller of an integrated host run.
Do not mix these controllers in one run directory.

## Stage flow

```text
host-run
  -> planning_generate (fresh M1)
  -> planning_review (independent M2)
  -> images (bounded parallel tool calls)
  -> material_review (bounded parallel independent model calls)
  -> diagnostic registration, comparison and packaging
     or explicit exhaustive body_observation, then packaging
```

The CLI prepares requests and verifies receipts. The host supplies the actual
model/image calls and their original evidence; running the CLI alone does not
perform generation. Configuration, exact response/evidence requirements and
historical compatibility are specified in [HOST-DELIVERY.md](HOST-DELIVERY.md).

## Host loop

Use the same immutable installed release and complete persistent run directory
for every operation. Successful commands print one UTF-8 JSON object to stdout;
process information goes to stderr. Exit code 0 can mean normal waiting.
On nonzero exit, preserve stderr and do not assume a JSON result is available.

1. Create a fresh run with `host-run --config CONFIG.json --output NEW_RUN`.
   Read `host-status --run NEW_RUN` for stage, status and the current scope digest.
2. Bind the user's compute approval to the reported immutable scope with
   `host-authorize --run NEW_RUN --digest SCOPE_DIGEST --approval APPROVAL`.
   Preparation alone is not authorization. Preserve the actual approval record.
3. Reserve work using `host-next --run NEW_RUN`. Images and material reviews
   support `--count` within the frozen limit and available slots. Use the exact
   returned arguments, images and submission digest for each reserved call.
4. Dispatch only those reserved external calls. Preserve each original result
   and actual dispatch/return evidence outside the protected run directory.
   Model callers must be independent where the frozen scope requires it.
5. Receive results individually with `host-receive --run NEW_RUN --digest
   SUBMISSION_DIGEST --response RESPONSE` and the required `--host-attestation`,
   `--dispatch-evidence` and `--return-evidence` files. See the detailed contract
   for the evidence format; a host-authored success claim is insufficient.
6. Use `host-resume --run NEW_RUN` to advance deterministic stages, then inspect
   `host-status`. Authorize and reserve the next pending scope as appropriate.
   `host-resume` does not retry or make model/image calls.

External calls may run concurrently; **serialize all state-changing CLI commands
for one run**, including authorization, reservation, receipt, failure and resume.
Receive parallel results in any order, one at a time. Never edit program-owned
state, journals, manifests, snapshots or responses. Keep service bookkeeping
outside the run so checkpoint verification can detect unexpected files.

An uncertain, timed-out or failed external request consumes its reservation.
Use `host-fail --run NEW_RUN --digest SUBMISSION_DIGEST --reason REASON` as the
protocol requires. Never resubmit it automatically. Preserve late results without
redispatch. Terminal runs keep their original runtime and failure records;
upgrading the installed code does not authorize continuing them in place.

## Recommended new diagnostic configuration

This fragment supplements the required full configuration from HOST-DELIVERY:

```json
{
  "planningMode": "fresh-host-m1-independent-review",
  "generationMode": "sheets",
  "generationGroupingPolicy": "compact-controls-context-grid-v3",
  "visualReviewMode": "warning",
  "bodyReviewPolicy": "final-composite-first-v1",
  "maximumConcurrentImageCalls": 3,
  "maximumConcurrentMaterialReviews": 3
}
```

Set finite total image/review/body budgets separately. Sheets retain individual
material identities; backgrounds and incompatible materials can use standalone
requests. Ordinary business text/numbers remain blank. Capacity and layout checks
run after fresh M1 and before M2; grouped request counts are reported before image
dispatch. Bounds and checks do not guarantee a visually correct generation.

## Terminal outcomes

- `diagnostic_complete_pending_visual_acceptance`: expose the generated viewport,
  comparison, candidate ZIP and warnings for review. This is not strict success;
  inspect `independentMaterialDeliveryComplete` and unresolved material IDs.
- `complete_pending_visual_acceptance`: execution completed under the frozen
  profile, with human visual acceptance still pending. Do not infer a visual pass
  from the exit code or package checksums.
- `failed_no_retry`: preserve failure/evidence and request a new decision before
  any new attempt. Do not silently restart or convert the failure to completion.

The source package contains no Docker service or model-provider implementation.
The consuming service owns that integration and should install the tagged source
and viewer by their published SHA-256 digests.
