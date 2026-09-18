# Single exchange for generation handoff

The standard Windows tool-host route is now `workflow-export-loop`; see the
[packaged host entry](continuous-generation-loop-v1.md). It owns the callback
bindings and timing rather than requiring task-specific orchestration code.

For a host that can retain one tool execution across the batch, the
[continuous serial loop](continuous-generation-loop-v1.md) consumes this entry
without per-image Agent round trips. It has offline control-flow and CLI fixture
coverage; live speed and host-specific durable response transport remain separate
verification requirements.

`workflow-exchange-generation --job JOB` assigns the first authorized request and
returns `nextRequest.arguments`, read from verified frozen inputs. It also records
the exact submission intent. The command invokes no provider.

After the one external image call, invoke the same command with
`--request-digest DIGEST --source PNG`. It receives that image and immediately
prepares the next authorized request, returning its exact arguments in the same
JSON response. When complete or failed, `nextRequest` is null. Do not call it
again to recover an uncertain or interrupted invocation: official one-use state
and source checks remain authoritative. This is serial, not parallel dispatch.

For a tool-capable Agent, parse the command result and forward
`nextRequest.arguments` directly to the built-in image tool in the same tool
orchestration cell. Do not add a separate file-read round trip or reconstruct
the prompt. Retain the image result path and use it in the next exchange. Preserve
each tool result and its actual elapsed time, and keep user progress updates at
least once per minute. Do not use this flow to invent a result path or fake media
invocation evidence. Submission records prove intent, not provider attestation.

`timings` separates receive, prepare and total local API time. Record external
tool start/end immediately around the actual tool call, plus the whole wall-clock
phase. The difference contains Agent/tool transport and other scheduling gaps;
do not label it provider time. An offline API benchmark excludes those gaps and
cannot prove the speedup of live image generation.

Two concurrent image calls are not enabled by this change. The current file
bridge intentionally admits one request at a time. Concurrency requires a new
contract, reliable result association and an explicit frozen concurrency budget;
it must not bypass reservation rules or reuse earlier authorization.
