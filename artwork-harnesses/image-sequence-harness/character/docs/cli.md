# CLI workflow

Examples use an existing task workspace `job` and digest/ID variables returned
by the CLI. Paths supplied to task commands must remain inside that workspace.
Keep task workspaces separate from the Harness source. `init` creates an ignored,
private-by-default workspace and refuses a nonempty directory.

## 1. Plan without compute

```powershell
ai-character-image-sequence init --root job
# Put reference.png in job and edit job/request.json.
$planned = ai-character-image-sequence plan --root job --request request.json | ConvertFrom-Json
$plan = $planned.plan_digest
```

The reference is snapshotted unchanged and fingerprinted. Opaque reference art is
valid and must go through cloud reference removal. Source input must be
PNG/JPEG/WebP and no larger than 16 MiB; the reviewed foreground used for generation
must fit the service's 2 MiB limit. There is no automatic compression or model
download. Choose four ordered action phases; each
phase occupies four consecutive poses. The Agent proposes phases from the user's
action intent; the runtime does not infer complex semantics from keywords.

The first plan is a preparation draft (`reference_preparation_required`) and
cannot authorize generation. Inspect `.character-image-sequence/plans/<digest>.json` before compute. It binds
the actual reference bytes, prompt, source dimensions, delivery dimensions and
timing. Changing any of these produces a new plan digest.

## 2. Private MCP configuration

Copy the *shape* in `examples/adapter.example.json` to
`job/.character-image-sequence/adapter.json`. Set the two actual HTTPS MCP service
addresses from your service contract in this private file. `key_env` names an
environment variable populated through your normal secret-management mechanism;
the config must not contain a key value. No global configuration is modified.

The adapter implements stateless HTTP JSON-RPC with JSON or SSE responses,
protocol version `2025-11-25`, Bearer authentication, tool-name discovery and
application-level queued tasks. It selects `imagegen`, `remove_background_image`
and `get_task` by name. It never invokes management or API-key administration APIs.

```powershell
ai-character-image-sequence doctor --root job --config .character-image-sequence/adapter.json --operation generate
```

`ready` means local configuration and the environment variable are present. It
does not mean the remote service or a particular generation model was verified.
The supplied service contract does not allow the client to select or query the
image-generation backend/model. Do not put a model override in config.

An optional live preflight performs only MCP tool discovery and input-schema
validation. It never calls a business tool or submits media:

```powershell
ai-character-image-sequence probe --root job --config .character-image-sequence/adapter.json --operation generate
ai-character-image-sequence probe --root job --config .character-image-sequence/adapter.json --operation matte
```

## 3. Prepare and review the reference

The first plan reports `reference_needs_cloud_matte`. A nonempty PNG/WebP with at
least 1% edge-connected transparent area is eligible for reuse, but still requires
visual inspection. An opaque alpha channel does not qualify. A transparent PNG
with residual background can explicitly use `reference_mode: "cloud"` in the
request. An existing cutout can be canonicalized locally without removal or a
cloud call; this supports palette transparency, WebP and EXIF orientation:

```powershell
ai-character-image-sequence prepare-reference --root job --plan $plan
```

Inspect the resulting RGBA PNG. Only format/orientation and zero-alpha RGB are
normalized; alpha and subject content are preserved. Opaque images cannot use this
command to bypass cloud removal.

When cloud removal is required, after user authorization:

```powershell
$refAuth = ai-character-image-sequence authorize --root job --plan $plan --operation reference-matte --config .character-image-sequence/adapter.json --confirm | ConvertFrom-Json
$refTask = ai-character-image-sequence submit --root job --plan $plan --operation reference-matte --config .character-image-sequence/adapter.json --authorization $refAuth.authorization | ConvertFrom-Json
ai-character-image-sequence poll --root job --plan $plan --config .character-image-sequence/adapter.json --attempt $refTask.attempt_id
```

Respect the returned delay. The cloud result must preserve the original EXIF-oriented
dimensions, retain the subject and have exterior transparency. Inspect the original
and the resulting `.character-image-sequence/runs/<draft>/reference.png`; for an
existing cutout inspect the original instead. Approve only after actual inspection:

