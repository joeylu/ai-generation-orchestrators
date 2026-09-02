# User-managed container integration

This repository intentionally does not ship a Dockerfile or container runtime.
The Harness can run inside a user-managed OCI container when these conditions are
met:

- Debian/Ubuntu-compatible userspace with Python 3.10 or 3.14. Alpine is not a
  tested target because NumPy and SciPy wheel availability differs.
- Install the verified `ui-v0.2.3` Release wheel after the README's byte-count
  and SHA-256 checks. The deployment maintains a separate hash lock for the
  base and PSD dependencies before installing the wheel with `--no-deps`.
- Run as a non-root user.
- Mount references and provider results read-only. Mount the Harness workspace,
  request outbox, and delivery directory as separate writable volumes.
- Do not bake provider credentials into the image, plan, request bundle, logs, or
  output layers. A provider adapter owns its credentials outside the core run.
- Persist the entire job directory, including `private/`, workspace and request
  bundles, on a durable volume. An indeterminate provider request, including the
  post-generation visual-quality request, must remain terminal after container
  restart.
- Run `ai-ui-decomposition doctor` and `self-test` in the built image before use.

Deterministic processing needs no GPU or network access. The explicitly selected
`auto-run` entry invokes an optional provider adapter, which may require network or
GPU according to its policy. The adapter uses the file bundle described in
[provider-adapter.md](../references/provider-adapter.md).

## Integration handoff boundary

The intended consumer experience is to upload one UI reference and receive a
layered PSD. The recipient implements the web application and deployment; this
repository supplies the reusable Harness contracts and processing behavior.
Do not copy the Harness implementation into the service. Install the immutable
`ui-v0.2.3` Release wheel through the README's byte-count and published-digest
verification; a source checkout or Git ref is only for development.

| Responsibility | Harness scope | Recipient scope |
| --- | --- | --- |
| UI decomposition | Important-component policy, model proposal validation, grouping and reuse | Configure the provider and invoke the entry |
| Generation | Provider-neutral request/result protocol and bounded execution behavior | Configure the chosen providers and credentials |
| Image processing and PSD | Matte, resize, assembly, fingerprints and file roundtrip | Present artifacts and quality warnings |
| User experience | Stable machine-readable inputs, outputs and errors | Upload form, progress view and download links |
| Hosting | Runtime/dependency requirements and integration guidance | Containers, HTTP API, job queue, storage, access control and operations |

Web and container implementation is explicitly out of scope here. The automatic
planning and execution entry belongs to the Harness; it does not require the
recipient to copy these algorithms or use a logged-in desktop assistant.

## Released behavior

The published 0.1.2, 0.2.0, 0.2.1 and 0.2.2 releases, and the `0.2.3` release
candidate, have different capabilities:

| Capability | Status |
| --- | --- |
| Reference snapshot and starter plan | Implemented by `init`; it does not infer a full decomposition |
| Plan validation and immutable run | Implemented by `check` and `freeze` |
| Provider file handoff | Implemented by `adapter-export`, `adapter-seal`, `adapter-import`; no provider invocation is included |
| Explicit successful-result reuse | Implemented by `result-binding` and `reuse-result` |
| Processing and reviewed PSD output | Implemented by `process`, `review-template`, `finalize`, `export`, `inspect` |
| Image-only automatic planning | Implemented: configured vision provider produces a strictly validated proposal |
| Single unattended execution entry | Implemented: `auto-run`, with `job-status`, explicit budget and no automatic resubmission |
| Automated visual-quality gate | Implemented in 0.2.1; 0.2.2 adds explicit `strict` and `advisory` delivery policies plus a durable restart boundary; 0.2.3 changes only release-consumption documentation |
| Automatic unreviewed draft PSD output | `strict` delivers only after QA passes; an explicitly selected `advisory` policy can deliver a QA-warning PSD; human-reviewed default unchanged |

No image-to-PSD HTTP endpoint is implemented. The runner is usable as a per-job
CLI/library function. Its complete offline quality-gated path is verified with
provider doubles. The earlier bounded live end-to-end execution predates this gate,
so live provider accuracy is not established. Do not describe the draft output as a
human-validated reconstruction.

The automatic entry is deliberately limited to:

1. An image-understanding planning entry that produces the existing validated
   plan contract using a configured model. Default to important components,
   reusable families and removal of ordinary text; it does not reconstruct fonts
   or automatically guess nine-slice insets.
2. A headless per-job execution entry that orchestrates the existing commands
   and optional provider bridge, persists request identities, returns verified
   artifacts for repeated completed jobs and reports completion or failure. Partial
   job recovery remains explicit through the existing result-reuse commands. The recipient's queue
   schedules jobs; the Harness does not become a web server or queue platform.
3. An explicit draft-export policy for the unattended use case. It performs one
   bounded automated visual-quality assessment after processing and withholds the
   delivery on rejection. It records that no human visual acceptance occurred,
   preserves structural and integrity checks, and leaves reviewed export unchanged.
   Never simulate an accepted human review by editing `review.json` automatically.
4. A delivery-policy boundary for the quality gate. `strict` exposes a download
   only after `completed_visual_qa_draft`; an explicit `advisory` policy may also
   expose `completed_visual_qa_warning`, together with its visible QA receipt. A
   candidate preview, complete material batch or started QA request is never a
   delivery. After a restart, a `started_outcome_unknown` QA state is terminal and
   requires a new human decision; the service must not requeue, bypass or replace it
   automatically.

Further visual-quality tuning is deferred from this handoff scope. Successful
file generation must not be advertised as guaranteed visual reconstruction.

## Recipient acceptance checklist

Validate these conditions in the recipient's environment before promoting the
release. See [headless integration](headless.md) for exact commands, configuration
and known limitations:

- A deployment config selects image-understanding and generation providers and
  supplies secrets outside the plan and artifact tree. A service end user only
  needs to supply a UI reference under the deployment's documented defaults.
- Execution works without a logged-in desktop assistant. Provider-specific
  transport, reference count/size limits, polling and downloads are handled by
  an adapter with a clear failure contract.
- Submission authorization and budget limits are explicit and bound to the
  frozen plan. Restarting a job does not resubmit a possibly accepted request.
  A terminal or indeterminate provider failure is reported; recovery must follow
  the applicable provider policy and authorization, not an implicit retry loop.
- The service persists job state before each provider call. In `strict` mode it
  serves only `completed_visual_qa_draft`; in explicitly selected `advisory` mode it
  may serve `completed_visual_qa_warning` with a visible receipt outcome. It keeps
  `private/` inaccessible from downloads and treats
  `automated_visual_qa: started_outcome_unknown` as a terminal diagnostic state,
  even if all image-generation results exist.
- The receiving application gets task status, progress, structured failures and
  artifact locations. Its HTTP routes and storage implementation remain its own.
- A completed draft includes the PSD, layer assets, preview and automated quality
  receipt with an explicit unreviewed status. Missing required assets, an invalid
  quality assessment, a quality rejection, invalid fingerprints or failed PSD
  validation produce failure, not a successful download.
- Integration examples and verification cover the public runtime and fixtures;
  they do not depend on private operational scripts or a particular provider.

For the released reviewed flow, follow [the quickstart](quickstart.md) and
[the plan contract](../references/contract.md). For the automatic flow,
follow [headless integration](headless.md). Neither flow ships a web server or Docker image.
