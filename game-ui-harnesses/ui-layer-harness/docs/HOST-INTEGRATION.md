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
  -> deterministic diagnostic registration, comparison and packaging
  -> composite_review (one independent call; warning mode default)
  -> diagnostic_complete (human visual acceptance pending)

Explicit per-request profile:
  images -> material_review -> diagnostic packaging
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
  "generationGroupingPolicy": "compact-controls-context-grid-v5",
  "visualReviewMode": "warning",
  "bodyReviewPolicy": "final-composite-first-v1",
  "materialReviewPolicy": "final-composite-once-v1",
  "maximumConcurrentImageCalls": 3,
  "maximumMaterialReviews": 1
}
```

Set finite total image/review/body budgets separately. Sheets retain individual
material identities; backgrounds and incompatible materials can use standalone
requests. Ordinary business text/numbers remain blank. Capacity and layout checks
run after fresh M1 and before M2; grouped request counts are reported before image
dispatch. Bounds and checks do not guarantee a visually correct generation.
Hosts must recognize `composite_review` as a model stage and reserve it once;
the original, recomposition and atlas are attachments to that one request.
Use its exact inline packet/schema and the composite attestation format in
HOST-DELIVERY. Old adapters that only recognize `material_review` need updating
before selecting this new policy. This policy is included in alpha.5; alpha.4
retains its published defaults. Keep existing runs on their original release.

Automatic combined sheets with source-bound, independently reviewed raster
textures bind board prompt v6. It uses the v5 edit/remove/keep rules and maps
each licensed texture region into its own cell using the common integer scale.
The original texture review and source fingerprints remain authoritative; this
mapping performs no new texture review. Arbitrary prompt overrides and explicit
unreviewed texture-board variants remain rejected. Existing board descriptors
replay their originally bound version.

The one composite review must inspect actual residual ordinary labels and
numbers, including labels copied unchanged from the original. Text removal is a
requirement, not an assumed result. Only each material's exact `preserveText`
entries may remain; expected removal is not a visual defect. Text findings stay
warnings and do not add review calls or trigger generation retries.

The optional CLI collector and image adapters can use
`collect_session.inspect_png(path)` for read-only PNG inspection. It verifies
structure immediately after opening, then decodes and reads alpha with a second
reader over the same bytes. Calling Pillow `verify()` after `load()` or
`getchannel()` can reject a valid PNG. This inspection does not accept a material
visually, replace `host-receive`, or rewrite original pixels.

## Rolling image execution

For image execution use a rolling coordinator. Reserve the initial bounded
requests, then receive each returned original PNG immediately using
`host-receive --refill-images`. Invoke its optional `nextImageRequest` once without
waiting for the other calls. Python adapters can instead use
`ai_ui_layers.host_image_dispatch.run_images(run, invoke)`, where `invoke` is the
host's explicit async image-tool adapter. Both routes retain immutable arguments,
single-use authorization, original source evidence and no-resubmit rules. See
[host delivery](HOST-DELIVERY.md) for failure/drain behavior and result fields.

Pure validation results are reused only within one host operation after hashing
current input bytes and inventory. Final package validation remains complete.
This does not reduce model review coverage or skip M1/M2.

The post-alpha.6 source adds read-only `host-timings` for newly created runs and
an offline fixed-reference `benchmark` command. See
[benchmark and timing](BENCHMARK-AND-TIMING.md) for phase boundaries, historical
availability and regression scope. These commands make no external calls and do
not change review, reference-edit prompts, rolling concurrency or retry policy.
Offline `benchmark --replay-received --profile-local` additionally writes a
SHA-256-bound cost report with function self times and per-operation wall/CPU
clocks. Profiling is opt-in, includes overhead, and never installs hooks in the
formal host chain; ZIP method counts distinguish stored members from compression.

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