```powershell
ai-character-image-sequence review --root job --plan $plan --stage reference --decision approved --reviewer human-or-agent-reviewer --note 'Compared original and foreground including holes and soft materials' --check identity --check complete_subject --check background_removed --check holes_and_soft_materials
$planned = ai-character-image-sequence plan --root job --request request.json | ConvertFrom-Json
$plan = $planned.plan_digest
```

The program publishes `ai_reference_preparation_handoff_v1` plus its preparation
report and binds them, the review digest, original fingerprint and foreground
fingerprint into a new plan. Generation now sends the reviewed foreground, never
the original opaque image. The old draft remains immutable. Changing preparation
evidence invalidates downstream authorization. The handoff format matches the
video reference contract without a runtime dependency on the video package.

To reuse this reviewed foreground for another motion in the same workspace, put
the returned handoff path into the new request as `reference_preparation_handoff`.
The new plan verifies the original-reference fingerprint, handoff, preparation
report and prior review before binding them. It does not repeat reference matte
compute or reference review. Reuse is explicit; the runtime never silently chooses
between multiple preparations.

## 4. One authorized generation

Only after the user explicitly approves this plan's generation compute:

```powershell
$auth = ai-character-image-sequence authorize --root job --plan $plan --operation generate --config .character-image-sequence/adapter.json --confirm | ConvertFrom-Json
$queued = ai-character-image-sequence submit --root job --plan $plan --operation generate --config .character-image-sequence/adapter.json --authorization $auth.authorization | ConvertFrom-Json
```

Wait `poll_after_seconds`, then query the same attempt. Each invocation does one
query and exits; it does not start a worker or a background polling service.

```powershell
ai-character-image-sequence poll --root job --plan $plan --config .character-image-sequence/adapter.json --attempt $queued.attempt_id
```

Repeat only `poll` while queued/running. If the initial submission response is
already completed or failed, `submit` persists that terminal state immediately.
A completed image is taken from the MCP inline PNG block; byte count, format and
square aspect ratio are verified before publishing the raw artifact. Its dimensions
do not need to equal `board_size`. No signed download URL is persisted or downloaded.

For an already existing board, skip generation entirely:

```powershell
ai-character-image-sequence import-raw --root job --plan $plan --image existing-board.png
```

This records imported provenance and does not invent a paid generation attempt.

## 5. Inspect the raw board, then authorize cloud removal

Inspect the original reference and
`.character-image-sequence/runs/<digest>/raw.png`. Check the entire board, not
only the first cell. Approve only after visual inspection:

```powershell
ai-character-image-sequence review --root job --plan $plan --stage raw --decision approved --reviewer human-or-agent-reviewer --note 'Inspected reference and all 16 source cells' --check identity --check sixteen_complete_cells --check pose_order --check no_crop_or_cross_cell_leak
```

Record `--decision rejected` with the reason if unsuitable. A rejection is
immutable. Revise the request into a new plan or use a fresh workspace for a new
source attempt; do not overwrite the review to manufacture success.

After explicit user approval of cloud removal:

```powershell
$matteAuth = ai-character-image-sequence authorize --root job --plan $plan --operation matte --config .character-image-sequence/adapter.json --confirm | ConvertFrom-Json
$matteTask = ai-character-image-sequence submit --root job --plan $plan --operation matte --config .character-image-sequence/adapter.json --authorization $matteAuth.authorization | ConvertFrom-Json
ai-character-image-sequence poll --root job --plan $plan --config .character-image-sequence/adapter.json --attempt $matteTask.attempt_id
```

Wait the indicated delay between queries. Removal accepts at most 16 MiB of
source PNG. `maskOnly` is always false. Optional model, operating resolution and
foreground refinement parameters are passed unchanged. Do not assume all model
and operating-resolution combinations are supported by the cloud backend.
The matte result must preserve the raw board's actual pixel dimensions exactly.

## 6. Deterministic processing and candidate review

```powershell
ai-character-image-sequence process --root job --plan $plan
ai-character-image-sequence inspect --root job --plan $plan
```

If the source board differs from `board_size`, processing first resizes the whole
square board once to that canonical size, records both dimensions and then performs
fixed 4x4 slicing. `alignment_mode` defaults to `none`. `bottom_y` detects each
frame's lowest foreground band and translates only Y to the selected reference
frame's baseline; X remains unchanged. `bottom_center` translates both X and Y to
the reference contact anchor. Both modes record every integer `dx/dy`, retain
`source-frames/`, and fail if content would be clipped.

