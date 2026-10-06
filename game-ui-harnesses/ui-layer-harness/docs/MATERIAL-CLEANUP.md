# Single material cleanup exchange

`ai_ui_layers.material_cleanup.prepare_cleanup(snapshot, expected_digest, output,
material_id, source_job, source_request_id=None)` prepares one fresh singleton edit
job. It never calls a model. The new snapshot must contain a singleton request
for the material and share the source plan, reference, visual policy, texture
bindings and compiled placements with the source snapshot. This works for a
panel or an individual child material when its foreign ownership catalog is
nonempty.

Explicit reuse and protected-background policies and their artifact digests
must also match the original snapshot. Reuse snapshots still prohibit ordinary
subset or prompt-variant acquisition jobs. A source-bound cleanup may select one
original foreground singleton; it cannot select a sheet or background request.
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

## Versioned direct deletion prompts

New preparations bind `cleanup.promptVersion=cleanup-delete-direct-v2` in the
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
versions fail. Preparation always uses v2 for a fresh job; it does not migrate
an existing job, modify a frozen runtime or resubmit a terminal attempt.

Offline tests verify all foreign members have deletion actions, foreign prose
cannot become drawing instructions, owned descriptions remain present, a fixed
historical v1 prompt digest is unchanged, and legacy jobs still replay. They also
reject catalog tampering and unknown versions. These checks establish compiler
and exchange behavior; they do not establish a successful visual cleanup.

A small next validation can use one fresh v2 job for one previously failed
material, sourced from its original received generation job. Inspect that result
for complete foreign removal and preservation of every owned object before
considering a second material. The fresh job requires its own bound compute
authorization and has maximum one call with no automatic retry. A retained
foreign object remains a failed cleanup and must not enter a replacement package.
