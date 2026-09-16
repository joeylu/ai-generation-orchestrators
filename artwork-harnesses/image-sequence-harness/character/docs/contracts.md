# Contracts and implementation boundaries

## Request and plan

The packaged `request.schema.json` is authoritative for request shape. Layout is
not a request option: one square source image, 4 columns, 4 rows, 16 row-major
frames. There are no alternate source strategies or multiple action states.

The generation prompt asks for a preferred canonical size, complete padded cells,
consistent identity/scale/camera and four explicit action phases. Pixel size is a
model request, not an acceptance constraint: any square PNG within the existing
encoded-byte limit is accepted.
Raw review is required before cloud matte.

The immutable plan digest includes the reference fingerprint, action text, phases,
compiled prompt, duration, loop mode, board dimensions and output policy. Cloud
config is separate and private. Each authorization binds its configuration digest,
plan digest, exact input fingerprint and, for matte, the raw review digest.

Plan v2 first creates a preparation draft. Ordinary inputs go to
`reference-matte`; already-cut PNG/WebP images can skip that call only after exterior
transparency checks. Both routes require a reference review. The deterministic
producer publishes `ai_reference_preparation_handoff_v1` containing original,
foreground and preparation-report fingerprints, a producer result digest and a
canonical `handoff_sha256`. This is the same neutral wire format consumed by the
video Harness; no sibling runtime is imported or modified. `prepare-reference`
normalizes an existing cutout to oriented RGBA PNG without segmentation or alpha
changes, so the handoff always contains the canonical PNG expected by that contract.

Replanning binds that handoff and its visual-review digest into a new final plan.
Generation is blocked for preparation drafts and only uses the foreground bytes
of a final plan. Input originals are retained; a stale source, report, foreground
or review blocks reuse. Cloud reference removal validates the original dimensions,
not the unrelated generated-board dimensions.

A later request may explicitly name a prior `reference_preparation_handoff` from
the same workspace. The runtime reloads its original draft, report, review and
foreground, verifies that the new original-reference SHA-256 is identical and then
binds the existing evidence into the new motion plan. Reuse is never selected
implicitly and never weakens the visual review.

Generation layout and delivery layout are both 4x4 here, but frame size is separate.
There is no inherited video timestamp, native video FPS, source decode or video
handoff. PNG timing is explicitly authored from the requested action duration.

## Cloud MCP adapter

The adapter follows the supplied public caller contract; the key-management
document is outside this runtime's scope. Endpoint values remain external private
configuration. Only the following three tools are used:

| Tool | Submitted fields |
| --- | --- |
| `imagegen` | `submissionId`, `prompt`, `referenceImage: {mimeType, data}` |
| `remove_background_image` | `submissionId`, `image: {mimeType, data}`, `maskOnly: false`, optional `model`, `operatingResolution`, `refineForeground` |
| `get_task` | `taskId` |

No provider, backend model selector, API-key selector, native MCP `task`, `ttl` or
`pollInterval` is injected. `tools/list` is validated by tool name, then its input
schema checks the submitted object. A business request is never retried by the
transport or runtime. HTTP redirects are refused so a Bearer credential cannot
be forwarded to another location.

Both `reference-matte` and board `matte` use the configured `matte` endpoint and
the same removal tool, with separate inputs, authorizations and receipts. HTTP,
TLS, DNS and connection-refused errors use distinct safe technical codes.

The complete parameters and UUID are fsynced in `submission.json` before sending.
Received task ID and delay are saved in a separate immutable receipt. Subsequent
observations append new records; they do not rewrite successful or failed states.
Network errors expose a fixed technical code, never raw exception text, URL or
response bodies. Queued/running tasks remain pending; `poll` respects the service's
delay and only queries `get_task`.
An initial `completed` or `failed` business response is consumed immediately by
`submit`; only queued/running states require `poll`.

