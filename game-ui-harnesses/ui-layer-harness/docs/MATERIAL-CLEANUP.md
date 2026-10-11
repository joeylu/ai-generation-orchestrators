# Single material cleanup exchange

For a missing or misplaced internal structure, explicitly select
`--cleanup-input-policy reference-only-owned-extraction-v1` together with
`--layout-contract`. This freezes `cleanup-reference-owned-appearance-v6`: the native
image inputs are exactly `[cleanup/reference-context.png, snapshot/reference.png]`.
Both are original-reference evidence. The old generated PNG remains sealed and
verified as provenance but is never sent to the image model. The original local
reference determines visible proportions, internal layout and canvas aspect;
the old generated canvas and geometry are not preservation targets. Every owned
member is reconstructed and every foreign member is excluded, with ordinary
text blank unless explicitly retained. At least one declared internal divider
or section-band target for this material is required. The policy, prompt and exact image order
are bound before authorization and reverified before dispatch.

```powershell
python game-ui-harnesses/ui-layer-harness/ui_layer.py prepare-material-cleanup --snapshot SNAPSHOT --snapshot-digest DIGEST --output FRESH_JOB --material-id MATERIAL --received-job OLD_JOB --layout-contract FROZEN_LAYOUT --cleanup-input-policy reference-only-owned-extraction-v1
```

Preparation performs zero compute and creates no authorization. The new mode
still allows one image call, no automatic retries, and requires fresh approval
bound to its new digest. A genuine reviewed return can use the same one-material
replacement path; sibling PNG bytes and original-coordinate placements remain
unchanged. Reference-only inputs do not guarantee visual success. Missing or
misplaced lines remain explicit warnings in warning-mode deliveries.

For an internal-structure repair, `prepare-material-cleanup` additionally accepts
`--layout-contract FROZEN_HOST_LAYOUT_CONTRACT`. It binds the reviewed reference,
placements and exact divider declarations to the new single-material edit job.
Without the explicit reference-only policy, the source and original context
remain the two image inputs; the appended tool
instructions require the declared line count/positions while preserving owned
bands, excluding foreign controls and leaving ordinary text blank. The new job
still needs fresh digest-bound approval, has one image request and no automatic
retry. Existing cleanup prompts and jobs without this binding are unchanged.

`ai_ui_layers.material_cleanup.prepare_cleanup(snapshot, expected_digest, output,
material_id, source_job, source_request_id=None)` prepares one fresh singleton edit
job. It never calls a model. The snapshot must contain a singleton request or
one unambiguous sheet member for the material and share the source plan, reference, visual policy, texture
bindings and compiled placements with the source snapshot. This works for a
panel or an individual child material when its foreign ownership catalog is
nonempty.

Explicit reuse and protected-background policies and their artifact digests
must also match the original snapshot. Reuse snapshots still prohibit ordinary
subset or prompt-variant acquisition jobs. A source-bound cleanup may select one
original foreground material; it cannot select a whole sheet or background request.
For a sheet member, the producer derives a single edit request from the frozen
asset and context reference, binds it as `cleanupRequest`, and rederives it at
load time. The snapshot, owner plan, sheet grouping and `generationMode=sheets`
remain unchanged. The one-material repair is an isolated edit request, not a
new full generation run or a change to `single` mode.
Its initial record is marked `cleanupRequired` before edit files are written.
Until the complete source binding and all six frozen files pass replay, loading,
authorization and dispatch reject the incomplete preparation. This marker is
retained in the final job digest. Historical complete cleanup jobs remain valid.

The source must be an actual `raw_received` request with a verified original
authorization, submission and receipt chain. A singleton defaults to
`source_request_id=material_id`. A sheet requires an explicit source request ID
and membership of the chosen material. Its source cell is cropped using the
existing candidate sheet partition without changing any retained pixel. The
lineage records the raw receipt, original sheet split and source box; this does
not turn a failed strict sheet extraction into a passed extraction.

To replace a prepared sheet member in an existing diagnostic package, explicitly
select `--cleanup-source-cell-policy prepared-owned-sheet-cell-v1`. It replays
the existing alpha-floor preparation and nearest unique transparent seam
partition, keeping every pixel with alpha greater than one unchanged. It binds
the sheet receipt, exact member box, preparation evidence and encoded member
SHA-256; adapted members are unsupported. The replacement package must match
that member fingerprint, rather than mistakenly comparing a whole-sheet hash
with a member hash. Missing or ambiguous seams still stop this repair
preparation before compute. Historical jobs without this option retain their
exact original source-cell behavior.

The ordinary `ui_experimental_image_job_v1` receives an additional `cleanup`
binding before authorization. Frozen files include the edit source PNG, original
local context PNG, ownership inputs, schema, prompt and source lineage. The
first image is the polluted output; the second determines the original owned
body contour, aspect ratio and relative layout. The catalog lists every owned
and foreign object. Context target boxes and placement source regions locate
ownership; they are not measured body boxes. The edit preserves owned visual
identity, decorations, holes, texture and continuous alpha, removes foreign
artwork and ordinary business text, and permits correcting an incorrect body
shape from the original reference. No object is moved automatically.

