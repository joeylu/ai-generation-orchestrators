# Runtime integration contract

This document defines the process boundary for an external scheduler or service
that invokes `ai-image-background-removal`. It does not define or ship an HTTP
server, container, database, queue, or deployment topology. Those components
belong to the consuming system and must install an immutable tagged wheel by
verified SHA-256.

## Supported process flow

For an opaque source, the integration is deliberately two phase:

1. Run `doctor --require-ready` and reject inputs that fail local admission.
2. Run `plan` and persist its complete JSON response.
3. Obtain explicit authorization for that exact `plan_sha256`.
4. Run `prepare` once with the same root, source, output directory, profile, and
   digest.
5. Run `validate` against the resulting `handoff.json` before exposing artifacts
   to a downstream consumer.

`plan` is offline. `prepare` is the only command in this flow that may submit a
fal request. An integration must not combine planning and compute in a way that
hides the digest confirmation boundary.

Meaningful existing source alpha bypasses fal compute, but the CLI still uses
the same plan and single-use confirmation protocol and publishes the same
artifact family.

## Standard output and process exits

Normal command results are UTF-8 JSON objects on stdout. Runtime failures are a
compact JSON object on stderr:

```json
{"status":"error","code":"reference_provider_timeout","type":"ValueError"}
```

Argument-parser failures exit before the runtime error wrapper and may write
plain usage text to stderr. Validate arguments in the caller instead of assuming
every exit-2 stderr payload is JSON.

| Exit | Meaning | Integration action |
| ---: | --- | --- |
| 0 | Command completed its structural contract | Parse stdout JSON and inspect `status`; this is not semantic image approval. |
| 1 | `doctor --require-ready` is not ready, or experimental consensus QA rejected | Treat as a controlled non-success; do not translate it into provider failure. |
| 2 | Invalid input, unsafe path, consumed authorization, provider/transport failure, or artifact validation failure | Parse the redacted `code` when JSON is present; never expose raw stderr as a public error. |

Important success statuses include `ready`, `passed`, and
`prepared_requires_visual_review`. The latter means the artifact bundle is
structurally complete; it does not certify semantic foreground correctness.
Experimental consensus `passed` means only that the configured alpha-agreement
thresholds passed.

## Durable state and idempotency

The workspace root is part of the security and idempotency boundary. Persist all
of the following together:

```text
<root>/
  <original source>
  .ai-image-background-removal/attempts/<plan_sha256>.json
  <fresh output directory>/
    cutout.png
    foreground.png
    preparation.json
    handoff.json
    review/
```

The attempt file is created before provider submission. Its terminal state is
`succeeded` or `indeterminate`; an existing file makes the digest unusable.
Losing this directory during a process or container restart loses the local
replay guard and is not supported. Do not derive it from an in-memory request
record alone.

Every output directory must be new. A retry must never delete or overwrite the
old directory. Tenant workspaces must be isolated, and every user-supplied path
must remain below its resolved root.

## Retry, timeout, and cancellation

No provider failure after attempt reservation is automatically retryable. This
includes authentication, credit, rate-limit, connection, timeout, protocol,
5xx, malformed-result, and indeterminate failures. The provider may already
have accepted compute.

An outer scheduler may impose a process deadline, but terminating `prepare`
after reservation must be recorded as indeterminate. It must not immediately
resubmit the same plan. A new provider attempt requires a new user decision, a
fresh output directory, a freshly generated plan, and confirmation of its new
digest.

The bounded retry used for the final local Windows directory rename is internal
publication recovery. It does not repeat provider compute.

## Admission and scheduling

Call `doctor` and consume its `resource_policy` instead of hard-coding host
assumptions. Version 0.4.0 publishes these integration limits:

- Python 3.10 or newer;
- JPEG, PNG, or WebP source media;
- source file at most 32 MiB;
- decoded image at most 8,388,608 pixels;
- one remote preparation at a time per worker;
- provider output must be one inline PNG at the EXIF-oriented source size;
- decoded inline provider output is bounded at 128 MiB.

The scheduler owns queue length, backpressure, and tenant quotas. It must enforce
the advertised remote concurrency and must not use additional worker replicas to
bypass a user's compute authorization scope.

## Secrets, logs, and public responses

Inject `FAL_KEY` only into the server process environment or an equivalent
runtime secret facility. Never place it in an image, repository, command line,
plan, task payload, database row, report, fixture, artifact URL, or log.

Do not expose raw provider exceptions. Public plans and results must not contain
provider request IDs, upload/output URLs, query strings, credentials, local home
paths, or private transport state. Retain the CLI's safe error `code` as an
opaque machine identifier and add service-owned correlation data outside the
portable handoff.

## Artifacts and retention

`cutout.png` is the source-size authoritative transparent result.
`foreground.png` is the fitted downstream reference. `preparation.json` is the
producer report, while `handoff.json` is the stable provider-neutral consumer
contract. Validate the handoff immediately before consumption or download.

Serve PNG artifacts as `image/png` and JSON documents as `application/json`.
Do not synthesize success from file existence. Retention cleanup must preserve
an active attempt's source, attempt state, report, handoff, and all fingerprinted
artifacts as one unit. Removing completed work is a service policy, not a CLI
operation.

## Experimental consensus QA

Consensus QA is opt-in and offline, but its three inputs require three separately
planned and confirmed provider preparations. The default production profile
remains General Light 1024 and does not generate those candidates. The QA command
can reject the primary result; it never chooses a fallback and cannot certify
semantic correctness.

An external API specification should model this as an experimental policy with
explicit cost authorization, not as an invisible retry or a default success
gate. See [fal V2 benchmark](fal-v2-benchmark.md) for the evidence and known
failure classes behind that decision.
