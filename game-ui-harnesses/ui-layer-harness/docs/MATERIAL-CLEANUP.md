# Single material cleanup exchange

`ai_ui_layers.material_cleanup.prepare_cleanup(snapshot, expected_digest, output,
material_id, source_job, source_request_id=None)` prepares one fresh singleton edit
job. It never calls a model. The new snapshot must contain a singleton request
for the material and share the source plan, reference, visual policy, texture
bindings and compiled placements with the source snapshot. This works for a
panel or an individual child material when its foreign ownership catalog is
nonempty.

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
