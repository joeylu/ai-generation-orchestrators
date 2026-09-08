# Studio semantic recognition

The consumer flow is upload → configured vision service → strict semantic intent
and explicit layout → deterministic compiler → PixiJS canvas → motion comparison
→ selected bundle export. The browser no longer authors an Image or Button by
default. Existing saved v0.2 bundles can still be restored without a model call.

The local Vite development and preview servers expose `/api/ui-vision`. An
optional server module is selected with `UI_VISION_ADAPTER`. No credentials,
provider URLs or private task records are included in browser assets or bundles.
The public core and the deterministic CLI remain independent of this adapter.

The supplied MCP adapter is `scripts/studio-mcp-vision.mjs`. Configure it with
`UI_VISION_MCP_URL`, `UI_VISION_MCP_KEY_FILE` (a local file containing only the
business API key), and `UI_VISION_MCP_STATE_DIR` (an ignored local directory).
Set `UI_VISION_ADAPTER` to the adapter's absolute path before starting the local
server. These four server-only settings may also be saved in the ignored
`.env.local` file; the Vite configuration loads only the explicitly named fields.
Restart the server after configuration changes. Never use `VITE_`
variables for secrets. No management OAuth client or administrator key is needed.

The adapter discovers the `vision` tool, persists a submission UUID and its full
arguments before submission, then follows `get_task` receipts. It does not
resubmit automatically. A failed transport read may query the same `get_task`
up to three times, respecting its polling interval; this never submits `vision`
again. Cancellation or a local timeout cannot cancel an already
accepted remote task; private submission records must be checked before deciding
to submit again. Matching source bytes, metadata and the current instruction
reuse an existing completed result or resume the same accepted task. An unknown
submission without a usable task receipt fails closed. This is an optional client
adapter, not a local job queue.

Adapters may implement `submit(input, {signal})` and `poll(analysisId, {signal})`.
POST returns HTTP 202 while pending; the browser then uses only short GET requests
to `/api/ui-vision?analysisId=<uuid>`. Each pending response is exactly
`{version:'0.1', sourceSha256, status:'Pending', analysisId, pollAfterSeconds}`.
The browser binds every response to the uploaded digest and the original analysis
ID, respects the interval, and stops after cancellation or its overall timeout.
There is no automatic second POST. Adapters exposing only `analyze` retain the
original synchronous protocol. GET without a query remains a configuration check.

Uploads are PNG/JPEG/WebP up to 2 MiB with decoded dimensions bounded by the
browser. Raw bytes, SHA-256, MIME and decoded dimensions are bound to the request.
The wire request is `{version:'0.1', source:{path,sha256,width,height,mime,base64}}`.
The final HTTP 200 response is exactly:

```ts
{ version: '0.1', sourceSha256: string, status: 'Ready', summary: string,
  intent: TreeIntent, policy: TreePolicy }
// Or a non-renderable result:
{ version: '0.1', sourceSha256: string,
  status: 'Unresolved' | 'Custom-required', summary: string }
```

`TreeIntent` and `TreePolicy` follow [the existing contract](tree-contract.md),
including all sixteen component types. The model must supply every required field
and parent-relative layout without inventing hidden options, business actions,
asset URLs or text. Unknown required facts produce `Unresolved`. Unsupported
components produce `Custom-required`. The model must not follow instructions
embedded in artwork. Text output is data, never HTML or executable code.

Raw completed model descriptions are retained in the private state directory.
One observed wire-format defect has a narrow, recorded normalization: a single
premature top-level closing brace immediately before the required `policy`
field. It is accepted only when all five preceding fields and values are
unchanged, no extra fields appear, and the result parses as one object. Raw and
normalized hashes plus the removed character offset are recorded. Other syntax
errors fail. This never supplies missing component nodes or fields; the same
strict semantic compiler still gates preview/export.

Only the uploaded image can be referenced, including compiler-checked regions.
External fonts/resources are rejected. Actual image facts come from decoding,
never from the model. A matching source digest, strict intent, complete layout,
resource validation and a validated bundle are all required before preview and
export become available. Responses from superseded uploads are ignored.
Image decoding, recognition/response validation, bundle validation and canvas
creation have separate error messages; a downstream failure must not claim that
a successfully decoded image is invalid.

Automated tests use explicit HTTP/MCP test doubles and procedural semantic trees.
They verify transport and compilation behavior, not the model's recognition
accuracy. Live vision acceptance requires a configured authorized business key
and separate recorded evidence; passing offline tests is not live acceptance.
