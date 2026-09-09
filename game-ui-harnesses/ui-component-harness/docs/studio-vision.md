# Studio semantic recognition

The observation-only deterministic path is documented in
[semantic compiler](studio-semantic-compiler.md). It uses a single model
observation and a disclosed neutral structural preview, with local corrections.

The local entry now selects `studio-semantic-vision.mjs`: one model observation,
deterministic neutral preview compilation, and local corrections. Set
`UI_VISION_ADAPTER` to the adapter's absolute filesystem path. This integration
was verified offline; it is not a new live recognition accuracy claim.
The previous `studio-mcp-vision.mjs` and experimental staged adapter remain
available. The staged adapter's first live evaluation regressed; see
[evaluation](../reports/intent-staged-live.md).
The subsequent semantic v0.2 [retest](../reports/intent-semantic-v2-live.md)
recovered to 13/20 original and 4/4 added samples, but retained regressions.

The experimental staged consumer flow is upload → semantic observation → contract generation
→ observation/contract binding → deterministic compiler → PixiJS canvas → motion comparison
→ selected bundle export. The browser no longer authors an Image or Button by
default. Existing saved v0.2 bundles can still be restored without a model call.

The local Vite development and preview servers expose `/api/ui-vision`. An
optional server module is selected with `UI_VISION_ADAPTER`. No credentials,
provider URLs or private task records are included in browser assets or bundles.
The public core and the deterministic CLI remain independent of this adapter.
See [two-stage protocol and limits](studio-staged-vision.md) for observation
binding and the bounded second task.

The single-stage MCP adapter remains `scripts/studio-mcp-vision.mjs`; the staged
adapter is `scripts/studio-staged-vision.mjs`. Configure either with
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
Single-stage recognition uses a flat v0.2 HTTP 200 response:

```ts
{ version: '0.2', sourceSha256: string, status: 'Ready', summary: string,
  classification: 'artwork' | 'text' | 'control' | 'composite',
  observedTypes: UiNodeType[], documentId: string, canvas: CanvasSize,
  styles: Array<ControlStyle & { id: string }>,
  nodes: Array<{ id: string, parentId: string | null, componentType: UiNodeType,
    styleId: string, props: object, layout: Layout }> }
// Or an explicitly non-renderable result:
{ version: '0.2', sourceSha256: string,
  status: 'Unresolved' | 'Custom-required', summary: string }
```

`props` contains all required component properties except `style`, with no
`children`. Every style is explicit and referenced by ID. Exactly one node has a
null parent; array order determines sibling order. A deterministic decoder checks
references, parent types, cycles and resource bounds, assembles the nested tree
and the required composite `children` arrays, then invokes the unchanged strict
compiler. It does not fill missing component properties or repair invalid JSON.

`observedTypes` inventories visible component semantics. Each declared type must
have a corresponding node. Whole-image output is allowed only for explicitly
classified artwork; a declared control/text/composite must retain its semantics.
An observed type must have a node with positive opacity throughout its ancestor
chain, preventing invisible controls from satisfying the inventory. This does
not establish visibility against arbitrary geometry or occlusion.
This consistency gate cannot independently establish that a model classified the
image correctly. A falsely self-consistent artwork classification still requires
external semantic evaluation. Runtime settings that are not observable remain
grounds for `Unresolved`, rather than guessed defaults.

Saved and third-party legacy v0.1 responses remain compatible:

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

The follow-up instruction explicitly distinguishes checkable squares, toggle
tracks, framed titled panels and selectable repeated list rows. It requires
globally unique node/option/item/tab IDs, direct-child Tabs content ownership,
and only referenced styles. Hidden tab content must produce `Unresolved` rather
than fabricated placeholder children. These instructions guide the model; they
do not replace the strict compiler or guarantee correct perception.

For flat responses, `observedTypes` must equal the complete set of emitted node
types in both directions. Decoder failures expose stable, allowlisted codes for
unknown parents/styles, cycles, multiple roots, unused styles and semantic
coverage mismatches. Recognition preserves these codes; contract-validation
issues are identified as `VISION_CONTRACT_INVALID`. The page distinguishes
semantic mismatch from incomplete component structure, keeps export disabled,
and does not submit another model request automatically.
