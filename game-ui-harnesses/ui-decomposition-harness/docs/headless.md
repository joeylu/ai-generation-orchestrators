# Headless image-to-draft-PSD integration

Available in the published 0.2.2 release. The entry is an opt-in per-job
CLI/library function, not a web service.
Offline tests exercise the complete runner with provider doubles and real PSD
encoding. A separately authorized 0.2.0 live end-to-end check produced a
structurally verified draft PSD before this quality gate existed; it does not
establish general provider reliability or live visual-gate accuracy.

## Configuration and invocation

Install a built `ai-ui-decomposition[psd]` package in the recipient's environment.
For production, install the immutable 0.2.2 release and pin/verify its digest.
Do not reuse the 0.1.2, 0.2.0 or 0.2.1 releases for these commands.
Run `doctor` and `self-test`; both remain offline and consume no provider compute.

The deployment owns a trusted config file, outside the public artifact directory:

```json
{
  "kind": "ai_ui_decomposition_provider_config_v1",
  "factory": "ai_ui_decomposition.mcp_provider:create_provider",
  "options": {
    "vision_url_env": "UI_VISION_URL",
    "imagegen_url_env": "UI_IMAGEGEN_URL",
    "api_key_env": "MCP_API_KEY",
    "download_hosts": ["media.example.invalid"]
  }
}
```

Set `UI_VISION_URL` and `UI_IMAGEGEN_URL` to the deployment's HTTPS MCP endpoints
and `MCP_API_KEY` to its credential. These are environment variable **names**, not
literal credentials in JSON. Replace the example download host with the exact
host(s) used by that provider's image download URLs. No wildcards or redirects are
accepted. The credential needs both vision and image generation permissions.
Tool discovery alone does not prove either permission or sufficient quota.

Only administrators supply `factory`, options and environment. A factory imports
trusted Python code; never accept it, credentials or output paths from an upload
form. Other providers can implement the library's `Provider` interface without
changing plan, material or PSD contracts.

```text
ai-ui-decomposition auto-run --reference uploads/reference.png --job-dir jobs/request-001 --provider-config provider.json --max-generation-calls 16 --timeout-seconds 3600 --allow-provider-calls-and-unreviewed-draft
ai-ui-decomposition job-status --job-dir jobs/request-001
```

The explicit flag delegates **two vision calls and at most the stated generation
budget**: one call makes the plan and the second scores the completed candidate.
Do not add it unless the caller has authorized external processing of the image and
the compute budget. The recipient's end user can supply only an image once that
service has established the deployment defaults and consent. The Harness does not
implement that service.

`--visual-qa-policy strict` is the default. It withholds a PSD when the assessment
rejects, is malformed or cannot be obtained. A service operator may explicitly pass
`--visual-qa-policy advisory` to keep automatic delivery available during visual-QA
provider failures or rejections. Advisory mode still invokes the assessment exactly
once, never retries it and records its outcome; it returns
`completed_visual_qa_warning`, never a false pass. This choice is part of the
immutable job input, so it cannot be changed by re-running an existing job.

## Execution contract

1. Validate input bytes, EXIF-oriented size and PSD dependencies; create a fresh
   job record. Maximum canvas is 16,777,216 pixels and 30,000 per side.
2. Persist a planning reservation. Ask the provider for `assets`, `nodes`, `groups`
   JSON. The program supplies source identity, routes, text policy and draft policy;
   the model cannot override them or select files/providers. Reject malformed JSON,
   unknown fields, bad geometry, over-budget plans and incorrect background order.
3. Freeze the validated plan and persist authorization bound to its digest and
   batch digest. Generation budget is 1–32 calls; planner output has at most 256
   nodes. Default granularity is important components with same-size module reuse.
4. Reserve and dispatch each component once in order, seal the result and import
   it through the existing file protocol. Stop on the first error.
5. Process all materials and assemble a private candidate preview. Submit the
   original reference, candidate preview and material contact sheet to the vision
   provider for one strict JSON assessment. It evaluates layout fidelity, component
   coverage, text-policy compliance and cutout cleanliness. An `accept` must score
   at least 80 overall, at least 70 for every criterion and contain no blocker issue.
   The safe receipt has no free-form provider prose, task ID or endpoint details.
6. Under `strict`, a rejected, malformed or unavailable assessment stops with no
   delivery. Under `advisory`, the same outcome becomes a visible warning and the
   runner exports `ui.draft.psd`; it still reopens the PSD to verify pixels,
   positions, group structure and the composite. Both modes publish a safe
   `automated-visual-qa.json` outcome. Neither replans, regenerates or retries, and
   neither forges human review.

