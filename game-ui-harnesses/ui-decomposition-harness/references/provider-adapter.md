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
