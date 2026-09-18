# Continuous serial generation loop

`generation-loop.mjs` implements a dependency-free, host-injected async loop.
It performs no filesystem/network operation or provider lookup on its own.
It is suitable for a persistent tool-orchestration cell: the host supplies official
`workflow-exchange-generation` invocation, the built-in image tool, durable local
event persistence, result resolution, cancellation and progress callbacks.

The loop receives the previous result, obtains the next exact frozen arguments,
persists invocation intent, invokes once, retains the tool response, resolves the
returned local image, and continues without returning to the Agent for each image.
At most one generation call is active. `maxCalls` must equal the approved frozen
budget read from the real job; it is an additional bound, not authorization.
Official exchange checks authorization, source identity and one-use reservations.
No provider retry, automatic recovery or parallel dispatch exists.

## Host bindings

### Official Windows tool-host entry

After explicit plan-bound authorization, run:

```text
ai-ui-decomposition workflow-export-loop --job JOB --output FRESH/run.js --output-root VERIFIED_TOOL_OUTPUT_DIRECTORY
```

Optional `--python` and `--node` choose installed local executables. Export checks
official status and refuses unauthorized or already-started generation. It reads
the frozen authorization budget, bundles the packaged core and host binding,
and returns the exclusive script path and SHA-256. It invokes no generation and
does not authorize anything. It is specific to the Windows PowerShell tool host;
it does not change provider-mode jobs or claim support for other shells.

Read the generated script without truncation, and execute it unchanged in a
single awaited tool orchestration cell (the host provides the named tools and
display callbacks):

```javascript
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const report = await new AsyncFunction('tools', 'notify', 'generatedImage',
  'setTimeout', 'clearTimeout', source)(tools, notify, generatedImage,
  setTimeout, clearTimeout);
text(report);
```

`source` is the exact local exported script text, not model-written callbacks.
The host entry verifies fresh job status again, creates an exclusive journal,
runs official CLI exchanges, forwards frozen arguments to `image_gen__imagegen`,
transports full responses with structured `apply_patch`, syncs batched events,
checks real paths and bytes, and records per-phase timing. Image display occurs
only after response persistence and verification. An `execution-summary` event
contains the final report. The script uses no filesystem/network access inside
the tool cell itself; local operations use the explicit shell/file tools.

Await the script for its entire lifetime; never rerun it after interruption.
Unknown tool outcomes or transport errors stop without retries. Exporting another
file does not reset official authorization or request state. Generation completion
stops at `process`; the unchanged preflight/review/acceptance gates still apply.
Journal/transport paths and runtime paths are local private execution data, not
provider-neutral delivery package contents.

- `exchange(previous)` calls the official CLI (Python module
  `ai_ui_decomposition.cli`) and returns its JSON. When previous is present, pass
  its requestDigest and source as structured arguments or safely quoted literals;
  never concatenate untrusted paths into shell code.
- `generate(arguments)` forwards the object directly to the built-in tool. The
  calling tool cell must await the entire loop; abandoning a live promise is not
  a safe pause or cancellation mechanism.
- `persist(event)` must durably write an exclusive fresh journal before resolving.
  Do not reuse a previous journal or fabricate a completed receipt. Large image
  response data requires a suitable file transport, never a huge shell command.
- `resolveResult(response)` returns only a verified existing local PNG from the
  configured output directory. Official receive checks source image bytes. The
  included parser provides lexical path validation; the host additionally owns
  real-path/symlink checks and may compare inline PNG bytes with the file.
- `progress` shows start/return updates. Supply `schedule`/`unschedule` from the
  host timers for a 30-second waiting update. These do not impose a timeout or
  retry a slow provider call.
- `cancelled` is checked before dispatch and after a returned result is preserved.
  A cancelled or interrupted external invocation may have been accepted; preserve
  records and require explicit reconciliation, never restart the loop blindly.

## Built-in response resolution boundary

The optional `generation-loop-node.mjs` local host helper now supplies an exclusive
fresh journal with per-event file `fsync`, and physical-path plus inline/file byte
verification. It rejects symlink result files, non-direct physical children,
missing files, malformed base64, non-PNG signatures and mismatched bytes. Full PNG
decoding remains owned by official receive. File syncing is not a guarantee of
directory durability across power loss, and this helper assumes a trusted local
output directory (it does not eliminate concurrent file replacement races).
`generation-loop-bridge.mjs` exposes local `init <journal>`,
`persist <journal> <input-event-file>` and `resolve <output-root> <event-file>`
operations. The tool host transports JSON through a structured file-write tool,
not shell interpolation; then persist exclusively writes and syncs the journal.
Use fresh numbered input files, await every operation, and stop on any nonzero
exit. Resolve reads a preserved tool-returned event. Shell arguments must still
be safely quoted. These operations never submit generation or authorize a job.
The bridge has been exercised from the actual tool orchestration environment on
three synthetic responses through official CLI receive. One retained real response
(1,248,089 transport bytes, 935,535 PNG bytes) also passed file transport, journal
sync and exact inline/file verification without generation or official re-receive.
This validates that observed payload size only; arbitrary sizes, real provider
latency and complete delivery remain unverified.

One retained real built-in response exposed `image_url` as a PNG data URL and
`output_hint` with a unique ` as <local PNG> by default.` clause. `builtinResultPath`
supports precisely that observed clause and a caller-specified direct output
directory. It rejects missing/ambiguous hints, remote/UNC paths, traversal and
nested/outside paths. There is no directory scan or newest-file guess.

This is an observed compatibility adapter, **not a documented stable result-path
schema**. A tool response format change stops after preserving the response and
before any next generation. It must not spend another call to recover a missing
path. A future structured path field should be supported only with new evidence.

## Validation and timing

`batchedLoopPersistence(writeBatch)` is an opt-in transport adapter. It buffers
only `exchange` and `result-ready` diagnostics. Invocation intent, full tool
response, stopped and interrupted events synchronously flush all pending events
in order as `ui_generation_loop_events_v1`. A write failure poisons the adapter:
no retry or later dispatch is permitted. The bridge resolver supports these
batches and requires the last event to be `tool-returned`.

This changes diagnostic durability: a hard process termination may lose buffered
exchange/result-ready events. Critical intent and raw-response boundaries remain
durable before invocation and before result resolution respectively. Official
workflow receipts remain authoritative. Do not implicitly resume an interrupted
journal. For three simulated responses the observed actual tool-host transport
count decreased from 14 writes to 7; these are offline orchestration measurements,
not provider-speed or end-to-end delivery measurements.

Offline tests cover nine serial calls in one loop, unchanged arguments, budget,
duplicate requests, provider exception, persistence failure, cancellation,
unrecognized response and progress timers. A separate integration test drives
the real CLI exchange on synthetic fixture images; it never calls a provider or
produces a user-artwork acceptance claim.

This establishes control flow, not live speed. Tool-call milliseconds, exchange
milliseconds and the whole loop duration are nested measurements; do not add them
together. Compare the next naturally requested real batch with the previous
generate-node elapsed time. Do not generate another nine images just to claim a
speedup from fixture timing. Existing image-quality gates remain after collection.
