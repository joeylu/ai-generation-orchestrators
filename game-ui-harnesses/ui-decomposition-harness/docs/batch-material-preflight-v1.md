# Batch-end material preflight

New repository workflow jobs default to immutable option
`materialPreflight: "after-generation-v1"`. Explicit `per-image-v1` and old jobs
without this option retain immediate quality checks. The fixed DAG remains
generate → process → review → acceptance → deliver; batch quality is the first
operation of process, before any extraction or preview.

Both provider and file transports collect each single-use authorized request
before checking material quality. File integrity, source/request binding, budget,
decoding/resource limits and unknown outcomes remain immediate stop conditions.
No new generation permission, retries or replacement budget is implied.

The frozen batch records the selected mode. `received.json` records
`qualityStatus: "pending"`; file bridge `accepted.json` means transport receipt,
also explicitly marked pending. These records are never rewritten after quality
inspection. No pending source can be used through `cached.verified_result`.

`material_preflight.check_batch` requires every request to have arrived, verifies
raw fingerprints and strategies, and checks output Alpha/aspect, key background,
and board geometry for every material. Known quality failures accumulate instead
of stopping the loop. Integrity failures still abort immediately. The report lists
each material's errors and elapsed time, including all passing materials. A given
geometry checker may return its first failure; the report is not exhaustive image
semantics recognition or a visual acceptance decision.

Each immutable `quality.json` binds batch, asset, raw image and receipt hashes.
Verified extraction/reuse rejects missing, failed or changed quality evidence.
The process node returns a failed receipt with the aggregate report when any
material fails. No preview, review, Studio or delivery runs in that case. A passed
report only unlocks the existing processing and acceptance gates.

This mode requires a fresh job/freeze/authorization. Historical failed runs and
their unused request slots cannot be resumed by changing the option. All commands
and regression tests remain local; tests use fixture images and provider doubles.