A successful task must have an inline image block plus authoritative metadata
under `structuredContent.result`. The image must be one PNG with the expected
byte count, actual dimensions and, for matte, `output: foreground`. The contract
includes this inline PNG, so temporary download links are unnecessary. Rejected
decoded outputs are retained in the private attempt directory when available.
Generation output must be square but need not equal the preferred `board_size`.
Board matte output must exactly preserve the reviewed raw board's actual dimensions.

The contract does **not** guarantee that whole-board background removal preserves
all 16 instances, holes or materials. Actual dimensions and nonempty cells are
checked locally; semantic preservation is a mandatory visual review criterion.
Until an approved real run verifies these, cloud compatibility means protocol
implementation plus test doubles, not a production-quality claim.

## Imported cloud matte evidence

This document is produced by the caller's deterministic cloud adapter, not by the
Agent. Paths are workspace-relative. The `source_sha256` must match the reviewed
raw board; `result` refers to the exact downloaded PNG bytes.

```json
{
  "schema": "cloud_matte_handoff_v1",
  "producer": {"kind": "cloud_mcp"},
  "source_sha256": "64 lowercase hexadecimal characters from the raw board",
  "result": {
    "path": "input/cloud-foreground.png",
    "sha256": "64 lowercase hexadecimal characters from the foreground PNG",
    "bytes": 12345
  }
}
```

This is a neutral integrity handoff, not a fabricated internal attempt log or a
signed attestation of provider identity. Imported output still undergoes all
local gates and the digest-bound semantic review.

## Acceptance

Local hard failures include a non-square raw board, matte/raw dimension mismatch,
missing/opaque frames, content
touching cell boundaries, a static sequence, an identical repeated terminal pose
in a loop, checksum mismatch, wrong frame ordering, inconsistent source mapping,
stale reviews, incorrect atlas contents and an invalid requested GIF timeline.

Before slicing, a source square that differs from `board_size` is resized once as
a whole to the canonical square. The default mode never independently aligns or
normalizes cells. An immutable plan may explicitly select `bottom_y` or
`bottom_center`; after fixed slicing it translates complete frames so the detected
ground-contact baseline or full anchor matches the selected reference frame.
`bottom_y` always records `dx = 0`. It retains all unaligned frames, records the
threshold, source/output anchors and integer `dx/dy`, and fails if translation would
clip content. Native and canonical dimensions plus the normalization and alignment
evidence are persisted in `character_image_candidate_v2`.

Coverage, per-frame bounding boxes and soft-alpha counts are persisted for review.
The runtime anchor remains the bottom center of each output cell; optional alignment
uses the lowest foreground band only as deterministic translation evidence. Actual ground contact, pose
identity, subtle residual background and appropriateness of repetition cannot be
certified by these numbers. They require the explicit recorded review criteria.
This version has no `relaxed` or `best_effort` quality policy.

GIF centisecond quantization uses rounded cumulative frame boundaries, preserving
the total duration. Each decoded interval must match the expected quantized PNG
preview. The encoder may merge identical holds; the authoritative PNG frame count
remains exactly 16. All alpha values below 255 are transparent in GIF; continuous
alpha is retained only in the PNG source and atlas.

Optional `pose_blueprint` and `timing_weights` are immutable plan inputs. A pose
blueprint has exactly 16 non-empty entries. Timing has exactly 16 positive integer
weights; deterministic cumulative allocation preserves the requested total GIF
duration and candidate records retain the exact rational per-frame timeline.

The private candidate records `build_state: awaiting_semantic_review`; this names
the state at deterministic build time rather than the final acceptance decision.
Private light, dark and checker review sheets plus frame diagnostics bind to its
digest but are excluded from delivery. The immutable public
delivery manifest wraps that candidate evidence with `status: accepted` and a
matching review digest binding. Consumers use the outer delivery status; they
must run `validate`, which rechecks checksums, alpha, frame order, timing, atlas
contents, GIF and the exact allowed package file set.

## Deliberately removed from the old package

No multi-layout selection, video route, multistate pack, pose-board recovery,
local segmentation/chroma/defringe, automatic resubmission, DAG worker scheduler,
web delivery policy, runtime Pixi integration or deployment machinery is included.
The implementation is new, rather than a copied production directory.
