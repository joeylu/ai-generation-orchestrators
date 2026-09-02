# Provider file-adapter protocol

`adapter-export` creates one immutable directory containing:

- `handoff.json`: digest-bound request identity and file inventory;
- `request.json`: provider-neutral request and plan digest;
- `prompt.txt`: the exact prompt;
- `input/reference.png`: the oriented full reference snapshot;
- `input/crop.png`: the exact source-region crop.

The external adapter may read these files and submit at most one provider call.
It must not change any bundle file. The core never receives an endpoint, API key,
workflow path, model path, or provider job identifier.

After a successful call, use `adapter-seal --source <image>` to copy and validate
the result and create `result.json`. `adapter-import` verifies every request and
result digest before materializing the raw image in the run.

If submission may have succeeded but the result is unavailable, do not seal a
placeholder and do not resubmit. Run `indeterminate` against the original run and
asset. A new attempt requires a new run and user decision.

The file protocol works across a local process boundary, mounted container
volume, removable media, or a service bridge. Transport does not change the
request identity or retry rules.

## Reuse a completed raw result (0.1.2+)

`result-binding --run-dir <original-run> --asset <asset>` is read-only. It verifies
the original frozen request, reservation, receipt, decoded image evidence and raw
SHA-256, and returns `source_batch_digest`, `source_request_digest`, `raw_sha256`.
Copy that object verbatim into the target asset's optional `cached_result` field
**before freezing a new plan**. This is supported only on generated routes.

After freeze, run:

```text
ai-ui-decomposition reuse-result --run-dir new-run --asset scene --source-run original-run --source-asset scene
```

This copies the verified raw image and writes a distinct `reused.json` receipt
with `generation_calls: 0`. It creates no reservation or provider job. `status`
counts `reused` separately; `maximum_calls` excludes cached assets. Missing cache
imports block processing. Cached assets cannot use `reserve` or `adapter-export`.

Reference pixels, role, route, source region, output mode, requested size and
prompt must match the original generation. Node positions, grouping and explicit
post-processing `resize` may change. A changed prompt needs a new generation,
not a cache hit. An unfinished or indeterminate result is never reusable. Use the
original received result as the source, not a chain of reused receipts.

No source directory, provider endpoint or job ID enters the new receipt: only
digests and image evidence. The new run is self-contained after copying, and its
raw images are rechecked before processing. Hashes detect accidental substitution;
they are not signatures against a party who can rewrite all records.

This is explicit result reuse, not automatic retry or visual approval. New
materials still need a fresh digest-bound review. Original failed runs remain
unchanged. A cached result does not authorize any other generation in the plan.