```powershell
python game-ui-harnesses/ui-layer-harness/ui_layer.py prepare-material-cleanup --snapshot SNAPSHOT --snapshot-digest DIGEST --output FRESH_JOB --material-id MATERIAL --received-job OLD_JOB --request-id OLD_REQUEST
```

Continue with the existing executor `authorize`, `next`, and `receive` commands.
Authorization must bind the new job digest. `load_job` and
`frozen_request_arguments` replay source identity, input hashes, deterministic
catalog/prompt/context production and the exact sheet crop. A changed input or
source blocks dispatch. Maximum calls is one, automatic retries is zero, and an
unknown result never resubmits. The old job, source reference and receipts are
preserved. Cleanup is acquisition only; receipt does not grant visual acceptance
or promote an existing delivery DAG. A cleanup job cannot be its own recursive
cleanup source.

Offline regression coverage: `python -m unittest discover -s tests -p
test_material_cleanup.py`. Fixtures create PNGs and exchange receipts locally;
they never call generation tools or private services.

## Ownership-first deletion prompts

Default preparations bind `cleanup.promptVersion=cleanup-owned-appearance-v5`.
Generation v10 and cleanup v5/v6 share an owner-only appearance projection.
When a clause explicitly describes assembly or occlusion by an identified
foreign object, the model-facing KEEP excludes that suffix. Other owned clauses,
object IDs, instances, locators, text policy and source catalogs remain intact.
Ambiguous prose and relationships to separately listed KEEP members are not
silently erased. Fresh M1 instructions require labels to describe owned artwork
only, expressing separate parts through their own declarations and coordinates.

DELETE includes a short visual noun phrase from the foreign label (for example,
`white circular knob`) as well as its exact owner/object ID and locator. Only a
bounded nominal head is used; foreign drawing/preservation instructions are
excluded. A missing or unsafe head falls back to the readable object ID. This
is a limited deterministic projection, not a semantic model or an erase mask.
The source catalog is still frozen unmodified and replayed before dispatch.

The new prompt explicitly requests the complete owned substrate through a
removed overlay's footprint, with no foreign disk, outline, shadow or recess.
It does not change image inputs, add generation/review calls, retry a failed
result or guarantee visual removal.

Historical `cleanup-ownership-first-v3` retains its exact original rendering:
deletion takes priority over reference copying and even an owned description
that mentions an assembled control. Each foreign member retains its owner,
object ID, depth relation and normalized reference locator. Foreign appearance
prose remains frozen evidence and is never sent as a drawing instruction.

Generation v8 and cleanup v3 share the same priority and removal rules.
Overlay removal continues the existing owned surface; underlay removal omits
the foreign parent backing and preserves genuine owned gaps. Same-depth removal
does not invent hidden owned artwork. This also governs a child fill that must
exclude its parent track. Locators remain coordinates, never erase masks.

Historical v1, v2, v3 and reference v4 prompts replay unchanged. New preparation uses v5/v6 and
does not migrate old jobs. Actual PNG inspection must establish foreign removal
and owned preservation before a result can be accepted; prompt replay alone is
not visual evidence.

## Historical direct deletion prompts

Earlier preparations bound `cleanup.promptVersion=cleanup-delete-direct-v2` in the
job digest. Each foreign catalog member produces one direct `DELETE` action
using readable identifier words and its exact material/object ID. Foreign
appearance descriptions, relation details and JSON geometry are excluded from
the model prompt. Some foreign appearance descriptions contain their own
"preserve" instructions; repeating them in an edit prompt can conflict with the
intended removal. The full unmodified catalog, including those descriptions
and locations, remains frozen in `inputs.json` and continues to participate in
hash and deterministic replay verification.

Owned appearance descriptions form the sole positive `KEEP` list. The original
context image determines only the owned body shape and relative layout; its
foreign children must not be copied into the result. Deleting a foreign card
includes its frame, contents, shadow and text, then reconstructs the underlying
owned surface. It does not leave an empty card or create a new hole.

Historical jobs with no prompt version retain `cleanup-catalog-v1` replay with
the original prompt bytes. Explicit v1 bindings also replay that format. Unknown
versions fail. Historical v2 jobs retain that format; preparation does not migrate
an existing job, modify a frozen runtime or resubmit a terminal attempt.

Offline tests verify all foreign members have deletion actions, foreign prose
cannot become drawing instructions, owned descriptions remain present, a fixed
historical v1 prompt digest is unchanged, and legacy jobs still replay. They also
reject catalog tampering and unknown versions. These checks establish compiler
and exchange behavior; they do not establish a successful visual cleanup.

A small next validation can use one fresh v5 job for one previously failed
material, sourced from its original received generation job. Inspect that result
for complete foreign removal and preservation of every owned object before
considering a second material. The fresh job requires its own bound compute
authorization and has maximum one call with no automatic retry. A retained
foreign object remains a failed cleanup and must not enter a replacement package.