No automatic repair or generation retry occurs. A possibly accepted request remains
reserved/indeterminate after a crash. Known provider failures are also terminal for
this job. A repeated successful invocation verifies existing artifacts and returns
them with zero new calls; repeating any other started job is rejected. Successful
raw results remain available for an explicitly planned new run through
[result-binding and reuse-result](../references/provider-adapter.md#reuse-a-completed-raw-result-012).
This release does not automatically resume partial jobs or replan using cached
assets. Never delete a failed job to make its original request run again.

### Durable quality-gate handoff

A receiving web service must treat the quality gate as part of the same durable
job, not as an optional post-processing task. Persist the complete job directory on
a durable volume before dispatching either vision call. In `strict` mode, serve a
download only when `job-status` reports `completed_visual_qa_draft`. In explicitly
configured `advisory` mode, `completed_visual_qa_warning` is also deliverable but
must visibly carry the receipt outcome. Do not infer success from a candidate
preview, a material contact sheet, a PSD-like file, or all generation rows being
received. The candidate lives under `private/` precisely so it cannot be served
before the policy decision is recorded.

If a process dies after `visual-qa-started.json` is written but before a terminal
receipt, `job-status` reports both `started_outcome_unknown` and
`automated_visual_qa: started_outcome_unknown`. The vision request may already have
been accepted. Do not resume `auto-run`, submit a replacement assessment, skip the
gate, move the private candidate into `delivery/`, or silently convert that job to a
manual approval. Retain the directory for diagnosis and begin a separately
authorized logical request only after a human decision. The Harness deliberately
does not offer a service-side worker recovery shortcut.

`timeout-seconds` bounds provider waiting and is checked between processing stages;
it is not a hard process kill during local image/PSD work. Optional providers must
honor the supplied remaining timeout and must not retry internally. The recipient
owns hard process/resource limits and task scheduling. Killing a job is not proof
that its remote compute was canceled.

## Results and recipient responsibilities

`auto-run` writes JSON to stdout, exits 0 on completed draft and 2 on rejection or
failure. `job-status` is read-only; its exit code indicates query success, so inspect
the JSON `status` to determine job outcome. Possible states:

| Status | Meaning and action |
| --- | --- |
| `completed_visual_qa_draft` | The automated visual-quality gate, PSD and artifact hashes passed; serve the unreviewed draft with its limits |
| `completed_visual_qa_warning` | Explicit `advisory` policy delivered a structurally verified PSD after a rejected or unavailable visual assessment; show its receipt outcome |
| `failed_visual_qa` | The model rejected the candidate; retain its safe receipt and private evidence, do not serve a PSD or retry |
| `failed_no_resubmit` | Recorded stage/reason; no automatic retries; retain evidence for a new decision |
| `started_outcome_unknown` | No terminal receipt, potentially still running or crashed; do not resubmit, including an assessment that may already have reached the vision provider |

There is no liveness inference, worker lease, HTTP route or queue implementation.
During execution, `batch.rows` exposes prepared/reserved/received/indeterminate
component progress. A job not yet readable can be temporarily initializing; the
recipient should poll read-only, never infer permission to create a replacement.

Persist the entire job directory. Publish only the allowlisted `delivery/` files
and safe result metadata: PSD, preview, layer PNGs, scene, delivery, export and
automated visual-QA receipts. The terminal JSON records relative artifact locations
and hashes. Keep
`private/`, source images, proposals, request bundles and deployment configuration
out of public downloads. Private provider state contains submission IDs, task IDs,
input image bytes and raw MCP replies (which can include temporary signed URLs or
provider error details); protect it as source data. Raw replies are limited to
8 MiB each and retained before parsing. Do not package a whole job folder.
Use one fresh, application-assigned directory per logical request and prevent
parallel invocations for that request. Preserve evidence after restart.

`completed_visual_qa_draft` means the fixed model gate and structural checks passed.
It does **not** mean the model selected every important component, removed all text,
preserved all purple pixels through keying, or reconstructed hidden artwork correctly.
The gate is a delivery filter, not human visual acceptance or a fidelity guarantee.
Automatic plans do not guess nine-slice insets. PSD opening in the Photoshop
application is not validated; PSB writing remains unavailable. The reviewed
`finalize` route retains its human gate.

## Optional stateless MCP adapter

The supplied adapter matches a specific documented application-level async shape:
`tools/list`, `tools/call` of `vision` or `imagegen`, followed by `get_task` polling.
It is not a universal MCP client and does not implement session-based negotiation,
stdio transport, streaming partial plans or MCP native Tasks. It uses only the
Python standard library plus existing image dependencies; no desktop MCP install,
SDK login session or assistant process is required.

Vision input is `images` plus `instruction` (1–4096 characters with no leading or
trailing whitespace; checked locally before any request); completed
output is a `description` string containing either the exact planning JSON or the
fixed visual-QA JSON. Imagegen takes `prompt` and one `referenceImage`; completed
output includes `downloadUrl`, PNG MIME type, width, height and byte count. Inputs
are JPEG encoded below 2 MiB. For generation, the full reference and exact crop are
arranged on one evidence board. No image is sent to an endpoint not explicitly
configured by the deployment.

Before a business call, the adapter persists a UUID `submissionId` and full
arguments. It stores the returned `taskId`, polls within the deadline, verifies
download host/bytes/dimensions, and never follows redirects or sends API credentials
to a media URL. It accepts JSON or complete SSE JSON-RPC responses. It deliberately
does not automatically replay even if the server advertises idempotent submission.
Remote tool errors, JSON-RPC errors, unmatched response IDs and malformed JSON/UTF-8
have distinct sanitized error codes. They do not authorize a retry. When the first
RPC call fails, private `outcome.json` records that acceptance is not established;
the preserved request and raw reply support diagnosis without a second submission.
Provider-specific endpoint URLs, credentials and task identities never enter the
public plan or delivery receipt.

An adapter instance used solely to materialize a **previously frozen** plan may
omit its vision endpoint, because that path never calls `plan` or the quality gate.
`auto-run` always plans first and then performs visual QA, so it requires both
configured capabilities. Treat a missing vision endpoint as a local configuration
error, never as permission to infer, reuse or visually waive a plan.