Use `bottom_y` by default for grounded idle, planted casting and stationary attacks.
Use `bottom_center` only when horizontal foot-contact locking is also intended. Use
`none` for intentional vertical travel such as jump, fall, knockback or hover. Walk
and run require review of both previews because alignment can stabilize contact
while also flattening intended body bob.

After raw review, an already-transparent raw board can be compared without matte
compute or formal delivery:

```powershell
ai-character-image-sequence preview-align --root job --plan $plan
```

This creates immutable gray-background before/after GIFs under the private run
directory. It is explicitly an unverified preview; `process` still requires the
normal matte evidence and candidate review gates.

For actions that need explicit mechanics, `pose_blueprint` may contain exactly 16
frame responsibilities. They are compiled into the generation prompt in reading
order. `timing_weights` may contain 16 positive integers; they change preview and
delivery frame durations without changing total `duration_ms`. Omitting either
field preserves the four-phase, equal-timing behavior.

Inspect the generated `candidate/review/light.png`, `dark.png` and `checker.png`,
the candidate atlas and GIF, then check individual PNG frames. In particular inspect
enclosed background holes, retained
hair/translucent materials, all instances, pose order, loop/terminal pose and
actual grounding. Numeric alpha checks cannot prove semantic correctness.

```powershell
ai-character-image-sequence review --root job --plan $plan --stage candidate --decision approved --reviewer human-or-agent-reviewer --note 'Inspected PNG edges and holes, all poses, and playback' --check identity --check action_readability --check pose_order --check loop_or_terminal_pose --check all_instances_preserved --check interior_holes_and_soft_materials --check edge_quality --check scale_and_anchor
ai-character-image-sequence deliver --root job --plan $plan --out delivery
ai-character-image-sequence validate --directory job/delivery
```

The destination must be new and inside the task workspace, outside its private
runtime directory. A staged package is validated before publication. It contains
the 16 output PNGs, atlas, optional GIF and neutral manifest. A bottom-center plan
also includes the 16 unaligned source frames and an unaligned GIF for audit. The public manifest
records accepted review criteria and candidate digest, not reviewer notes, private
paths, task receipts or credentials. Hashes are integrity evidence, not signatures
or proof of an independently authenticated reviewer.
The review sheets and diagnostic JSON remain private review aids and are not copied
into the delivery package. `inspect` reports approved, rejected and pending review
states without converting a recorded rejection into a generic command failure.

## Failure and continuation

- A lost submission receipt is `indeterminate`. Do not repeat the business tool
  or reuse the authorization. The immutable full request and UUID remain private.
  Even though the cloud contract describes same-ID recovery, its mapping expires
  and can be lost on server restart. This version deliberately never replays a
  business submission automatically.
- A received task ID is polled only with `get_task`. A transient query error leaves
  the receipt intact, so the same query can be repeated. Server failure or an
  expired/lost task needs operator inspection; never assume that means no compute.
- A new user decision can authorize a new attempt with
  `authorize ... --confirm --retry-after <prior-terminal-attempt-id>`. This is a new
  call with a new UUID and may spend compute again. Pending known tasks cannot be
  replaced this way.
- `mcp_client_access_denied` indicates a service-edge client-signature block. Ask
  the service owner to allow the legitimate CLI client. Do not rotate client
  signatures, spoof a browser or resubmit around that access restriction.
- A process crash can leave `operation.lock`. Stop competing clients and inspect
  receipts before manually removing that one lock. The CLI never steals a lock or
  starts another process to recover it.
- Already published, fingerprint-current output can reconcile a missing terminal
  record through `poll` without a cloud call. An orphan PNG without its receipt is
  blocked for manual inspection.
- `process` may be repeated from unchanged accepted source evidence and checks an
  existing candidate instead of overwriting it. Failed staging directories remain
  private diagnostics. No local fallback repairs missing content or poor alpha.

## Import a producer-authored cloud matte handoff

For a host that already called the cloud MCP, its deterministic producer can
materialize a handoff with the shape in [contracts.md](contracts.md), then run:

```powershell
ai-character-image-sequence import-matte --root job --plan $plan --handoff cloud-handoff.json
```

The Agent must not author a handoff to make arbitrary local output appear to be a
cloud result. The importer verifies the source/result fingerprints and dimensions,
records imported provenance, and still requires raw and final visual review.
